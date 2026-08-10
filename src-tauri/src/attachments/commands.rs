//! Tauri commands for the attachments feature. The Rust side owns the
//! blob store; the frontend asks for an inserted attachment, opens an
//! existing one, lists what's local, or kicks off GC.

use crate::attachments::store;
use crate::db::Db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{Manager, State};

#[derive(Serialize, Deserialize, Debug)]
pub struct AttachmentDto {
    pub blob_hash: String,
    pub filename: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub sync: bool,
    pub has_local: bool,
    pub created_at: String,
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn attachment_add(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    engine: State<'_, crate::op_log::OpLog>,
    source_path: String,
    sync: Option<bool>,
) -> Result<AttachmentDto, String> {
    // Desktop path: the picker returns a real filesystem path we can read.
    let bytes = std::fs::read(&source_path).map_err(|e| format!("read source: {e}"))?;
    let filename = std::path::Path::new(&source_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled")
        .to_string();
    insert_attachment(&app, db.inner(), engine.inner(), bytes, filename, None, sync.unwrap_or(false))
}

/// Like `attachment_add` but takes the file bytes directly. Used where the
/// picker returns a handle the Rust side can't read with `std::fs` — Android
/// `content://` URIs and the web `<input type="file">`. The WebView reads the
/// bytes and passes them here with the original filename + mime type.
#[tauri::command]
pub fn attachment_add_bytes(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    engine: State<'_, crate::op_log::OpLog>,
    bytes: Vec<u8>,
    filename: String,
    mime_type: Option<String>,
    sync: Option<bool>,
) -> Result<AttachmentDto, String> {
    insert_attachment(
        &app,
        db.inner(),
        engine.inner(),
        bytes,
        filename,
        mime_type,
        sync.unwrap_or(false),
    )
}

/// Shared body for both add paths: validate, store the blob, record the row.
///
/// `_engine` is retained (rather than dropped from the signature) because
/// the op for a synced attachment is still emitted — just not here. See
/// the comment at the end of the body.
pub(crate) fn insert_attachment(
    app: &tauri::AppHandle,
    db: &Db,
    _engine: &crate::op_log::OpLog,
    bytes: Vec<u8>,
    filename: String,
    mime_type: Option<String>,
    sync: bool,
) -> Result<AttachmentDto, String> {
    if bytes.is_empty() {
        return Err("file is empty".into());
    }
    let max = 100 * 1024 * 1024;
    if bytes.len() > max {
        return Err(format!(
            "file is {} bytes; v0.4 caps attachments at {max}",
            bytes.len()
        ));
    }
    let blob_hash = store::hash_hex(&bytes);
    let app_dir = app_data_dir(app)?;
    store::write_blob(&app_dir, &blob_hash, &bytes).map_err(|e| format!("write blob: {e}"))?;

    // Prefer the picker-provided mime; fall back to guessing from the filename.
    let mime_type = mime_type
        .filter(|m| !m.is_empty())
        .or_else(|| mime_guess_for(&filename));
    let size_bytes = bytes.len() as i64;
    let now = chrono::Utc::now().to_rfc3339();

    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6) \
         ON CONFLICT(blob_hash) DO UPDATE SET \
            filename = excluded.filename, \
            mime_type = excluded.mime_type, \
            size_bytes = excluded.size_bytes, \
            has_local = 1, \
            gc_swept = 0, \
            last_seen_at = excluded.last_seen_at",
        params![&blob_hash, &filename, &mime_type, size_bytes, sync as i64, &now],
    )
    .map_err(|e| e.to_string())?;

    // No op is emitted here even when `sync` is true. The bytes now travel
    // as their own relay object, and the op referencing that object must
    // not exist before the object does — otherwise a peer pulls a pointer
    // to nothing and sits at has_local = 0 forever. The row this INSERT
    // just wrote (sync = 1, has_local = 1, object_key NULL) is exactly what
    // `backfill::pending_object_upload` looks for; the sync worker uploads
    // the object and emits the op, in that order.

    Ok(AttachmentDto {
        blob_hash,
        filename,
        mime_type,
        size_bytes,
        sync,
        has_local: true,
        created_at: now,
    })
}

#[tauri::command]
pub fn attachment_open(app: tauri::AppHandle, blob_hash: String) -> Result<(), String> {
    let app_dir = app_data_dir(&app)?;
    if !store::has_local(&app_dir, &blob_hash) {
        return Err("file not on this device".into());
    }
    let path = store::path_for(&app_dir, &blob_hash).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("opener failed: {e}"))
}

/// Should flipping an attachment's sync flag put its bytes on the wire?
///
/// Only on the off→on edge, and only when there is something to send that
/// hasn't been sent. This is the decision that was missing entirely: the
/// toggle used to write the flag and stop, and since every attachment is
/// created with `sync: false` (local-first), `emit_attachment_blob`'s one
/// call site in `insert_attachment` was never reached. Nothing was ever
/// queued for upload — a real library had 3 attachments, 22 MB, 500+ ops,
/// and zero `attachment_blob` rows.
///
/// - `was == next`: no edge, nothing to do (a repeated toggle isn't consent).
/// - `!has_local`: the blob has been GC'd; there are no bytes to read.
/// - `delivered_inline`: this file's BYTES already went out inside a
///   committed legacy inline op. Uploading an object as well would pay
///   for the same 21 MB twice on a library that already has it.
///
/// What this argument deliberately no longer means is "an
/// `attachment_blob` op exists". An op can exist for a file whose
/// object has been deleted — un-synced, or emitted by an early build
/// that never uploaded one — and those rows must be uploadable again.
/// The op log is append-only; it records what was said, not what is
/// still on the relay. See [`crate::attachments::backfill::
/// delivered_inline`].
pub fn should_enqueue_blob(was: bool, next: bool, has_local: bool, delivered_inline: bool) -> bool {
    next && !was && has_local && !delivered_inline
}

#[tauri::command]
pub fn attachment_set_sync(
    db: State<'_, Db>,
    engine: State<'_, crate::op_log::OpLog>,
    worker_slot: State<'_, crate::commands::SyncWorkerSlot>,
    blob_hash: String,
    sync: bool,
) -> Result<(), String> {
    let queued = attachment_set_sync_inner(db.inner(), engine.inner(), &blob_hash, sync)?;
    if queued {
        // The upload itself belongs to the worker (it reads the whole
        // file, seals it and PUTs it — none of which should happen on a
        // command thread the UI is awaiting). Nudging it just means the
        // user sees the file reach the relay in a second rather than at
        // the next 30s poll. Best-effort: no worker, no nudge, the next
        // tick still finds the row.
        if let Ok(slot) = worker_slot.lock() {
            if let Some(handle) = slot.as_ref() {
                handle.wake();
            }
        }
    }
    Ok(())
}

/// What a relay call needs, read while `conn`'s lock is still held.
/// `None` means there's no relay to talk to — sync isn't active, or this
/// device hasn't persisted keys yet.
fn relay_call_context(
    conn: &rusqlite::Connection,
) -> Option<(String, String, crate::sync::keys::DeviceKeys)> {
    let cfg = crate::sync::config::load(conn).ok()?;
    if !cfg.is_active() {
        return None;
    }
    let base_url = cfg.relay_url?;
    let user_id = cfg.user_id?;
    let device_keys = crate::sync::keys::load_device_keys(conn).ok()??;
    Some((base_url, user_id, device_keys))
}

/// Testable body of `attachment_set_sync`. Split out because a
/// `#[tauri::command]`'s `State<'_, _>` params can't be constructed in a
/// unit test — mirrors `attachment_local_bytes` / `attachment_local_bytes_inner`.
///
/// Returns whether this call queued an upload (the off→on edge), so the
/// command wrapper can nudge the sync worker.
pub fn attachment_set_sync_inner(
    db: &Db,
    engine: &crate::op_log::OpLog,
    blob_hash: &str,
    sync: bool,
) -> Result<bool, String> {
    let (queued, delete_object_key, wire_ctx) = {
        let conn = db.lock().map_err(|e| e.to_string())?;

        let (was, has_local, object_key, mime_type, size_bytes): (
            bool,
            bool,
            Option<String>,
            Option<String>,
            i64,
        ) = conn
            .query_row(
                "SELECT sync, has_local, object_key, mime_type, size_bytes \
                 FROM attachments WHERE blob_hash = ?1",
                params![blob_hash],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)? != 0,
                        r.get::<_, i64>(1)? != 0,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, i64>(4)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;

        let delivered_inline =
            crate::attachments::backfill::delivered_inline(&conn, blob_hash)?;

        // Turning the switch on IS the consent, and this is still the only
        // place that edge is recognised. What it no longer does is emit the
        // op: the bytes travel as their own relay object now, and a
        // reference to an object that hasn't been uploaded is worse than no
        // reference at all — the peer that pulls it waits forever. The row
        // this UPDATE writes (sync = 1, no object_key) is what
        // `backfill::pending_object_upload` matches, and the worker does
        // read → seal → PUT → emit, in that order, off the command thread.
        let queued = should_enqueue_blob(was, sync, has_local, delivered_inline);

        // The on->off edge: this device is telling the relay to drop the
        // object. Read what the network call needs while the lock is
        // still held (a cheap DB read) — never carry `conn` across the
        // HTTP call itself.
        //
        // Deleting by `object_key`, never by `blob_hash`: blob_hash is
        // sha256 of the plaintext and no such object has ever existed on
        // the relay. A DELETE at that path is a 200 with deleted: false —
        // silently freeing nothing while the real object stays and keeps
        // costing the account its quota.
        let should_delete = was && !sync;
        let delete_object_key = if should_delete { object_key } else { None };
        let wire_ctx = if delete_object_key.is_some() {
            relay_call_context(&conn)
        } else {
            None
        };

        // ONE TRANSACTION: the flag, the retraction op, and forgetting
        // the object key are one statement about the world. The op log
        // is append-only, so the reference that told every peer to GET
        // this object cannot be withdrawn — it can only be superseded,
        // and the retraction has to be as durable as the deletion it
        // announces. Committing the cleared key without the op would
        // leave every peer 404-ing on the object forever; committing
        // the op without clearing the key would leave this device
        // claiming an object it is about to delete.
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE attachments SET sync = ?1 WHERE blob_hash = ?2",
            params![sync as i64, blob_hash],
        )
        .map_err(|e| e.to_string())?;
        if let Some(object_key) = &delete_object_key {
            crate::op_log::emit_attachment_revocation(
                engine,
                &tx,
                blob_hash,
                mime_type.as_deref(),
                size_bytes,
                object_key,
            )?;
            // Forget the object we're about to drop. The row keeps its
            // bytes and its blob_hash; it just no longer claims to have
            // an object on the relay — which is also what re-arms the
            // upload if the user turns sync back on. `object_epoch`
            // goes with it: it describes that object and nothing else,
            // and a stale epoch left behind would be attached to
            // whatever key the next upload records.
            tx.execute(
                "UPDATE attachments SET object_key = NULL, object_epoch = NULL WHERE blob_hash = ?1",
                params![blob_hash],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;

        (queued, delete_object_key, wire_ctx)
    };
    // Lock dropped here. The row's `sync` flag is already committed to 0
    // above, unconditionally — everything below is best-effort relay
    // cleanup that must never re-block or undo the toggle.

    if let Some(object_key) = delete_object_key {
        match wire_ctx {
            Some((base_url, user_id, device_keys)) => {
                if let Err(e) = crate::sync::wire::attachment_object::delete_attachment(
                    &base_url,
                    &device_keys,
                    &user_id,
                    &object_key,
                ) {
                    // Un-syncing is a statement about the relay, not about
                    // this device: the local flag is already off and the
                    // bytes on disk are untouched either way. A failed
                    // delete just means the relay may still hold a copy
                    // until the next attempt — it must not block or
                    // reverse the toggle.
                    log::warn!(
                        "attachment_set_sync: delete_attachment for {blob_hash} \
                         (object {object_key}) failed (local flag stays off; relay object \
                         may still exist): {e}"
                    );
                }
            }
            None => {
                // Sync isn't active, or this device has no keys — there's
                // no relay to tell.
            }
        }
    }
    Ok(queued)
}

#[tauri::command]
pub fn attachment_list(db: State<'_, Db>) -> Result<Vec<AttachmentDto>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at \
             FROM attachments ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AttachmentDto {
                blob_hash: r.get(0)?,
                filename: r.get(1)?,
                mime_type: r.get(2)?,
                size_bytes: r.get(3)?,
                sync: r.get::<_, i64>(4)? != 0,
                has_local: r.get::<_, i64>(5)? != 0,
                created_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn attachment_gc(app: tauri::AppHandle, db: State<'_, Db>) -> Result<usize, String> {
    let app_dir = app_data_dir(&app)?;
    attachment_gc_inner(db.inner(), &app_dir)
}

/// Testable body of `attachment_gc` — same split as
/// `attachment_set_sync` / `attachment_set_sync_inner`, and for the
/// same reason: a `#[tauri::command]`'s `AppHandle` cannot be
/// constructed in a test, and what this function decides (which blobs
/// are orphaned, and what the row must say afterwards so the sync
/// worker does not undo it) is exactly what needs a test.
pub fn attachment_gc_inner(db: &Db, app_dir: &std::path::Path) -> Result<usize, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let referenced = referenced_blob_hashes(&conn)?;

    // The grace window is not a reference — it is a stay of execution for
    // a file added minutes ago whose block hasn't been saved into a page
    // yet. Kept separate from `referenced` so the re-arm below (which
    // means "something points at this again") can't be triggered by a
    // row simply being new.
    let mut keep = referenced.clone();
    let grace_cutoff = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
    let mut recent_stmt = conn
        .prepare("SELECT blob_hash FROM attachments WHERE created_at >= ?1")
        .map_err(|e| e.to_string())?;
    let recent_rows = recent_stmt
        .query_map([&grace_cutoff], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for h in recent_rows {
        keep.insert(h);
    }

    // Re-arm anything a reference points at again. `gc_swept = 1` means
    // "the user asked to be rid of an ORPHAN", and this pass is the only
    // place that judgement is made — so it is also the only place it can
    // be withdrawn. A device that swept a pinned file under the
    // pages-only scan above is left with the blob gone, `gc_swept = 1`,
    // and every recovery path shut (`pending_object_fetch` skips swept
    // rows, `attachment_open` has no fetch-on-demand, `should_enqueue_blob`
    // needs has_local). Clearing the flag for a hash that IS referenced
    // puts the row back in the fetch sweep's sights, which is what pulls
    // the bytes down again from the relay object that is still alive.
    // Existing installs are already in that state; widening the scan
    // alone would not get their files back.
    let mut rearm = conn
        .prepare("UPDATE attachments SET gc_swept = 0 WHERE blob_hash = ?1 AND gc_swept = 1")
        .map_err(|e| e.to_string())?;
    for hash in &referenced {
        rearm.execute(params![hash]).map_err(|e| e.to_string())?;
    }
    drop(rearm);

    let on_disk = store::list_all(app_dir).map_err(|e| e.to_string())?;
    let mut removed = 0usize;
    for hash in on_disk {
        if !keep.contains(&hash) {
            store::delete_blob(app_dir, &hash).map_err(|e| e.to_string())?;
            // `gc_swept = 1` is what stops the object-fetch sweep
            // pulling it straight back down. `pending_object_fetch`
            // selects `sync = 1 AND has_local = 0 AND object_key IS NOT
            // NULL`, which is precisely the row this UPDATE leaves —
            // so without the flag "free up space" is a no-op plus a
            // full re-download within 30 seconds.
            conn.execute(
                "UPDATE attachments SET has_local = 0, gc_swept = 1 WHERE blob_hash = ?1",
                params![&hash],
            )
            .map_err(|e| e.to_string())?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Every blob hash something on this device still points at.
///
/// TWO reference roots, not one. `pages.content_json` is the obvious
/// one. `shared_objects.content` is the one whose absence cost a user
/// their file: a pin is a pointer PLUS a frozen snapshot of what it
/// pinned (migration 013, pin pointer semantics), and when the source
/// page is deleted the pin survives orphaned with that cache intact —
/// documented, intended product behaviour. So a pinned file block
/// routinely has NO `pages` row naming its hash while the user still
/// very much has the file. The frontend reads `blob_hash` out of
/// exactly this cache (`src/lib/pin-display.js` `attachmentMetaOf`,
/// `src/components/pins/PinRow.svelte`'s row click). Scanning pages
/// alone made "free up space" delete the only local copy of the one
/// thing the user had explicitly kept.
///
/// LOAD-BEARING INVARIANT — `pages.content_json` MUST KEEP MIRRORING
/// `pages.yjs_state`. For a continuous trail the source of truth is
/// `yjs_state`; `content_json` is a derived mirror, and it is the only
/// one of the two this scan can read (a hash inside the CRDT binary is
/// invisible here — see "why not scan yjs_state" below). The mirror
/// holds today because both writers keep it: `save_page_content_inner`
/// writes `content_json` on every save, and `merge_page_yjs` overwrites
/// it whenever the peer ships a snapshot, which `emit_page_yjs` always
/// does. Nothing enforces that — it is a convention two call sites
/// happen to honour.
///
/// If it stops holding — migration 019 names phase 14.19, "computing
/// deltas instead of full content_json flushes", as the next send-side
/// step, and `merge_page_yjs` already tolerates peers that omit the
/// snapshot — then a file the user attached to a continuous doc is
/// named only inside `yjs_state`. This scan does not see it, GC counts
/// it an orphan, deletes the blob and sets `gc_swept = 1`, and every
/// path back to the bytes is shut: `pending_object_fetch` skips swept
/// rows and `attachment_open` has no fetch-on-demand. The user loses a
/// file that is still on the page in front of them. Whoever implements
/// delta flushes must either keep writing the mirror or teach this scan
/// to read the CRDT.
///
/// Why not scan `yjs_state` directly, today: it would mean decoding
/// every continuous page's doc in the GC path and walking the
/// y-prosemirror XmlFragment for `blob_hash` attributes. The Rust side
/// has never decoded that structure — `sync::yjs` treats the state as
/// opaque bytes — so the attribute encoding would be an assumption, and
/// a Rust test that builds the fragment with yrs and reads it back with
/// yrs would confirm the assumption rather than the format y-prosemirror
/// actually writes. A scanner that silently matches nothing is worse
/// than a documented invariant, because it reads as protection. Doing it
/// properly wants a fixture generated from the JS side (`src/lib/yjs/
/// page-doc.js`) and checked in; until then this comment plus the
/// `merge_page_yjs` re-arm is the honest cover. A substring search of
/// the raw update bytes is NOT an acceptable shortcut: yjs keeps deleted
/// items until its own GC, so a hash the user removed and swept would
/// still be found and resurrected on every merge.
pub(crate) fn referenced_blob_hashes(
    conn: &rusqlite::Connection,
) -> Result<std::collections::HashSet<String>, String> {
    let mut referenced: std::collections::HashSet<String> = std::collections::HashSet::new();
    for sql in [
        "SELECT content_json FROM pages WHERE content_json IS NOT NULL",
        "SELECT content FROM shared_objects WHERE content IS NOT NULL",
    ] {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let json: String = row.get(0).map_err(|e| e.to_string())?;
            collect_blob_hashes(&json, &mut referenced);
        }
    }
    Ok(referenced)
}

pub(crate) fn collect_blob_hashes(
    content_json: &str,
    out: &mut std::collections::HashSet<String>,
) {
    let v: serde_json::Value = match serde_json::from_str(content_json) {
        Ok(v) => v,
        Err(_) => return,
    };
    walk_blob_hashes(&v, out);
}

fn walk_blob_hashes(v: &serde_json::Value, out: &mut std::collections::HashSet<String>) {
    if let Some(obj) = v.as_object() {
        if let Some(attrs) = obj.get("attrs").and_then(|a| a.as_object()) {
            if let Some(h) = attrs.get("blob_hash").and_then(|s| s.as_str()) {
                out.insert(h.to_string());
            }
        }
        for (_, child) in obj {
            walk_blob_hashes(child, out);
        }
    } else if let Some(arr) = v.as_array() {
        for child in arr {
            walk_blob_hashes(child, out);
        }
    }
}

/// Total bytes this device is actually holding — the honest local number,
/// distinct from the relay-side `used` figure the quota reports. Rows the GC
/// has swept (`has_local = 0`) survive as pointers but occupy nothing.
#[tauri::command]
pub fn attachment_local_bytes(db: State<'_, Db>) -> Result<i64, String> {
    attachment_local_bytes_inner(db.inner())
}

pub fn attachment_local_bytes_inner(db: &Db) -> Result<i64, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT COALESCE(SUM(size_bytes), 0) FROM attachments WHERE has_local = 1",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Resolve a blob's local path so the frontend can build a webview-loadable
/// src via convertFileSrc — mirrors attachment_open's own path resolution,
/// but returns the path instead of opening it with the OS handler.
#[tauri::command]
pub fn attachment_local_src(
    app: tauri::AppHandle,
    blob_hash: String,
) -> Result<Option<String>, String> {
    let app_dir = app_data_dir(&app)?;
    if !store::has_local(&app_dir, &blob_hash) {
        return Ok(None);
    }
    let path = store::path_for(&app_dir, &blob_hash).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_db;
    use httpmock::prelude::*;
    use serde_json::json;

    fn insert_row(db: &Db, blob_hash: &str, size_bytes: i64, has_local: bool) {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at) \
             VALUES (?1, 'f', 'image/png', ?2, 0, ?3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![blob_hash, size_bytes, has_local as i64],
        )
        .unwrap();
    }

    /// Record where this row's object landed on the relay — what a
    /// successful upload writes.
    fn set_object_key(db: &Db, blob_hash: &str, object_key: &str) {
        let conn = db.lock().unwrap();
        conn.execute(
            "UPDATE attachments SET object_key = ?1 WHERE blob_hash = ?2",
            params![object_key, blob_hash],
        )
        .unwrap();
    }

    fn object_key_of(db: &Db, blob_hash: &str) -> Option<String> {
        let conn = db.lock().unwrap();
        conn.query_row(
            "SELECT object_key FROM attachments WHERE blob_hash = ?1",
            params![blob_hash],
            |r| r.get::<_, Option<String>>(0),
        )
        .unwrap()
    }

    #[test]
    fn local_bytes_sums_only_rows_still_on_disk() {
        let db = test_db();
        insert_row(&db, "hash-a", 1000, true);
        insert_row(&db, "hash-b", 2000, true);
        // gc'd: row survives, bytes gone. Must not count toward the total.
        insert_row(&db, "hash-c", 5000, false);

        let total = attachment_local_bytes_inner(&db).unwrap();
        assert_eq!(total, 3000, "gc'd (has_local=0) rows must not count");
    }

    // The toggle used to be a bare UPDATE. Every attachment is created
    // with sync: false, so the one emit site (in insert_attachment) was
    // unreachable and nothing ever uploaded.
    #[test]
    fn enqueues_only_on_the_off_to_on_edge() {
        assert!(should_enqueue_blob(false, true, true, false), "turning it on must send");
        assert!(!should_enqueue_blob(true, true, true, false), "already on: no new consent");
        assert!(!should_enqueue_blob(true, false, true, false), "turning it off sends nothing");
        assert!(!should_enqueue_blob(false, false, true, false), "still off");
    }

    #[test]
    fn never_enqueues_bytes_it_does_not_have() {
        // GC'd: the row survives as a pointer, the bytes are gone.
        assert!(!should_enqueue_blob(false, true, false, false));
    }

    #[test]
    fn does_not_re_enqueue_a_blob_already_in_the_log() {
        // Flicking the switch off and on again would otherwise re-queue the
        // whole payload — 21 MB for one file on the library this was found on.
        assert!(!should_enqueue_blob(false, true, true, true));
    }

    /// I5 — AN EXPLICIT GC MUST STAY DONE.
    ///
    /// `attachment_gc` deletes the blob and sets `has_local = 0`,
    /// leaving `sync = 1` and `object_key` intact — which is the exact
    /// shape `pending_object_fetch` selects. Before attachments moved
    /// out of band nothing fetched on a tick, so freeing space worked.
    /// Afterwards, "free up space" became a no-op for every synced
    /// attachment plus a full re-download of the user's attachment set
    /// within 30 seconds.
    ///
    /// Driven through the real GC and the real fetch query rather than
    /// by setting the flag by hand: the finding is precisely that these
    /// two agreed on a row shape and disagreed on what it meant.
    #[test]
    fn a_gc_swept_attachment_is_not_pulled_straight_back_down() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"the bytes the user asked to be rid of";
        let hash = store::hash_hex(bytes);
        store::write_blob(dir.path(), &hash, bytes).unwrap();
        // Synced, referenced by no page, and past the one-hour grace
        // window — an orphan, which is all GC ever sweeps.
        insert_row(&db, &hash, bytes.len() as i64, true);
        set_row_sync(&db, &hash, true);
        set_object_key(&db, &hash, "obj-freed");
        assert_eq!(
            crate::attachments::backfill::pending_object_fetch(&db).unwrap().len(),
            0,
            "precondition: the bytes are here, so nothing is pending"
        );

        assert_eq!(attachment_gc_inner(&db, dir.path()).unwrap(), 1);

        assert!(!store::has_local(dir.path(), &hash), "the bytes are gone from disk");
        assert!(
            crate::attachments::backfill::pending_object_fetch(&db).unwrap().is_empty(),
            "the worker will re-download within 30s everything the user just freed"
        );
        assert_eq!(
            attachment_local_bytes_inner(&db).unwrap(),
            0,
            "and the storage panel says the space is back"
        );
        // The row itself survives as a pointer, and its relay object is
        // untouched: freeing local disk says nothing about whether the
        // file should exist on the account.
        assert!(row_sync(&db, &hash));
        assert_eq!(object_key_of(&db, &hash).as_deref(), Some("obj-freed"));
    }

    /// Insert a pin whose cached content is a file block — what
    /// `refresh_pin_caches` freezes when the user pins an attachment,
    /// and what `pin-display.js::attachmentMetaOf` reads `blob_hash`
    /// back out of. `source_page_id` NULL is the ORPHANED pin of
    /// migration 013: the source page has been deleted and the cache
    /// is all that is left.
    fn insert_orphaned_file_pin(db: &Db, blob_hash: &str) {
        let conn = db.lock().unwrap();
        let content = serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "attachment",
                "attrs": { "blob_hash": blob_hash, "filename": "contract.pdf",
                           "mime_type": "application/pdf", "size_bytes": 37 }
            }]
        })
        .to_string();
        conn.execute(
            "INSERT INTO shared_objects \
               (id, lineage_id, source_page_id, object_type, title, content, status, position, created_at, updated_at) \
             VALUES ('pin-1', NULL, NULL, 'note', 'contract.pdf', ?1, 'orphaned', 0, \
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![content],
        )
        .unwrap();
    }

    /// FINDING 3 — GC MUST NOT DELETE A PINNED FILE.
    ///
    /// The reference scan read `pages.content_json` only. A pin does
    /// not live there: it caches its content and keeps a reference to
    /// its source page, and when that page is deleted the pin survives
    /// ORPHANED with the cache intact (migration 013 — "sunk, not
    /// shredded"). So the file the user explicitly kept is precisely
    /// the one no page names, and "free up space" deleted its only
    /// local copy — permanently, since the I5 fix also sets
    /// `gc_swept = 1` and every path back to the bytes checks that flag.
    #[test]
    fn gc_keeps_a_blob_that_only_an_orphaned_pin_still_references() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"the contract the user pinned before deleting the page";
        let hash = store::hash_hex(bytes);
        store::write_blob(dir.path(), &hash, bytes).unwrap();
        insert_row(&db, &hash, bytes.len() as i64, true);
        set_row_sync(&db, &hash, true);
        set_object_key(&db, &hash, "obj-pinned");
        insert_orphaned_file_pin(&db, &hash);

        assert_eq!(
            attachment_gc_inner(&db, dir.path()).unwrap(),
            0,
            "a pinned file is referenced — GC only ever sweeps orphans"
        );
        assert!(
            store::has_local(dir.path(), &hash),
            "the pin's only local copy was deleted; the relay object is alive but \
             pending_object_fetch skips gc_swept rows and attachment_open has no \
             fetch-on-demand, so the file is unrecoverable on this device"
        );
        assert!(!row_gc_swept(&db, &hash));
    }

    /// The other half of the same fix: a device that ALREADY swept a
    /// pinned file under the pages-only scan. Widening the scan stops
    /// the next loss; it does not give this user their file back. GC
    /// re-arms any swept row a reference now points at, which puts it
    /// back in `pending_object_fetch`'s sights — the relay object is
    /// still there.
    #[test]
    fn gc_re_arms_a_swept_blob_an_orphaned_pin_still_references() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = "already-lost-hash";
        // The bad state: row survives, bytes gone, flag set, pin intact.
        insert_row(&db, hash, 37, false);
        set_row_sync(&db, hash, true);
        set_object_key(&db, hash, "obj-still-on-relay");
        set_gc_swept(&db, hash, true);
        insert_orphaned_file_pin(&db, hash);
        assert!(
            crate::attachments::backfill::pending_object_fetch(&db).unwrap().is_empty(),
            "precondition: the swept flag is what shuts the only way back to the bytes"
        );

        attachment_gc_inner(&db, dir.path()).unwrap();

        assert!(!row_gc_swept(&db, hash));
        assert_eq!(
            crate::attachments::backfill::pending_object_fetch(&db).unwrap().len(),
            1,
            "the fetch sweep must now pull the pinned file back down"
        );
    }

    /// A doc whose only content is one file block — what the user sees
    /// after dropping an attachment onto the page.
    fn file_block_doc(blob_hash: &str) -> String {
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "attachment",
                "attrs": { "blob_hash": blob_hash, "filename": "contract.pdf",
                           "mime_type": "application/pdf", "size_bytes": 37 }
            }]
        })
        .to_string()
    }

    /// THE RETENTION INVARIANT `referenced_blob_hashes` DOCUMENTS, MADE
    /// EXECUTABLE.
    ///
    /// On a continuous trail the source of truth is `pages.yjs_state`,
    /// which this scan cannot read — the file survives "free up space"
    /// only because the save path also writes the `content_json`
    /// mirror. Driven through the real save path (`yjs_state` passed,
    /// exactly as a continuous-trail save does) rather than by
    /// INSERTing a page row, because the mirror is a property of that
    /// path and not of the schema: the day phase 14.19 stops flushing
    /// full content_json, this goes red instead of a user's file
    /// quietly going missing off a page that still shows it.
    #[test]
    fn gc_keeps_a_continuous_trail_blob_because_content_json_mirrors_yjs_state() {
        use yrs::{ReadTxn, StateVector, Text, Transact};
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"the contract dropped into a continuous doc";
        let hash = store::hash_hex(bytes);
        store::write_blob(dir.path(), &hash, bytes).unwrap();
        insert_row(&db, &hash, bytes.len() as i64, true);
        set_row_sync(&db, &hash, true);
        set_object_key(&db, &hash, "obj-continuous");
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO pages (id, date, page_number, created_at, updated_at) \
                 VALUES ('p-cont', '2026-08-09', 1, '2026-08-09T00:00:00Z', '2026-08-09T00:00:00Z')",
                [],
            )
            .unwrap();
        }

        // The continuous-trail save: CRDT bytes plus the derived mirror.
        let doc = yrs::Doc::new();
        let text = doc.get_or_insert_text("body");
        {
            let mut tx = doc.transact_mut();
            text.insert(&mut tx, 0, "contract.pdf");
        }
        let yjs_state = doc
            .transact()
            .encode_state_as_update_v2(&StateVector::default());
        crate::commands::save_page_content_inner(
            &db,
            "p-cont",
            &file_block_doc(&hash),
            Some(&yjs_state),
        )
        .unwrap();
        {
            let conn = db.lock().unwrap();
            let stored: Option<Vec<u8>> = conn
                .query_row("SELECT yjs_state FROM pages WHERE id = 'p-cont'", [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert!(
                stored.map(|v| !v.is_empty()).unwrap_or(false),
                "precondition: this is a page whose truth lives in the CRDT column"
            );
        }

        assert_eq!(
            attachment_gc_inner(&db, dir.path()).unwrap(),
            0,
            "the file is on the page — GC only ever sweeps orphans"
        );
        assert!(
            store::has_local(dir.path(), &hash),
            "content_json stopped mirroring yjs_state, so the scan cannot see a \
             hash that is only inside the CRDT: GC deleted a file the user is \
             still looking at"
        );
        assert!(!row_gc_swept(&db, &hash));
    }

    /// The re-arm is not a blanket amnesty: a genuine orphan the user
    /// swept stays swept, or "free up space" becomes a no-op plus a
    /// full re-download (the I5 defect). Asserting the empty result
    /// because that is the whole of I5 still holding — nothing
    /// references this hash, so nothing may un-sweep it.
    #[test]
    fn gc_leaves_an_unreferenced_swept_blob_swept() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = "orphan-hash";
        insert_row(&db, hash, 10, false);
        set_row_sync(&db, hash, true);
        set_object_key(&db, hash, "obj-orphan");
        set_gc_swept(&db, hash, true);

        attachment_gc_inner(&db, dir.path()).unwrap();

        assert!(row_gc_swept(&db, hash));
        assert!(
            crate::attachments::backfill::pending_object_fetch(&db).unwrap().is_empty(),
            "an explicit GC of a real orphan must stay done"
        );
    }

    /// The grace window is a stay of execution for a just-added file,
    /// not a reference — it must not un-sweep anything. A swept row
    /// that nothing points at stays swept even if its `created_at` is
    /// inside the hour.
    #[test]
    fn the_grace_window_does_not_re_arm_a_swept_blob() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = "fresh-orphan";
        insert_row(&db, hash, 10, false);
        set_row_sync(&db, hash, true);
        set_object_key(&db, hash, "obj-fresh");
        set_gc_swept(&db, hash, true);
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE attachments SET created_at = ?1 WHERE blob_hash = ?2",
                params![chrono::Utc::now().to_rfc3339(), hash],
            )
            .unwrap();
        }

        attachment_gc_inner(&db, dir.path()).unwrap();

        assert!(row_gc_swept(&db, hash), "recency is not a reference");
    }

    #[test]
    fn local_bytes_is_zero_for_empty_table() {
        let db = test_db();
        assert_eq!(attachment_local_bytes_inner(&db).unwrap(), 0);
    }

    // ── delete on un-sync (Task 6) ──────────────────────────────────

    /// See `backfill::tests::never_discard` — an object is only taken
    /// back off the relay when its reference could not be recorded, and
    /// nothing here is meant to hit that path.
    fn never_discard() -> impl FnMut(&str) -> Result<(), String> {
        |k: &str| panic!("nothing should have been deleted from the relay: {k}")
    }

    fn engine_for(db: &Db) -> crate::op_log::OpLog {
        let conn = db.lock().unwrap();
        std::sync::Arc::new(crate::op_log::OpLogEngine::load(&conn).unwrap())
    }

    fn set_row_sync(db: &Db, blob_hash: &str, sync: bool) {
        let conn = db.lock().unwrap();
        conn.execute(
            "UPDATE attachments SET sync = ?1 WHERE blob_hash = ?2",
            params![sync as i64, blob_hash],
        )
        .unwrap();
    }

    fn set_gc_swept(db: &Db, blob_hash: &str, swept: bool) {
        let conn = db.lock().unwrap();
        conn.execute(
            "UPDATE attachments SET gc_swept = ?1 WHERE blob_hash = ?2",
            params![swept as i64, blob_hash],
        )
        .unwrap();
    }

    fn row_gc_swept(db: &Db, blob_hash: &str) -> bool {
        let conn = db.lock().unwrap();
        conn.query_row(
            "SELECT gc_swept FROM attachments WHERE blob_hash = ?1",
            params![blob_hash],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            != 0
    }

    fn row_sync(db: &Db, blob_hash: &str) -> bool {
        let conn = db.lock().unwrap();
        conn.query_row(
            "SELECT sync FROM attachments WHERE blob_hash = ?1",
            params![blob_hash],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            != 0
    }

    fn setup_active_sync(db: &Db, base_url: &str) {
        let conn = db.lock().unwrap();
        crate::sync::config::set_relay_url(&conn, base_url).unwrap();
        crate::sync::config::set_enrollment(&conn, "u-test", "d-test", 1).unwrap();
        crate::sync::config::set_enabled(&conn, true).unwrap();
        let dk = crate::sync::keys::generate_device_keys();
        crate::sync::keys::persist_device_keys(&conn, &dk).unwrap();
    }

    /// The DELETE is addressed by the OBJECT KEY, not by blob_hash.
    /// blob_hash is sha256 of the plaintext and no object has ever
    /// existed at that path — a DELETE there returns 200 deleted:false,
    /// freeing nothing while the real object keeps costing the account
    /// its quota. The mock only answers the object-key path, so a
    /// regression to blob_hash fails this test rather than passing it
    /// quietly.
    #[test]
    fn set_sync_off_deletes_the_relay_object_by_its_object_key() {
        let server = MockServer::start();
        let db = test_db();
        setup_active_sync(&db, &server.base_url());
        insert_row(&db, "hash-x", 10, true);
        set_row_sync(&db, "hash-x", true);
        set_object_key(&db, "hash-x", "object-x");
        let engine = engine_for(&db);

        let del_mock = server.mock(|when, then| {
            when.method(DELETE).path("/v1/users/u-test/attachments/object-x");
            then.status(200).json_body(json!({ "deleted": true, "freed_bytes": 10 }));
        });
        let wrong_path = server.mock(|when, then| {
            when.method(DELETE).path("/v1/users/u-test/attachments/hash-x");
            then.status(200).json_body(json!({ "deleted": false, "freed_bytes": 0 }));
        });

        attachment_set_sync_inner(&db, &engine, "hash-x", false).unwrap();

        del_mock.assert();
        wrong_path.assert_hits(0);
        assert!(!row_sync(&db, "hash-x"));
        assert!(
            object_key_of(&db, "hash-x").is_none(),
            "the object is gone from the relay, so the row must stop claiming one — \
             otherwise re-enabling sync never re-uploads it"
        );
    }

    /// C1 — UN-SYNC MUST NOT BE A ONE-WAY DOOR.
    ///
    /// The test above asserts the row stops claiming an object and says
    /// in its own message that this is what lets a re-enable re-upload.
    /// It never exercised the re-enable, so it passed for as long as
    /// the re-enable was impossible: the reference op is in an
    /// append-only log and never goes away, and the upload gate treated
    /// "an attachment_blob op exists" as "an object exists on the
    /// relay". Every attachment the user ever toggled off was excluded
    /// from upload permanently.
    ///
    /// Drives the whole round trip through the real toggle: on (queues),
    /// upload (records the key + emits the reference), off (retracts and
    /// deletes), on again — and asserts the row is queued for upload a
    /// SECOND time.
    #[test]
    fn re_enabling_sync_after_an_un_sync_queues_the_upload_again() {
        let server = MockServer::start();
        let db = test_db();
        setup_active_sync(&db, &server.base_url());
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"the file the user changed their mind about twice";
        let hash = store::hash_hex(bytes);
        store::write_blob(dir.path(), &hash, bytes).unwrap();
        insert_row(&db, &hash, bytes.len() as i64, true);
        let engine = engine_for(&db);
        server.mock(|when, then| {
            when.method(DELETE).path_contains("/attachments/");
            then.status(200).json_body(json!({ "deleted": true, "freed_bytes": 10 }));
        });

        // on → the worker's sweep finds it, uploads, records the key and
        // emits the reference op.
        assert!(
            attachment_set_sync_inner(&db, &engine, &hash, true).unwrap(),
            "the off→on edge queues the upload"
        );
        let mut upload =
            |_: &[u8]| -> Result<(String, i64), String> { Ok(("obj-first".to_string(), 0)) };
        assert_eq!(
            crate::attachments::backfill::object_upload_with(&db, dir.path(), &engine, &mut upload, &mut never_discard())
                .unwrap(),
            1
        );
        assert_eq!(object_key_of(&db, &hash).as_deref(), Some("obj-first"));

        // off → the object is deleted and the reference retracted.
        attachment_set_sync_inner(&db, &engine, &hash, false).unwrap();
        assert!(object_key_of(&db, &hash).is_none());

        // on again → THIS is what was impossible. The op log still holds
        // the original reference (and now a retraction too); neither is
        // an object on the relay.
        assert!(
            attachment_set_sync_inner(&db, &engine, &hash, true).unwrap(),
            "re-enabling sync must queue the upload again — the op log records what was \
             said, not what is still on the relay"
        );
        assert_eq!(
            crate::attachments::backfill::pending_object_upload(&db).unwrap().len(),
            1,
            "and the worker's own sweep must find it, not just the toggle"
        );

        let mut upload =
            |_: &[u8]| -> Result<(String, i64), String> { Ok(("obj-second".to_string(), 0)) };
        assert_eq!(
            crate::attachments::backfill::object_upload_with(&db, dir.path(), &engine, &mut upload, &mut never_discard())
                .unwrap(),
            1
        );
        assert_eq!(object_key_of(&db, &hash).as_deref(), Some("obj-second"));
    }

    /// The retraction that stops peers 404-ing forever. A peer holding
    /// `(sync = 1, has_local = 0, object_key = K)` re-GETs K on every
    /// tick; the op log is append-only, so the reference that told it to
    /// cannot be withdrawn — only superseded.
    #[test]
    fn un_syncing_emits_a_retraction_naming_the_object_it_deleted() {
        let server = MockServer::start();
        let db = test_db();
        setup_active_sync(&db, &server.base_url());
        insert_row(&db, "hash-r", 4096, true);
        set_row_sync(&db, "hash-r", true);
        set_object_key(&db, "hash-r", "object-r");
        let engine = engine_for(&db);
        server.mock(|when, then| {
            when.method(DELETE).path_contains("/attachments/");
            then.status(200).json_body(json!({ "deleted": true, "freed_bytes": 4096 }));
        });

        attachment_set_sync_inner(&db, &engine, "hash-r", false).unwrap();

        let payload: Vec<u8> = {
            let conn = db.lock().unwrap();
            conn.query_row(
                "SELECT payload_blob FROM op_log WHERE op_kind = 'attachment_blob' AND doc_id = ?1",
                params!["hash-r"],
                |r| r.get(0),
            )
            .expect("the retraction was emitted")
        };
        let parsed: crate::sync::wire::attachment_blob::AttachmentBlobPayload =
            serde_json::from_slice(&payload).unwrap();
        assert!(
            crate::sync::wire::attachment_blob::payload_is_revocation(&parsed),
            "the op peers pull must say the reference is retracted, not repeat it"
        );
        assert_eq!(
            parsed.object_key.as_deref(),
            Some("object-r"),
            "it retracts ONE object — a peer holding a different key for the same file \
             still has a live object of its own"
        );
    }

    /// A toggle-off for a file that was never uploaded has nothing to
    /// retract, and must not emit an op saying otherwise. Asserting the
    /// absence because a spurious retraction is not harmless: it names
    /// no object key, and a receiver that acted on it would have to
    /// guess which of the account's objects to forget.
    #[test]
    fn un_syncing_something_never_uploaded_emits_no_retraction() {
        let db = test_db();
        insert_row(&db, "hash-q", 10, true);
        set_row_sync(&db, "hash-q", true);
        let engine = engine_for(&db);

        attachment_set_sync_inner(&db, &engine, "hash-q", false).unwrap();

        let conn = db.lock().unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM op_log WHERE op_kind = 'attachment_blob'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
    }

    /// Un-syncing something that was never uploaded has nothing to tell
    /// the relay. Asserting the absence of the call because the
    /// alternative is a DELETE at a path that never existed: harmless in
    /// isolation, but it is exactly the shape of the blob_hash bug above
    /// and would let it pass unnoticed.
    #[test]
    fn set_sync_off_without_an_object_calls_no_delete() {
        let server = MockServer::start();
        let db = test_db();
        setup_active_sync(&db, &server.base_url());
        insert_row(&db, "hash-never-up", 10, true);
        set_row_sync(&db, "hash-never-up", true);
        let engine = engine_for(&db);

        let del_mock = server.mock(|when, then| {
            when.method(DELETE).path_contains("/attachments/");
            then.status(200).json_body(json!({ "deleted": false, "freed_bytes": 0 }));
        });

        attachment_set_sync_inner(&db, &engine, "hash-never-up", false).unwrap();

        del_mock.assert_hits(0);
        assert!(!row_sync(&db, "hash-never-up"));
    }

    #[test]
    fn set_sync_on_never_calls_delete() {
        let server = MockServer::start();
        let db = test_db();
        setup_active_sync(&db, &server.base_url());
        // has_local so should_enqueue_blob's other paths don't matter here —
        // only that turning sync ON must never hit the DELETE endpoint.
        insert_row(&db, "hash-y", 10, true);
        let engine = engine_for(&db);

        let del_mock = server.mock(|when, then| {
            when.method(DELETE).path("/v1/users/u-test/attachments/hash-y");
            then.status(200).json_body(json!({ "deleted": true, "freed_bytes": 10 }));
        });

        attachment_set_sync_inner(&db, &engine, "hash-y", true).unwrap();

        del_mock.assert_hits(0);
        assert!(row_sync(&db, "hash-y"));
    }

    #[test]
    fn off_to_off_is_a_noop_edge_and_never_calls_delete() {
        let server = MockServer::start();
        let db = test_db();
        setup_active_sync(&db, &server.base_url());
        insert_row(&db, "hash-v", 10, true);
        let engine = engine_for(&db);

        let del_mock = server.mock(|when, then| {
            when.method(DELETE).path("/v1/users/u-test/attachments/hash-v");
            then.status(200).json_body(json!({ "deleted": true, "freed_bytes": 10 }));
        });

        attachment_set_sync_inner(&db, &engine, "hash-v", false).unwrap();

        del_mock.assert_hits(0);
    }

    // Un-syncing is a statement about the relay, not this device: a failed
    // delete must not resurrect the sync flag or return an error the
    // frontend would surface as a failed toggle.
    #[test]
    fn a_failed_relay_delete_does_not_block_the_toggle() {
        let db = test_db();
        // Unreachable port — deterministic transport failure, same
        // technique sync::upload's own tests use.
        setup_active_sync(&db, "http://127.0.0.1:1");
        insert_row(&db, "hash-z", 10, true);
        set_row_sync(&db, "hash-z", true);
        let engine = engine_for(&db);

        set_object_key(&db, "hash-z", "object-z");
        attachment_set_sync_inner(&db, &engine, "hash-z", false)
            .expect("a relay delete failure must not surface as a command error");

        assert!(!row_sync(&db, "hash-z"), "the local flag still flips off");
    }

    // Sync not configured/active at all: the on->off edge has nothing to
    // tell a relay that doesn't exist yet, and must not try.
    #[test]
    fn on_to_off_edge_without_active_sync_is_a_local_only_toggle() {
        let db = test_db();
        insert_row(&db, "hash-w", 10, true);
        set_row_sync(&db, "hash-w", true);
        let engine = engine_for(&db);

        attachment_set_sync_inner(&db, &engine, "hash-w", false).unwrap();

        assert!(!row_sync(&db, "hash-w"));
    }
}

fn mime_guess_for(filename: &str) -> Option<String> {
    let lower = filename.to_lowercase();
    let dot = lower.rfind('.')?;
    let ext = &lower[dot + 1..];
    Some(
        match ext {
            "pdf" => "application/pdf",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            "webp" => "image/webp",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "zip" => "application/zip",
            "txt" | "md" => "text/plain",
            "json" => "application/json",
            "csv" => "text/csv",
            _ => return None,
        }
        .to_string(),
    )
}
