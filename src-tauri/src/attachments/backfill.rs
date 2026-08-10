//! Phase 2 of the image/attachment unification: convert `localImage` nodes
//! in existing pages into `attachment` nodes with `kind: "image"`.
//!
//! Phase 1 moved *new* image inserts onto the blob store, leaving pages
//! written before the change on the old node type. Those still render (the
//! localImage extension stays registered), but they have no blob_hash, no
//! attachments row, and therefore no per-image sync toggle. This sweep
//! gives them one.
//!
//! Rules that matter (design spec §5):
//!   - Registration goes through `commands::insert_attachment` — the same
//!     function new inserts use, not a parallel copy. Content addressing
//!     means the same picture on two pages dedupes to one blob for free.
//!   - `sync: false`. A backfill must never be the reason bytes leave the
//!     device; the user opts in per image, as with files.
//!   - All-or-nothing per page, across the images that *can* convert. A
//!     page is only rewritten once every candidate in it converted.
//!   - A missing or unreadable original skips that page for this run and
//!     leaves it untouched, to be retried next launch. It never aborts the
//!     sweep for other pages.
//!   - A node with no `localPath` is not a candidate at all — see
//!     [`is_convertible`]. The spec's all-or-nothing rule assumed every
//!     failure was transient; running this against a real pre-Phase-1
//!     library showed most of its nodes were dead `blob:` object URLs whose
//!     bytes never existed on disk. Counting those as retryable meant no
//!     page ever converted and every launch re-attempted them.
//!   - Originals under `images/` are never deleted. Cost is disk only.
//!   - Idempotent: only pages still holding a localImage node are scanned.

use crate::attachments::commands::{insert_attachment, AttachmentDto};
use crate::db::Db;
use serde_json::{json, Value};

/// Human label for a converted image. The old insert path stored the
/// user's original filename in `alt`, so prefer that; fall back to the
/// basename of the managed path (uuid-named, but better than nothing).
pub fn local_image_filename(attrs: &Value) -> String {
    if let Some(alt) = attrs.get("alt").and_then(|v| v.as_str()) {
        let alt = alt.trim();
        if !alt.is_empty() {
            return alt.to_string();
        }
    }
    let path = attrs
        .get("localPath")
        .and_then(|v| v.as_str())
        .or_else(|| attrs.get("src").and_then(|v| v.as_str()))
        .unwrap_or("");
    path.rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("image")
        .to_string()
}

/// Old `localImage` attrs + the freshly registered blob → new `attachment`
/// attrs. Layout attrs carry over verbatim so nothing shifts on the page.
pub fn converted_attrs(old: &Value, dto: &AttachmentDto) -> Value {
    json!({
        "kind": "image",
        "blob_hash": dto.blob_hash,
        "filename": dto.filename,
        "mime_type": dto.mime_type,
        "size_bytes": dto.size_bytes,
        "sync": dto.sync,
        "created_at": dto.created_at,
        // Carried over from the old node so the picture keeps its size,
        // its block/inline placement and its collapsed state.
        "width": old.get("width").cloned().unwrap_or(Value::Null),
        "display": old
            .get("display")
            .cloned()
            .filter(|v| v.is_string())
            .unwrap_or_else(|| json!("block")),
        "collapsed": old
            .get("collapsed")
            .cloned()
            .filter(|v| v.is_boolean())
            .unwrap_or_else(|| json!(false)),
    })
}

/// Is this node's original recoverable at all?
///
/// A `localImage` written by the old paste path can carry
/// `src: "blob:tauri://localhost/<uuid>"` with a null `localPath` — an
/// in-memory object URL that died with the session that made it. The bytes
/// were never persisted, so the picture is already broken and no run,
/// now or later, can convert it.
///
/// That's a different thing from a node whose file is temporarily
/// unreadable: the latter defers its page and is retried, the former is
/// simply not a candidate. Without the distinction one dead node kept a
/// whole page — including the real images beside it — unconverted forever,
/// and had the sweep re-attempt it on every launch.
pub fn is_convertible(attrs: &Value) -> bool {
    attrs
        .get("localPath")
        .and_then(|v| v.as_str())
        .is_some_and(|p| !p.trim().is_empty())
}

/// Does this doc still hold a `localImage` node?
pub fn has_local_image(node: &Value) -> bool {
    if let Some(obj) = node.as_object() {
        if obj.get("type").and_then(|t| t.as_str()) == Some("localImage") {
            return true;
        }
        return obj.values().any(has_local_image);
    }
    if let Some(arr) = node.as_array() {
        return arr.iter().any(has_local_image);
    }
    false
}

/// Rewrite every `localImage` node in `node` into an `attachment` node,
/// asking `register` for the replacement attrs.
///
/// Returns how many nodes were converted. Any error from `register`
/// propagates immediately and the caller discards the partially-mutated
/// doc — that's what makes the per-page commit all-or-nothing.
pub fn convert_doc<F>(node: &mut Value, register: &mut F) -> Result<usize, String>
where
    F: FnMut(&Value) -> Result<Value, String>,
{
    let mut converted = 0;

    if let Some(obj) = node.as_object_mut() {
        if obj.get("type").and_then(|t| t.as_str()) == Some("localImage") {
            let old_attrs = obj.get("attrs").cloned().unwrap_or_else(|| json!({}));
            // Dead reference: leave it exactly as it is and don't count it.
            // It renders as it always did, and the page's real images are
            // free to convert around it.
            if !is_convertible(&old_attrs) {
                return Ok(0);
            }
            let new_attrs = register(&old_attrs)?;
            obj.insert("type".into(), json!("attachment"));
            obj.insert("attrs".into(), new_attrs);
            // A localImage is a leaf; nothing below it to walk.
            return Ok(1);
        }
        for v in obj.values_mut() {
            converted += convert_doc(v, register)?;
        }
        return Ok(converted);
    }

    if let Some(arr) = node.as_array_mut() {
        for v in arr.iter_mut() {
            converted += convert_doc(v, register)?;
        }
    }
    Ok(converted)
}

/// One page's worth of work: parse, convert every image, save.
/// `Ok(0)` means nothing to do; an `Err` leaves the page exactly as it was.
fn convert_page<F>(
    db: &Db,
    page_id: &str,
    content_json: &str,
    register: &mut F,
) -> Result<usize, String>
where
    F: FnMut(&Value) -> Result<Value, String>,
{
    let mut doc: Value = serde_json::from_str(content_json).map_err(|e| e.to_string())?;

    let converted = convert_doc(&mut doc, register)?;
    if converted == 0 {
        return Ok(0);
    }

    let rewritten = serde_json::to_string(&doc).map_err(|e| e.to_string())?;
    // Through the normal save path so FTS and the op_log see this exactly
    // like any other content write.
    crate::commands::save_page_content_inner(db, page_id, &rewritten, None)?;
    Ok(converted)
}

/// Pages still holding a localImage node. The LIKE is a cheap prefilter —
/// `has_local_image` on the parsed doc is what actually decides.
fn pages_with_local_images(db: &Db) -> Result<Vec<(String, String)>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, content_json FROM pages \
             WHERE content_json IS NOT NULL AND content_json LIKE '%localImage%'",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Outcome of one sweep, for the log line and for tests.
#[derive(Debug, Default, PartialEq)]
pub struct SweepReport {
    pub pages_converted: usize,
    pub images_converted: usize,
    /// Pages left for a later run (unreadable original, bad JSON, …).
    pub pages_skipped: usize,
}

/// Convert every page that still holds a localImage node, registering each
/// image through `register`.
///
/// Split out from [`run_sweep`] so the sweep's real behaviour — multi-page,
/// dedup, all-or-nothing, skip-and-retry — is testable without an
/// `AppHandle`, which a unit test can't construct.
pub fn sweep_with<F>(db: &Db, register: &mut F) -> Result<SweepReport, String>
where
    F: FnMut(&Value) -> Result<Value, String>,
{
    let mut report = SweepReport::default();
    for (page_id, content_json) in pages_with_local_images(db)? {
        match convert_page(db, &page_id, &content_json, register) {
            Ok(0) => {}
            Ok(n) => {
                report.pages_converted += 1;
                report.images_converted += n;
            }
            Err(e) => {
                // This page keeps its old nodes and is retried next launch.
                log::warn!("image backfill skipped page {page_id}: {e}");
                report.pages_skipped += 1;
            }
        }
    }
    Ok(report)
}

/// Convert every page that still holds a localImage node, reading the
/// original bytes off disk and registering them in the blob store.
pub fn run_sweep(
    app: &tauri::AppHandle,
    db: &Db,
    engine: &crate::op_log::OpLog,
) -> Result<SweepReport, String> {
    let mut register = |old: &Value| -> Result<Value, String> {
        let path = old
            .get("localPath")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "localImage has no localPath".to_string())?;
        let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
        let filename = local_image_filename(old);
        // sync: false — a backfill is never the reason bytes leave the device.
        let dto = insert_attachment(app, db, engine, bytes, filename, None, false)?;
        Ok(converted_attrs(old, &dto))
    };
    sweep_with(db, &mut register)
}

/// Have this attachment's BYTES already been handed to the account
/// inside an op, rather than as an object?
///
/// True only for a COMMITTED, INLINE `attachment_blob` op this device
/// emitted — the legacy shape, where `chunks_b64` carries the whole
/// file. Those bytes are already on the relay and already reachable by
/// every peer; re-uploading them as an object would spend the account's
/// quota twice for one file.
///
/// THE THREE QUALIFIERS ARE EACH LOAD-BEARING, and getting this wrong
/// is what made un-sync a one-way door:
///
///   - INLINE. A REFERENCE op delivers no bytes, only an address. Once
///     that address is gone — un-synced and deleted, or never uploaded
///     at all by an early build of this branch — the op is a pointer to
///     nothing and the file must be uploadable again. Treating "an
///     `attachment_blob` op exists" as "an object exists on the relay"
///     excluded exactly those rows from upload permanently.
///   - COMMITTED. An inline op still sitting in `local_only` /
///     `pending_upload` never reached the relay. The 1.28 MB file that
///     started this work has one of those: refused with 413 on every
///     tick, forever. Its bytes have been delivered to nobody.
///   - `doc_id` is set. Ops received FROM peers are stored with
///     `doc_id NULL` (`sync::pull::apply_remote_op`), so this only ever
///     sees what this device published — which is the right question:
///     "did I already deliver these bytes inline?"
pub fn delivered_inline(conn: &rusqlite::Connection, blob_hash: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(
            "SELECT payload_blob FROM op_log \
             WHERE op_kind = 'attachment_blob' AND doc_id = ?1 AND state = 'committed'",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![blob_hash], |r| r.get::<_, Vec<u8>>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().any(|payload| {
        serde_json::from_slice::<crate::sync::wire::attachment_blob::AttachmentBlobPayload>(payload)
            .map(|p| !crate::sync::wire::attachment_blob::payload_is_reference(&p))
            .unwrap_or(false)
    }))
}

/// Attachments the user authorised to sync whose bytes are not on the
/// relay: `sync = 1`, the bytes are here, and there is no object for
/// them.
///
/// This is the durable restatement of [`crate::attachments::commands::
/// should_enqueue_blob`] — same three conditions (consent, bytes
/// present, nothing delivered yet) minus the edge, so a missed off→on
/// edge self-heals instead of being lost forever. On a real library two
/// attachments sat in exactly that state — sync = 1, no object — and
/// would never have uploaded.
///
/// A row that has failed recently is held back until
/// `upload_retry_at_ms` (see [`upload_retry_delay_ms`]). Without it a
/// permanently failing attachment re-sent its whole body twice a
/// minute for as long as the app ran, and — because this sweep runs
/// before `upload::run_pass` on the worker's tick — held every page
/// and op behind it.
///
/// `object_key IS NULL` is the whole self-limiting condition: a
/// successful upload writes it in the same transaction that emits the
/// reference, so the row stops matching and an attachment is never
/// uploaded twice. It is also what RE-ARMS the row when the user
/// un-syncs and later re-syncs — the toggle clears the key because the
/// object is genuinely gone, and the row becoming pending again is the
/// correct consequence, not a bug to be guarded against.
///
/// [`delivered_inline`] is the only other exclusion, and it is narrow on
/// purpose: it means "these exact bytes already went out inside a
/// committed op", which is the one case where uploading an object would
/// pay for the same file twice.
pub fn pending_object_upload(db: &Db) -> Result<Vec<(String, Option<String>)>, String> {
    pending_object_upload_at(db, now_ms())
}

/// Wall-clock milliseconds since the epoch. One place, so the backoff
/// arithmetic and the column it writes can't drift.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// How long to wait before trying an attachment upload again, after
/// `attempts` consecutive failures.
///
/// One minute, doubling, capped at an hour. The tick is 30 seconds, so
/// without this a permanently failing attachment — a file too big for
/// the account's uplink, a relay refusing it, a quota that stays full —
/// re-sent its whole body twice a minute for as long as the app ran.
/// Each attempt seals under a fresh per-object UUID, so any PUT the
/// relay committed before the client gave up left a distinct orphan on
/// a relay whose orphan GC bails out.
///
/// Capped rather than unbounded because the failure is usually
/// transient from the user's point of view (a different network
/// tomorrow), and an hour is short enough that they never have to know
/// this exists.
pub fn upload_retry_delay_ms(attempts: i64) -> i64 {
    const BASE_MS: i64 = 60_000;
    const CAP_MS: i64 = 60 * 60_000;
    if attempts <= 1 {
        return BASE_MS;
    }
    let shift = (attempts - 1).min(16) as u32;
    BASE_MS.saturating_mul(1i64 << shift).min(CAP_MS)
}

/// [`pending_object_upload`] at an explicit wall clock, so the backoff
/// is testable without sleeping.
pub fn pending_object_upload_at(
    db: &Db,
    now_ms: i64,
) -> Result<Vec<(String, Option<String>)>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT a.blob_hash, a.mime_type FROM attachments a \
             WHERE a.sync = 1 AND a.has_local = 1 AND a.object_key IS NULL \
               AND a.upload_retry_at_ms <= ?1 \
             ORDER BY a.size_bytes",
        )
        .map_err(|e| e.to_string())?;
    let candidates = stmt
        .query_map(rusqlite::params![now_ms], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::with_capacity(candidates.len());
    for (blob_hash, mime_type) in candidates {
        if !delivered_inline(&conn, &blob_hash)? {
            rows.push((blob_hash, mime_type));
        }
    }
    Ok(rows)
}

/// Record one failed upload attempt and hold the row back until the
/// backoff expires. Best-effort: a row that cannot be updated is simply
/// retried on the next tick, which is the behaviour this replaces.
fn back_off(db: &Db, blob_hash: &str, now_ms: i64) {
    let Ok(conn) = db.lock() else { return };
    let attempts: i64 = conn
        .query_row(
            "SELECT upload_attempts FROM attachments WHERE blob_hash = ?1",
            rusqlite::params![blob_hash],
            |r| r.get(0),
        )
        .unwrap_or(0)
        + 1;
    let retry_at = now_ms.saturating_add(upload_retry_delay_ms(attempts));
    if let Err(e) = conn.execute(
        "UPDATE attachments SET upload_attempts = ?1, upload_retry_at_ms = ?2 \
         WHERE blob_hash = ?3",
        rusqlite::params![attempts, retry_at, blob_hash],
    ) {
        log::warn!("object upload: could not record the failed attempt for {blob_hash}: {e}");
    }
}

/// What a failed upload attempt knows.
///
/// `object_key` is the whole point. A PUT that returns an error has NOT
/// necessarily left the relay untouched: the client gives the transfer a
/// whole-request deadline (`attachment_object::OBJECT_TRANSFER_DEADLINE`),
/// and a relay that commits the body a second after that expires holds
/// an object this device is about to decide never existed. Nothing
/// reclaims it — the relay's `gc_orphan_blobs` bails out — so it is
/// permanent, and it is charged to the user's quota. Carrying the key
/// out with the error is what makes the discard reachable at all; it
/// used to be computed inside the upload closure and dropped on the
/// floor when that closure returned `Err`.
///
/// `None` means no bytes can have reached the relay, because the attempt
/// failed before the key existed (no content key for the current epoch,
/// for instance). There is nothing to take back in that case.
#[derive(Debug, Clone)]
pub struct UploadFailure {
    pub object_key: Option<String>,
    pub error: String,
}

/// A failure that never got as far as a PUT. Lets a caller (and every
/// existing test closure) keep failing with a plain `String` and mean
/// exactly "nothing left this device".
impl From<String> for UploadFailure {
    fn from(error: String) -> Self {
        UploadFailure {
            object_key: None,
            error,
        }
    }
}

impl From<&str> for UploadFailure {
    fn from(error: &str) -> Self {
        UploadFailure::from(error.to_string())
    }
}

/// Upload every attachment [`pending_object_upload`] finds and emit its
/// reference op — in that order, never the reverse. Smallest first, so a
/// 21 MB file can't hold up the small ones behind it.
///
/// Split from [`run_object_upload_at`] the way [`object_fetch_with`] is
/// split from [`run_object_fetch_at`]: `upload` receives the plaintext
/// and returns the object key it landed under AND the key epoch it
/// sealed under, so the sealing and the HTTP PUT are testable separately
/// from the ordering rule this function exists to enforce.
///
/// The epoch comes back OUT of `upload` rather than being read here on
/// the way in, and that direction is deliberate: the only epoch worth
/// recording is the one the bytes on the relay are actually sealed with.
/// Reading it separately would let the two disagree, and a reference
/// naming an epoch the object wasn't sealed under is unopenable
/// forever.
///
/// THE ORDER IS THE POINT. `emit_attachment_blob` runs only after
/// `upload` returned Ok. A failed upload leaves the row exactly as it
/// was — no `object_key`, no op — so the next tick retries it, and no
/// peer ever sees a reference to an object that isn't there.
///
/// Never holds the db lock across the network call: the pending list and
/// the plaintext are read first, the guard is dropped, the PUT happens,
/// and the lock is re-acquired only to record the result.
pub fn object_upload_with<F, G, E>(
    db: &Db,
    app_dir: &std::path::Path,
    engine: &crate::op_log::OpLog,
    upload: &mut F,
    discard: &mut G,
) -> Result<usize, String>
where
    F: FnMut(&[u8]) -> Result<(String, i64), E>,
    E: Into<UploadFailure>,
    G: FnMut(&str) -> Result<(), String>,
{
    object_upload_with_at(db, app_dir, engine, upload, discard, now_ms())
}

/// [`object_upload_with`] at an explicit wall clock. Only the retry
/// backoff reads it, and only a test ever passes anything but now — but
/// it has to be injectable, because the alternative way to exercise a
/// one-minute backoff is to sleep for a minute.
pub fn object_upload_with_at<F, G, E>(
    db: &Db,
    app_dir: &std::path::Path,
    engine: &crate::op_log::OpLog,
    upload: &mut F,
    discard: &mut G,
    now_ms: i64,
) -> Result<usize, String>
where
    F: FnMut(&[u8]) -> Result<(String, i64), E>,
    E: Into<UploadFailure>,
    G: FnMut(&str) -> Result<(), String>,
{
    let mut uploaded = 0;
    for (blob_hash, mime_type) in pending_object_upload_at(db, now_ms)? {
        // Read off disk, not out of the DB: the object body is the
        // file's real bytes, and `size_bytes` on the row came from
        // whatever wrote it.
        let bytes = match crate::attachments::store::read_blob(app_dir, &blob_hash) {
            Ok(Some(b)) => b,
            Ok(None) => {
                // has_local said the bytes were here and they aren't.
                // Skip; the next tick retries.
                log::warn!("object upload: {blob_hash} is not in the blob store");
                continue;
            }
            Err(e) => {
                log::warn!("object upload: read {blob_hash}: {e}");
                continue;
            }
        };
        let size_bytes = bytes.len() as i64;
        let (object_key, object_epoch) = match upload(&bytes) {
            Ok(k) => k,
            Err(e) => {
                // Relay down, quota reached, a 429, or no key for the
                // current epoch — all retryable, and all of them must
                // leave the op unemitted. Retryable is not the same as
                // "retry in 30 seconds forever", though: back the row
                // off so a file that cannot get through stops re-sending
                // its whole body twice a minute.
                let UploadFailure { object_key, error } = e.into();
                log::warn!("object upload: put {blob_hash}: {error}");
                back_off(db, &blob_hash, now_ms);
                // AND THE SAME DISCARD ITS SIBLING ARMS DO. "The PUT
                // failed" is not "the relay has nothing": the transfer
                // carries a whole-request deadline, and a relay that
                // commits just after it expires keeps an object no op
                // will ever name. Its `gc_orphan_blobs` bails out, so
                // that object is permanent and it is charged to the
                // user. Every retry seals under a fresh per-object UUID,
                // so each timed-out-but-committed attempt strands
                // another one.
                //
                // Deleting is safe precisely because of that fresh UUID:
                // this key belongs to this attempt and to nothing else,
                // so a DELETE cannot touch an object any row or op still
                // points at. It is idempotent too — a key the relay
                // never stored answers 200 `deleted: false`.
                if let Some(object_key) = object_key {
                    if let Err(e) = discard(&object_key) {
                        log::warn!(
                            "object upload: could not delete the possibly-committed object \
                             {object_key} for {blob_hash}; if the relay did commit it, it is \
                             orphaned on a relay with no orphan GC: {e}"
                        );
                    }
                }
                continue;
            }
        };
        // ONE TRANSACTION. Recording the key and emitting the reference
        // are one statement — "the bytes are at K, and here is the
        // pointer" — and either both survive or neither does.
        //
        // Split, they had a window with no owner: the UPDATE committed
        // in autocommit mode, `emit_attachment_blob` was a separate
        // statement, and it went through `try_apply`, which swallows
        // every error at warn level by design. A crash (or a disk-full
        // op_log INSERT) between them left `object_key IS NOT NULL` with
        // no reference op anywhere. The row stops matching
        // `pending_object_upload`, no peer has ever heard of the file,
        // the toggle still reads "on", and nothing in the codebase looks
        // for that state. The 40 MB was paid for and delivered to
        // no one.
        let record = (|| -> Result<bool, String> {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            // CONSENT IS RE-READ HERE, not where the pending list was
            // built. The PUT above is the whole window — tens of
            // seconds for a large file — and the user can flip the
            // toggle off inside it. That toggle saw `object_key = NULL`
            // (nothing had been recorded yet), so it sent no DELETE and
            // emitted no retraction: it had nothing to retract. If this
            // sweep then recorded the key and emitted the reference
            // anyway, the revocation would be silently ignored, the
            // pointer would go out to every peer, and the only way back
            // would be to toggle on and off again.
            //
            // Inside the transaction, so there is no window between the
            // check and the write: the toggle takes the same lock.
            let still_synced: bool = tx
                .query_row(
                    "SELECT sync FROM attachments WHERE blob_hash = ?1",
                    rusqlite::params![&blob_hash],
                    |r| r.get::<_, i64>(0),
                )
                .map(|v| v != 0)
                .unwrap_or(false);
            if !still_synced {
                return Ok(false);
            }
            tx.execute(
                "UPDATE attachments \
                 SET object_key = ?1, object_epoch = ?2, size_bytes = ?3, \
                     upload_attempts = 0, upload_retry_at_ms = 0 \
                 WHERE blob_hash = ?4",
                rusqlite::params![&object_key, object_epoch, size_bytes, &blob_hash],
            )
            .map_err(|e| e.to_string())?;
            crate::op_log::emit_attachment_blob(
                engine,
                &tx,
                &blob_hash,
                mime_type.as_deref(),
                size_bytes,
                &object_key,
                object_epoch,
            )?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(true)
        })();
        if let Ok(false) = record {
            // The user revoked while the bytes were in flight. Nothing
            // was recorded and nothing was published, so the object on
            // the relay is unreferenced — and the relay has no orphan
            // GC, so leaving it there means the user's revocation costs
            // them quota forever. Take it back.
            log::info!(
                "object upload: {blob_hash} was un-synced while its object was in flight; \
                 deleting {object_key} instead of recording it"
            );
            if let Err(e) = discard(&object_key) {
                log::warn!(
                    "object upload: could not delete the revoked object {object_key} \
                     for {blob_hash}; it is orphaned on a relay with no orphan GC: {e}"
                );
            }
            continue;
        }
        if let Err(e) = record {
            // The object is on the relay but nothing local records it.
            // The rollback is what makes that recoverable: the row keeps
            // `object_key IS NULL`, stays pending, and the next tick
            // uploads again (a fresh per-object UUID, so a fresh key).
            //
            // KNOWN COST: the object just PUT is now unreferenced. The
            // relay's `gc_orphan_blobs` (shizumu-relay src/main.rs) bails
            // with "gc-orphan-blobs requires ObjectStore.list_keys
            // (v0.2)", so nothing sweeps it and it consumes the account's
            // paid quota until someone deletes it by hand. `discard`
            // exists to take it back; a failure there is logged and
            // nothing more, because the alternative — keeping a key whose
            // op was rolled back — is the stranding this transaction
            // exists to prevent.
            log::warn!("object upload: record reference for {blob_hash}: {e}");
            back_off(db, &blob_hash, now_ms);
            if let Err(e) = discard(&object_key) {
                log::warn!(
                    "object upload: could not delete the unreferenced object {object_key} \
                     for {blob_hash}; it is orphaned on a relay with no orphan GC: {e}"
                );
            }
            continue;
        }
        uploaded += 1;
    }
    Ok(uploaded)
}

/// Seal, upload and reference every pending attachment. Thin
/// network-facing wrapper around [`object_upload_with`].
///
/// The object body is CIPHERTEXT and its key is `blake3(ciphertext)`,
/// because that is what the relay verifies the body against and the
/// relay must never hold plaintext. Sealing is
/// `sync::envelope::encrypt_op` under a random per-object UUID: the
/// UUID travels in the ciphertext's own 16-byte prefix, so any device
/// holding the account's content key can derive the subkey and decrypt
/// without the op having to carry key material. A fresh UUID per upload
/// means the same file encrypted twice lands under two different object
/// keys — no cross-device dedupe at the relay, accepted by design;
/// local dedupe is by `sha256(plaintext)` and is unaffected.
///
/// `encrypt_op` and not `op_auth::seal_authored` — which is what an OP
/// is sealed with — for two reasons, one fatal and one structural:
///
///   - `seal_authored` base64s its payload into a JSON envelope. A
///     100 MB attachment (the product ceiling, `insert_attachment`)
///     would become ~133 MB of base64 inside a JSON string before
///     encryption: past `MAX_BLOB_BYTES`, so no peer could ever accept
///     it back, and several times the file's size in peak memory.
///   - What `seal_authored` adds over `encrypt_op` is the author
///     attestation chain, which `merge` verifies per op. This object
///     isn't an op and isn't merged; its provenance comes from the
///     reference op that names it — an authored, verified op — and its
///     content is checked against that op's `blob_hash` after decrypt.
///
/// This is not a second crypto path: `seal_authored`'s own last line is
/// `envelope::encrypt_op`, the same AEAD under the same account key.
///
/// The key it seals with is the CURRENT EPOCH's content key, not
/// `user_keys.content_master_key` — see [`seal_epoch_and_key`]. Sealing
/// everything under the phrase-derived key meant a device revoked at
/// epoch N could still read every attachment uploaded after its
/// revocation, because it kept the epoch-0 key forever.
pub fn run_object_upload_at(
    db: &Db,
    app_dir: &std::path::Path,
    base_url: &str,
    user_id: &str,
    device_keys: &crate::sync::keys::DeviceKeys,
    user_keys: &crate::sync::keys::UserKeys,
    engine: &crate::op_log::OpLog,
) -> Result<usize, String> {
    let mut upload = |plaintext: &[u8]| -> Result<(String, i64), UploadFailure> {
        // Resolve the epoch and its key under a short-lived lock, then
        // drop it: the PUT below is a network call and must never run
        // with the DB held.
        //
        // A failure HERE carries no object key, and correctly so: it is
        // upstream of the seal, so no bytes and no key ever existed.
        let (epoch, content_key) = {
            let conn = db
                .lock()
                .map_err(|e| UploadFailure::from(e.to_string()))?;
            seal_epoch_and_key(&conn, user_keys).map_err(UploadFailure::from)?
        };
        let (object_key, ciphertext) = seal_object(&content_key, plaintext);
        match crate::sync::wire::attachment_object::put_attachment(
            base_url,
            device_keys,
            user_id,
            &object_key,
            ciphertext,
        ) {
            Ok(_) => Ok((object_key, epoch)),
            // The key goes out WITH the error. This is the only frame
            // that knows it, and the caller cannot take the object back
            // without it — see `UploadFailure`. A timeout is not proof
            // the relay committed nothing.
            Err(e) => Err(UploadFailure {
                object_key: Some(object_key),
                error: e.to_string(),
            }),
        }
    };
    // The other direction: take an object back off the relay whenever
    // its reference did not land — because the local record could not be
    // written, because consent was withdrawn mid-flight, or because the
    // PUT itself failed in a way that may still have committed. Nothing
    // else reclaims it — the relay has no orphan GC — so an object whose
    // reference never landed has to be deleted here or it is paid for
    // forever.
    let mut discard = |object_key: &str| -> Result<(), String> {
        crate::sync::wire::attachment_object::delete_attachment(
            base_url,
            device_keys,
            user_id,
            object_key,
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    };
    object_upload_with(db, app_dir, engine, &mut upload, &mut discard)
}

/// The epoch a new attachment object must be sealed under, and the
/// content key for it.
///
/// THE SAME SOURCE THE OP LOG USES. `op_log::dispatch`'s `apply` stamps
/// every new op with `sync::config::get_current_epoch(conn)`; this reads
/// that identical `sync_state.current_epoch` row. There is deliberately
/// no second notion of "the current epoch" that could drift from the
/// one ops are stamped with.
///
/// A missing key is a REAL ERROR, exactly as `sync/upload.rs:179` treats
/// it on emit: a device must hold the key for any epoch it stamps. The
/// caller leaves the row pending and retries, which is the only safe
/// answer — the alternative, falling back to the epoch-0 key, is the
/// defect this whole function exists to remove.
///
/// It also differs from `apply`'s `get_current_epoch(conn).unwrap_or(0)`
/// on one point: a FAILED read is an error here, not a silent 0. `apply`
/// can afford the fallback (a mis-stamped op still round-trips through
/// `content_master_key_for_epoch`); sealing an object under epoch 0
/// because a SELECT hiccupped would silently hand a revoked device the
/// file.
pub fn seal_epoch_and_key(
    conn: &rusqlite::Connection,
    user_keys: &crate::sync::keys::UserKeys,
) -> Result<(i64, crate::sync::keys::SecretKey32), String> {
    let epoch = crate::sync::config::get_current_epoch(conn).map_err(|e| e.to_string())?;
    let key = crate::sync::epoch::content_master_key_for_epoch(conn, user_keys, epoch)?
        .ok_or_else(|| format!("no content key for epoch {epoch} on attachment object upload"))?;
    Ok((epoch, key))
}

/// Seal one attachment object: `(object_key, ciphertext)`.
///
/// The random per-object UUID travels in `encrypt_op`'s own 16-byte
/// prefix, so the opener derives the subkey from the ciphertext itself
/// and the op carries no key material. A fresh UUID per upload means
/// the same file sealed twice lands under two object keys — no
/// cross-device dedupe at the relay, accepted by design.
pub fn seal_object(
    content_key: &crate::sync::keys::SecretKey32,
    plaintext: &[u8],
) -> (String, Vec<u8>) {
    let object_id = uuid::Uuid::new_v4();
    let ciphertext = crate::sync::envelope::encrypt_op(content_key, &object_id, plaintext);
    let object_key = crate::sync::envelope::blob_hash_hex(&ciphertext);
    (object_key, ciphertext)
}

/// [`run_object_upload_at`] with `app_dir` resolved from an `AppHandle`.
pub fn run_object_upload(
    app: &tauri::AppHandle,
    db: &Db,
    base_url: &str,
    user_id: &str,
    device_keys: &crate::sync::keys::DeviceKeys,
    user_keys: &crate::sync::keys::UserKeys,
    engine: &crate::op_log::OpLog,
) -> Result<usize, String> {
    let app_dir = app_data_dir_of(app)?;
    run_object_upload_at(db, &app_dir, base_url, user_id, device_keys, user_keys, engine)
}

fn app_data_dir_of(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Why a fetch produced no bytes. The distinction is only about
/// LOGGING: both variants leave the row exactly as it was.
#[derive(Debug)]
pub enum FetchSkip {
    /// Expected to start working: relay down, a 404 racing a delete, a
    /// ciphertext that won't open. Worth a line every tick.
    Retryable(String),
    /// This device cannot open this object at all and no retry will
    /// change that (it holds no key for the epoch the object was sealed
    /// under). The closure has already said so once; repeating it every
    /// 30 seconds would bury the log for no new information.
    AlreadyReported,
}

impl std::fmt::Display for FetchSkip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchSkip::Retryable(e) => write!(f, "{e}"),
            FetchSkip::AlreadyReported => write!(f, "(already reported)"),
        }
    }
}

/// Attachments referenced by a peer — Task 5's receive path recorded the
/// row (`sync = 1`) but never wrote the bytes (`has_local = 0`). These are
/// exactly what [`object_fetch_with`] drains. Returns
/// `(blob_hash, object_key, object_epoch)`: the first is what the fetched
/// plaintext is verified against, the second is what it is fetched BY,
/// the third is what it is OPENED with.
///
/// Rows the user explicitly swept (`gc_swept = 1`) are excluded, and
/// that exclusion is the whole of `attachment_gc` still working. GC
/// deletes the blob and sets `has_local = 0`, leaving `sync = 1` and
/// `object_key` intact — which is this query's exact shape. Before
/// anything fetched on a tick that was harmless; now, without the flag,
/// "free up space" frees nothing and re-downloads the user's whole
/// attachment set within 30 seconds. GC only ever sweeps blobs no page
/// references any more, so a swept row is an orphan the user chose to
/// drop, and the right answer is to leave it dropped.
///
/// Rows with no `object_key` are deliberately not returned. They can
/// only come from a reference op emitted by an early build of this
/// branch, before the upload existed — a few exist on the developer's
/// own devices. There is no address to GET them from and no way to
/// derive one (the relay's address is `blake3(ciphertext)`, and this
/// device has never held that ciphertext), so there is nothing a retry
/// could ever do differently. Doing nothing is the whole correct
/// behaviour: the row stays in the storage panel as a pointer, the next
/// tick doesn't spin on it, and if a peer re-uploads the file the
/// resulting reference op fills the key in via `COALESCE` and the fetch
/// starts working. They are counted and logged once per process so the
/// state is diagnosable without a log line every 30 seconds.
pub fn pending_object_fetch(db: &Db) -> Result<Vec<(String, String, i64)>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT blob_hash, object_key, object_epoch FROM attachments \
             WHERE sync = 1 AND has_local = 0 AND object_key IS NOT NULL AND object_key <> '' \
               AND gc_swept = 0 \
             ORDER BY size_bytes",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                // NULL means epoch 0, and that is a fact about these
                // rows rather than a fallback: an object_key with no
                // object_epoch can only have been recorded by a build
                // that sealed every object with
                // `user_keys.content_master_key` — the epoch-0 key. See
                // `wire::attachment_blob::object_epoch_of`.
                r.get::<_, Option<i64>>(2)?.unwrap_or(0),
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    static UNFETCHABLE_LOGGED: std::sync::Once = std::sync::Once::new();
    UNFETCHABLE_LOGGED.call_once(|| {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attachments \
                 WHERE sync = 1 AND has_local = 0 \
                   AND (object_key IS NULL OR object_key = '')",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if n > 0 {
            log::info!(
                "object fetch: {n} referenced attachment(s) carry no object key and can never \
                 be fetched — they predate the object upload. Left alone; re-syncing the file \
                 from the device that holds it will supply a key."
            );
        }
    });
    Ok(rows)
}

/// Fetch every attachment [`pending_object_fetch`] finds, verify it, and
/// mark it local. Split out from [`run_object_fetch`] the way `sweep_with`
/// is split from `run_sweep`: the sweep's real behaviour — hash
/// verification, re-deriving `size_bytes`, skip-and-retry on a failed
/// fetch — is testable with a fake `fetch` closure, no network or
/// `AppHandle` required.
///
/// `fetch` is called with the OBJECT KEY and the epoch that object was
/// sealed under, and returns PLAINTEXT: the GET and the decryption both
/// live in the closure (they need the device and account keys
/// respectively), so everything below is addressing- and
/// crypto-agnostic.
///
/// A relay is untrusted, so `fetch`'s bytes are hashed and compared to the
/// row's `blob_hash` BEFORE anything touches disk or the DB — the same
/// rule `merge_attachment_blob` follows for the legacy inline path. A
/// mismatch is treated exactly like a failed fetch: left pending for the
/// next launch, not counted as an error, and it never aborts the sweep
/// for other rows. (The AEAD tag alone is not enough: it proves some
/// holder of the account key produced those bytes, not that they are the
/// bytes this row is about — a relay can serve object B's ciphertext for
/// object A's key and the tag still verifies.)
///
/// `size_bytes` on the row is re-derived from the length of the bytes
/// ACTUALLY fetched, never trusted from whatever the reference op
/// claimed. Carried finding from Task 5's review: a reference row
/// persists `dto.size_bytes` straight off an untrusted op with no bound
/// check; the moment this sweep flips `has_local` to 1, a bogus value
/// (negative, `i64::MAX`, …) becomes permanent in storage totals and the
/// attachment list.
pub fn object_fetch_with<F>(
    db: &Db,
    app_dir: &std::path::Path,
    fetch: &mut F,
) -> Result<usize, String>
where
    F: FnMut(&str, i64) -> Result<Vec<u8>, FetchSkip>,
{
    let mut fetched = 0;
    for (blob_hash, object_key, object_epoch) in pending_object_fetch(db)? {
        let bytes = match fetch(&object_key, object_epoch) {
            Ok(b) => b,
            Err(FetchSkip::Retryable(e)) => {
                // Transient (relay down, a 404 racing a delete elsewhere,
                // a ciphertext that won't decrypt). Leave the row exactly
                // as it is; the next tick retries.
                log::warn!("object fetch: {blob_hash} at {object_key}: {e}");
                continue;
            }
            Err(FetchSkip::AlreadyReported) => {
                // This device holds no key for the epoch this object was
                // sealed under — the intended outcome of a rotation it
                // wasn't included in. Nothing to retry, nothing to write,
                // and the closure has already logged it once. The row
                // stays visible in the storage panel as a pointer.
                continue;
            }
        };
        let actual = crate::attachments::store::hash_hex(&bytes);
        if actual != blob_hash {
            // Never trust a relay's bytes. Treated the same as a failed
            // fetch: not written, not marked local, retried next launch.
            log::warn!(
                "object fetch: hash mismatch for {blob_hash} (relay returned {actual}), discarding"
            );
            continue;
        }
        if let Err(e) = crate::attachments::store::write_blob(app_dir, &blob_hash, &bytes) {
            log::warn!("object fetch: write {blob_hash}: {e}");
            continue;
        }
        // Re-derive from what was actually written, not whatever the
        // reference op (or the row) claimed — see the carried-finding
        // note above.
        let size_bytes = bytes.len() as i64;
        let conn = db.lock().map_err(|e| e.to_string())?;
        if let Err(e) = conn.execute(
            "UPDATE attachments SET has_local = 1, size_bytes = ?1 WHERE blob_hash = ?2",
            rusqlite::params![size_bytes, &blob_hash],
        ) {
            log::warn!("object fetch: update row for {blob_hash}: {e}");
            continue;
        }
        fetched += 1;
    }
    Ok(fetched)
}

/// Fetch every pending attachment object from the relay, verify it, and
/// write it to the local blob store. Thin network-facing wrapper around
/// [`object_fetch_with`] — mirrors [`run_sweep`] wrapping [`sweep_with`].
pub fn run_object_fetch(
    app: &tauri::AppHandle,
    db: &Db,
    base_url: &str,
    user_id: &str,
    device_keys: &crate::sync::keys::DeviceKeys,
    user_keys: &crate::sync::keys::UserKeys,
) -> Result<usize, String> {
    let app_dir = app_data_dir_of(app)?;
    run_object_fetch_at(db, &app_dir, base_url, user_id, device_keys, user_keys)
}

/// Same as [`run_object_fetch`] but takes `app_dir` directly instead of
/// resolving it from an `AppHandle`. The sync worker (`sync::worker::tick`)
/// has no `AppHandle` — it's spawned from `spawn_if_configured`, which only
/// holds a `Db` — so it resolves `app_dir` itself (from the db connection's
/// own file path, the same trick `merge::merge_attachment_blob` uses) and
/// calls this directly.
pub fn run_object_fetch_at(
    db: &Db,
    app_dir: &std::path::Path,
    base_url: &str,
    user_id: &str,
    device_keys: &crate::sync::keys::DeviceKeys,
    user_keys: &crate::sync::keys::UserKeys,
) -> Result<usize, String> {
    let mut fetch = |object_key: &str, object_epoch: i64| -> Result<Vec<u8>, FetchSkip> {
        // The object is opened with the key for the epoch it was SEALED
        // under — carried on the reference op and recorded on the row —
        // never with `user_keys.content_master_key`, which is only
        // epoch 0's. Resolved under a short-lived lock, before the GET,
        // so the DB is never held across the network call.
        let content_key = {
            let conn = db
                .lock()
                .map_err(|e| FetchSkip::Retryable(format!("db mutex: {e}")))?;
            crate::sync::epoch::content_master_key_for_epoch(&conn, user_keys, object_epoch)
                .map_err(FetchSkip::Retryable)?
        };
        let Some(content_key) = content_key else {
            // No key for that epoch on this device. This is the intended
            // lockout, not an error: it means the account rotated and
            // this device didn't get the new secret. Do not fetch, do not
            // write, do not panic — and say it once, not every tick.
            report_unopenable_epoch_once(object_epoch);
            return Err(FetchSkip::AlreadyReported);
        };
        // GET returns the ciphertext the uploader sealed (bounded by
        // MAX_BLOB_BYTES inside `get_attachment`). Decrypting it yields
        // the plaintext `object_fetch_with` then verifies against
        // `blob_hash` before anything is written.
        let ciphertext = crate::sync::wire::attachment_object::get_attachment(
            base_url,
            device_keys,
            user_id,
            object_key,
        )
        .map_err(|e| FetchSkip::Retryable(e.to_string()))?;
        let (_object_id, plaintext) = crate::sync::envelope::decrypt_op(&content_key, &ciphertext)
            .map_err(|e| FetchSkip::Retryable(format!("decrypt object at epoch {object_epoch}: {e}")))?;
        Ok(plaintext)
    };
    object_fetch_with(db, app_dir, &mut fetch)
}

/// One log line per epoch per process for "this device can't open
/// objects sealed at epoch N". Mirrors the once-only reporting
/// [`pending_object_fetch`] does for keyless rows: the state is
/// permanent, so it should be diagnosable without a warning every 30
/// seconds for the life of the app.
fn report_unopenable_epoch_once(epoch: i64) {
    use std::collections::HashSet;
    use std::sync::{Mutex, OnceLock};
    static REPORTED: OnceLock<Mutex<HashSet<i64>>> = OnceLock::new();
    let seen = REPORTED.get_or_init(|| Mutex::new(HashSet::new()));
    let Ok(mut seen) = seen.lock() else { return };
    if seen.insert(epoch) {
        log::info!(
            "object fetch: this device holds no content key for epoch {epoch}, so attachment \
             objects sealed under it cannot be opened here. Left alone. If this device is \
             still entitled, syncing will fetch the epoch secret and they will open."
        );
    }
}

/// Everything an attachment-object call needs, read in one short-lived
/// lock. `None` means there is no relay to talk to — sync isn't active,
/// or this device hasn't persisted keys yet.
fn relay_context(
    db: &Db,
) -> Option<(
    String,
    String,
    crate::sync::keys::DeviceKeys,
    crate::sync::keys::UserKeys,
)> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("attachment objects: db mutex poisoned: {e}");
            return None;
        }
    };
    let cfg = match crate::sync::config::load(&conn) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("attachment objects: config load failed: {e}");
            return None;
        }
    };
    if !cfg.is_active() {
        return None;
    }
    let device_keys = match crate::sync::keys::load_device_keys(&conn) {
        Ok(Some(dk)) => dk,
        Ok(None) => return None,
        Err(e) => {
            log::warn!("attachment objects: device keys load failed: {e}");
            return None;
        }
    };
    let user_keys = match crate::sync::keys::load_user_keys(&conn) {
        Ok(Some(uk)) => uk,
        Ok(None) => return None,
        Err(e) => {
            log::warn!("attachment objects: user keys load failed: {e}");
            return None;
        }
    };
    match (cfg.relay_url, cfg.user_id) {
        (Some(base_url), Some(user_id)) => Some((base_url, user_id, device_keys, user_keys)),
        _ => None,
    }
}

/// Clear `gc_swept` on every row current content still points at.
/// Returns how many rows were re-armed.
///
/// Recovery must not depend on the user pressing the button that lost
/// the file. Before this, the flag could only be withdrawn by
/// `attachment_gc` (i.e. "free up space" again) or by a peer op naming
/// the hash — so the population that healed was users with a chatty
/// second device, and everyone else kept a pin they could never open
/// while the relay object sat there alive. This runs it at launch, for
/// everyone, with no input.
///
/// Un-sweeping is only ever right for a hash that is genuinely still
/// referenced — `referenced_blob_hashes` is the same two-root scan
/// (`pages.content_json` + `shared_objects.content`) `attachment_gc`
/// keeps by, so this clears exactly the rows that scan would have
/// spared. Never a blanket clear: a swept orphan that nothing names
/// stays swept, or an explicit GC would undo itself every launch.
///
/// THE SCAN IS NOT PAID FOR UNLESS THERE IS SOMETHING TO RE-ARM. This
/// runs at every launch, and it holds the db lock while it runs — the
/// two-root scan reads and JSON-parses every page body and every pin
/// body, which on a large library is not free, and the target is a cold
/// launch to blank page under 800ms. But re-arming can only ever change
/// a row with `gc_swept = 1`, and that flag is set by exactly one thing:
/// the user pressing "free up space" (`attachment_gc`). On the
/// overwhelming majority of installs nobody ever has, so the scan's
/// result is discarded in full. One existence check against the small
/// `attachments` table answers that first.
pub fn rearm_referenced_attachments(db: &Db) -> Result<usize, String> {
    rearm_referenced_attachments_with(db, &mut crate::attachments::commands::referenced_blob_hashes)
}

/// [`rearm_referenced_attachments`] with the reference scan injected.
/// The point of the seam is that "the scan did not run" is an assertion
/// a test can make — see `nothing_swept_means_the_reference_scan_never_runs`
/// — rather than a timing claim nobody can check.
pub fn rearm_referenced_attachments_with<F>(db: &Db, scan: &mut F) -> Result<usize, String>
where
    F: FnMut(&rusqlite::Connection) -> Result<std::collections::HashSet<String>, String>,
{
    let conn = db.lock().map_err(|e| e.to_string())?;
    if !any_swept_rows(&conn)? {
        return Ok(0);
    }
    let referenced = scan(&conn)?;
    let mut stmt = conn
        .prepare("UPDATE attachments SET gc_swept = 0 WHERE blob_hash = ?1 AND gc_swept = 1")
        .map_err(|e| e.to_string())?;
    let mut rearmed = 0usize;
    for hash in &referenced {
        rearmed += stmt
            .execute(rusqlite::params![hash])
            .map_err(|e| e.to_string())?;
    }
    Ok(rearmed)
}

/// Is there any row a re-arm could possibly change? `EXISTS` stops at
/// the first match, and `attachments` holds one small row per file —
/// nothing like the two content scans it stands in front of.
fn any_swept_rows(conn: &rusqlite::Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM attachments WHERE gc_swept = 1)",
        [],
        |r| r.get::<_, i64>(0),
    )
    .map(|v| v != 0)
    .map_err(|e| e.to_string())
}

/// Fire-and-forget sweep on a background thread, mirroring
/// `op_log::backfill::run_background` — the UI must not wait on it.
pub fn run_background(app: tauri::AppHandle, db: Db, engine: crate::op_log::OpLog) {
    // Object upload + object fetch: the two halves of catching up on a
    // cold start with a backlog. Both read relay config + keys themselves,
    // inside the thread — sync may not be configured or active at all, in
    // which case there is nothing to do and the thread exits immediately
    // without touching the network. The worker's tick runs both again on
    // its normal cadence; this is only the launch-time catch-up.
    {
        let (app, db, engine) = (app.clone(), db.clone(), engine.clone());
        std::thread::spawn(move || {
            // Before the relay gate, and before the fetch: re-arming is a
            // local judgement (does anything still reference this hash?)
            // that costs one lock and no network, and it must run whether
            // or not sync is configured. Ordering matters — the fetch
            // below is what actually pulls the bytes back, and it skips
            // swept rows.
            match rearm_referenced_attachments(&db) {
                Ok(0) => {}
                Ok(n) => log::info!("attachment re-arm: {n} swept row(s) are referenced again"),
                Err(e) => log::warn!("attachment re-arm failed (silent): {e}"),
            }
            let Some((base_url, user_id, device_keys, user_keys)) = relay_context(&db) else {
                return;
            };
            // Upload first: an attachment authorised on this device but
            // never sent is the regression this whole path exists for.
            match run_object_upload(
                &app,
                &db,
                &base_url,
                &user_id,
                &device_keys,
                &user_keys,
                &engine,
            ) {
                Ok(0) => {}
                Ok(n) => log::info!("object upload: sent {n} previously-authorised attachment(s)"),
                Err(e) => log::warn!("object upload failed (silent): {e}"),
            }
            match run_object_fetch(&app, &db, &base_url, &user_id, &device_keys, &user_keys) {
                Ok(0) => {}
                Ok(n) => log::info!("object fetch: fetched {n} referenced attachment(s)"),
                Err(e) => log::warn!("object fetch failed (silent): {e}"),
            }
        });
    }
    std::thread::spawn(move || match run_sweep(&app, &db, &engine) {
        Ok(r) if r.pages_converted > 0 || r.pages_skipped > 0 => {
            log::info!(
                "image backfill: {} images across {} pages converted, {} pages deferred",
                r.images_converted,
                r.pages_converted,
                r.pages_skipped
            );
        }
        Ok(_) => {}
        Err(e) => log::warn!("image backfill failed (silent): {e}"),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{insert_page, test_db};
    use std::collections::HashMap;

    fn local_image(path: &str, alt: Option<&str>, extra: Value) -> Value {
        let mut attrs = json!({ "localPath": path, "src": format!("asset://{path}") });
        if let Some(a) = alt {
            attrs["alt"] = json!(a);
        }
        if let Some(obj) = extra.as_object() {
            for (k, v) in obj {
                attrs[k] = v.clone();
            }
        }
        json!({ "type": "localImage", "attrs": attrs })
    }

    fn doc(nodes: Vec<Value>) -> Value {
        json!({ "type": "doc", "content": [{ "type": "paragraph", "content": nodes }] })
    }

    /// (date, page_number) is unique, so each seeded page needs its own
    /// number. Counted per test process; the value itself is irrelevant.
    fn next_page_number() -> i64 {
        use std::sync::atomic::{AtomicI64, Ordering};
        static N: AtomicI64 = AtomicI64::new(1);
        N.fetch_add(1, Ordering::Relaxed)
    }

    fn seed_page(db: &Db, content: &Value) -> String {
        let conn = db.lock().unwrap();
        let id = insert_page(&conn, "2026-05-12", next_page_number());
        conn.execute(
            "UPDATE pages SET content_json = ?1 WHERE id = ?2",
            rusqlite::params![content.to_string(), &id],
        )
        .unwrap();
        id
    }

    fn content_of(db: &Db, page_id: &str) -> Value {
        let conn = db.lock().unwrap();
        let s: String = conn
            .query_row(
                "SELECT content_json FROM pages WHERE id = ?1",
                rusqlite::params![page_id],
                |r| r.get(0),
            )
            .unwrap();
        serde_json::from_str(&s).unwrap()
    }

    /// Stand-in for the blob store: content-addresses by path so the same
    /// picture on two pages yields one "blob", and refuses paths that
    /// weren't "written to disk".
    struct FakeStore {
        on_disk: HashMap<String, i64>,
        registrations: Vec<String>,
    }

    impl FakeStore {
        fn new(files: &[(&str, i64)]) -> Self {
            Self {
                on_disk: files.iter().map(|(p, n)| (p.to_string(), *n)).collect(),
                registrations: Vec::new(),
            }
        }

        fn register(&mut self, old: &Value) -> Result<Value, String> {
            let path = old
                .get("localPath")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "no localPath".to_string())?;
            let size = *self
                .on_disk
                .get(path)
                .ok_or_else(|| format!("read {path}: no such file"))?;
            self.registrations.push(path.to_string());
            let dto = AttachmentDto {
                // Content-addressed: same bytes (here, same path) → same hash.
                blob_hash: format!("hash-of-{path}"),
                filename: local_image_filename(old),
                mime_type: Some("image/png".into()),
                size_bytes: size,
                sync: false,
                has_local: true,
                created_at: "2026-01-01T00:00:00Z".into(),
            };
            Ok(converted_attrs(old, &dto))
        }
    }

    // ── pure conversion ────────────────────────────────────────────────

    #[test]
    fn filename_prefers_the_original_alt_over_the_managed_path() {
        let attrs = json!({ "alt": "screenshot.png", "localPath": "/data/images/01HX-abc.png" });
        assert_eq!(local_image_filename(&attrs), "screenshot.png");
    }

    #[test]
    fn filename_falls_back_to_the_path_basename() {
        let attrs = json!({ "localPath": "/data/images/01HX-abc.png" });
        assert_eq!(local_image_filename(&attrs), "01HX-abc.png");
        let blank_alt = json!({ "alt": "  ", "localPath": "/data/images/x.jpg" });
        assert_eq!(local_image_filename(&blank_alt), "x.jpg");
    }

    #[test]
    fn conversion_carries_layout_attrs_across() {
        let old = json!({
            "localPath": "/img/a.png", "alt": "a.png",
            "width": "320px", "display": "inline", "collapsed": true
        });
        let dto = AttachmentDto {
            blob_hash: "h1".into(),
            filename: "a.png".into(),
            mime_type: Some("image/png".into()),
            size_bytes: 99,
            sync: false,
            has_local: true,
            created_at: "2026-01-01T00:00:00Z".into(),
        };
        let new = converted_attrs(&old, &dto);
        assert_eq!(new["kind"], "image");
        assert_eq!(new["blob_hash"], "h1");
        assert_eq!(new["width"], "320px");
        assert_eq!(new["display"], "inline");
        assert_eq!(new["collapsed"], true);
        // A backfill must never authorise syncing on the user's behalf.
        assert_eq!(new["sync"], false);
    }

    #[test]
    fn conversion_defaults_layout_attrs_a_node_never_had() {
        let old = json!({ "localPath": "/img/a.png" });
        let dto = AttachmentDto {
            blob_hash: "h".into(),
            filename: "a.png".into(),
            mime_type: None,
            size_bytes: 1,
            sync: false,
            has_local: true,
            created_at: "t".into(),
        };
        let new = converted_attrs(&old, &dto);
        assert_eq!(new["display"], "block");
        assert_eq!(new["collapsed"], false);
        assert_eq!(new["width"], Value::Null);
    }

    #[test]
    fn has_local_image_finds_a_nested_node() {
        assert!(has_local_image(&doc(vec![local_image("/a.png", None, json!({}))])));
        assert!(!has_local_image(&doc(vec![
            json!({ "type": "text", "text": "no pictures here" })
        ])));
    }

    fn add_attachment(db: &Db, hash: &str, sync: bool, has_local: bool) {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at) \
             VALUES (?1, 'f.png', 'image/png', 10, ?2, ?3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![hash, sync as i64, has_local as i64],
        ).unwrap();
    }

    /// An `attachment_blob` op this device emitted, in whatever state
    /// and shape the caller asks for. The payload is a REAL
    /// `AttachmentBlobPayload` because `delivered_inline` parses it —
    /// the old placeholder (`x'00'`) could not distinguish an inline op
    /// from a reference, which is precisely the conflation that made
    /// un-sync a one-way door.
    fn add_blob_op(db: &Db, hash: &str, state: &str, payload: &Value) {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO op_log (op_id, op_kind, doc_id, stream_id, payload_blob, hlc_ts, state, applied_at, created_at) \
             VALUES (?1, 'attachment_blob', ?2, 0, ?3, 1, ?4, 0, 0)",
            rusqlite::params![
                format!("op-{hash}-{state}-{}", payload["chunks_b64"].as_array().map(|a| a.len()).unwrap_or(0)),
                hash,
                serde_json::to_vec(payload).unwrap(),
                state
            ],
        ).unwrap();
    }

    fn inline_payload(hash: &str, bytes: &[u8]) -> Value {
        serde_json::to_value(crate::sync::wire::attachment_blob::build_payload(
            hash,
            Some("application/octet-stream"),
            bytes,
            1,
        ))
        .unwrap()
    }

    fn reference_payload(hash: &str, object_key: Option<&str>) -> Value {
        match object_key {
            Some(k) => serde_json::to_value(
                crate::sync::wire::attachment_blob::build_reference_payload(
                    hash,
                    Some("application/octet-stream"),
                    10,
                    k,
                    0,
                    1,
                ),
            )
            .unwrap(),
            // The shape an early build of this branch emitted: a
            // reference with no object at all.
            None => json!({
                "op": "attachment_blob",
                "blob_hash": hash,
                "mime_type": "application/octet-stream",
                "size_bytes": 10,
                "chunks_b64": [],
                "hlc_ts": 1
            }),
        }
    }

    fn set_object_key(db: &Db, hash: &str, object_key: &str) {
        let conn = db.lock().unwrap();
        conn.execute(
            "UPDATE attachments SET object_key = ?1 WHERE blob_hash = ?2",
            rusqlite::params![object_key, hash],
        )
        .unwrap();
    }

    fn object_key_of(db: &Db, hash: &str) -> Option<String> {
        let conn = db.lock().unwrap();
        conn.query_row(
            "SELECT object_key FROM attachments WHERE blob_hash = ?1",
            rusqlite::params![hash],
            |r| r.get::<_, Option<String>>(0),
        )
        .unwrap()
    }

    // Consent given under a build whose toggle only wrote the flag: the
    // rows say sync = 1 and nothing was ever queued. The off->on edge has
    // passed, so the toggle alone can never recover them.
    #[test]
    fn finds_authorised_attachments_with_no_object() {
        let db = test_db();
        add_attachment(&db, "needs-upload", true, true);
        let pending = pending_object_upload(&db).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].0, "needs-upload");
    }

    #[test]
    fn ignores_attachments_that_are_not_authorised() {
        let db = test_db();
        add_attachment(&db, "local-only", false, true);
        assert!(pending_object_upload(&db).unwrap().is_empty());
    }

    #[test]
    fn ignores_attachments_whose_bytes_are_gone() {
        let db = test_db();
        add_attachment(&db, "swept", true, false);
        assert!(pending_object_upload(&db).unwrap().is_empty());
    }

    // A legacy INLINE op that reached the relay carried the bytes
    // themselves. Uploading an object as well would spend the account's
    // quota twice for one file that every peer can already reassemble.
    #[test]
    fn ignores_attachments_whose_bytes_already_went_out_inline() {
        let db = test_db();
        add_attachment(&db, "already-sent", true, true);
        add_blob_op(&db, "already-sent", "committed", &inline_payload("already-sent", b"the bytes"));
        assert!(pending_object_upload(&db).unwrap().is_empty());
    }

    // C1. A REFERENCE op is not a delivery — it is an address, and the
    // address can be gone. Two shapes of that, both of which sat
    // permanently un-uploadable on the developer's own devices because
    // the old gate asked only "does an attachment_blob op exist":
    //
    //   - a reference emitted by an early build of this branch, before
    //     anything uploaded an object at all;
    //   - a reference whose object WAS uploaded and has since been
    //     deleted by un-syncing (the row's object_key is cleared, so
    //     this is the same state).
    //
    // Neither has bytes anywhere the account can reach. Both must
    // upload.
    #[test]
    fn a_reference_op_with_no_surviving_object_does_not_block_the_upload() {
        let db = test_db();
        add_attachment(&db, "referenced-never-uploaded", true, true);
        add_blob_op(
            &db,
            "referenced-never-uploaded",
            "committed",
            &reference_payload("referenced-never-uploaded", None),
        );

        add_attachment(&db, "unsynced-then-resynced", true, true);
        add_blob_op(
            &db,
            "unsynced-then-resynced",
            "committed",
            &reference_payload("unsynced-then-resynced", Some(&"a".repeat(64))),
        );

        let pending: Vec<String> = pending_object_upload(&db)
            .unwrap()
            .into_iter()
            .map(|(h, _)| h)
            .collect();
        assert!(pending.contains(&"referenced-never-uploaded".to_string()));
        assert!(pending.contains(&"unsynced-then-resynced".to_string()));
    }

    // C1, the other half of the same conflation: an inline op that
    // never reached the relay delivered nothing either. The 1.28 MB
    // file this whole branch exists for has exactly one of these — a
    // ~1.7 MB inline op the relay refused with 413 on every tick.
    #[test]
    fn an_inline_op_that_never_committed_does_not_block_the_upload() {
        let db = test_db();
        add_attachment(&db, "413ed-forever", true, true);
        add_blob_op(
            &db,
            "413ed-forever",
            "pending_upload",
            &inline_payload("413ed-forever", b"never accepted"),
        );
        assert_eq!(pending_object_upload(&db).unwrap().len(), 1);
    }

    // Self-limiting: a successful upload writes the object key in the
    // same transaction that emits the reference, so the row stops
    // matching and the same bytes never cross the wire twice.
    #[test]
    fn ignores_attachments_that_already_have_an_object() {
        let db = test_db();
        add_attachment(&db, "already-up", true, true);
        set_object_key(&db, "already-up", &"b".repeat(64));
        assert!(pending_object_upload(&db).unwrap().is_empty());
    }

    // ── the sweep ──────────────────────────────────────────────────────

    #[test]
    fn converts_every_image_across_multiple_pages() {
        let db = test_db();
        let p1 = seed_page(&db, &doc(vec![local_image("/img/a.png", Some("a.png"), json!({}))]));
        let p2 = seed_page(
            &db,
            &doc(vec![
                local_image("/img/b.png", Some("b.png"), json!({})),
                local_image("/img/c.png", Some("c.png"), json!({})),
            ]),
        );

        let mut store = FakeStore::new(&[("/img/a.png", 10), ("/img/b.png", 20), ("/img/c.png", 30)]);
        let report = sweep_with(&db, &mut |v| store.register(v)).unwrap();

        assert_eq!(report.pages_converted, 2);
        assert_eq!(report.images_converted, 3);
        assert_eq!(report.pages_skipped, 0);
        for id in [&p1, &p2] {
            assert!(!has_local_image(&content_of(&db, id)), "page {id} still has a localImage");
        }
    }

    #[test]
    fn the_same_picture_on_two_pages_registers_one_blob() {
        let db = test_db();
        let p1 = seed_page(&db, &doc(vec![local_image("/img/same.png", Some("s.png"), json!({}))]));
        let p2 = seed_page(&db, &doc(vec![local_image("/img/same.png", Some("s.png"), json!({}))]));

        let mut store = FakeStore::new(&[("/img/same.png", 42)]);
        let report = sweep_with(&db, &mut |v| store.register(v)).unwrap();

        assert_eq!(report.images_converted, 2);
        // Content addressing: both nodes point at the same blob.
        let hash_of = |id: &str| content_of(&db, id)["content"][0]["content"][0]["attrs"]["blob_hash"].clone();
        assert_eq!(hash_of(&p1), hash_of(&p2));
    }

    #[test]
    fn a_missing_original_skips_only_its_own_page() {
        let db = test_db();
        let good = seed_page(&db, &doc(vec![local_image("/img/here.png", Some("h.png"), json!({}))]));
        let bad = seed_page(&db, &doc(vec![local_image("/img/gone.png", Some("g.png"), json!({}))]));

        let mut store = FakeStore::new(&[("/img/here.png", 7)]);
        let report = sweep_with(&db, &mut |v| store.register(v)).unwrap();

        assert_eq!(report.pages_converted, 1);
        assert_eq!(report.pages_skipped, 1);
        assert!(!has_local_image(&content_of(&db, &good)));
        // Untouched, so the next launch retries it.
        assert!(has_local_image(&content_of(&db, &bad)));
    }

    #[test]
    fn a_page_is_all_or_nothing() {
        let db = test_db();
        // Two images, only the first readable — the page must not commit
        // with one converted node and one old one.
        let page = seed_page(
            &db,
            &doc(vec![
                local_image("/img/ok.png", Some("ok.png"), json!({})),
                local_image("/img/missing.png", Some("m.png"), json!({})),
            ]),
        );

        let mut store = FakeStore::new(&[("/img/ok.png", 5)]);
        let report = sweep_with(&db, &mut |v| store.register(v)).unwrap();

        assert_eq!(report.pages_converted, 0);
        assert_eq!(report.pages_skipped, 1);
        let after = content_of(&db, &page);
        assert!(has_local_image(&after));
        let nodes = after["content"][0]["content"].as_array().unwrap();
        assert!(
            nodes.iter().all(|n| n["type"] == "localImage"),
            "page committed a mix of old and new node types: {after}"
        );
    }

    #[test]
    fn is_idempotent_and_leaves_converted_pages_alone() {
        let db = test_db();
        seed_page(&db, &doc(vec![local_image("/img/a.png", Some("a.png"), json!({}))]));

        let mut store = FakeStore::new(&[("/img/a.png", 10)]);
        let first = sweep_with(&db, &mut |v| store.register(v)).unwrap();
        assert_eq!(first.images_converted, 1);

        // Second launch: nothing left to scan, and no re-registration.
        let before = store.registrations.len();
        let second = sweep_with(&db, &mut |v| store.register(v)).unwrap();
        assert_eq!(second, SweepReport::default());
        assert_eq!(store.registrations.len(), before, "re-registered an already-converted image");
    }

    // Found by running this against a real pre-Phase-1 library: most of its
    // localImage nodes carried `src: "blob:tauri://localhost/<uuid>"` with a
    // null localPath — in-memory object URLs from an older paste path, whose
    // bytes were never persisted. They are already broken pictures and no
    // future run can ever convert them, so treating them as a retryable
    // failure meant zero images converted, forever, and a page rescanned on
    // every launch.
    #[test]
    fn a_dead_reference_is_not_a_candidate_and_does_not_block_its_page() {
        let db = test_db();
        let dead = json!({
            "type": "localImage",
            "attrs": { "src": "blob:tauri://localhost/015ebc35", "localPath": Value::Null,
                       "display": "block", "collapsed": true }
        });
        let page = seed_page(
            &db,
            &doc(vec![dead.clone(), local_image("/img/real.png", Some("icon.png"), json!({}))]),
        );

        let mut store = FakeStore::new(&[("/img/real.png", 12)]);
        let report = sweep_with(&db, &mut |v| store.register(v)).unwrap();

        // The real image converted despite the dead one sitting beside it.
        assert_eq!(report.pages_converted, 1);
        assert_eq!(report.images_converted, 1);
        assert_eq!(report.pages_skipped, 0);

        let nodes = content_of(&db, &page)["content"][0]["content"].clone();
        assert_eq!(nodes[0]["type"], "localImage", "dead node left alone");
        assert_eq!(nodes[1]["type"], "attachment");
        assert_eq!(nodes[1]["attrs"]["filename"], "icon.png");
    }

    #[test]
    fn a_page_of_only_dead_references_is_never_rewritten_or_retried() {
        let db = test_db();
        let dead = json!({
            "type": "localImage",
            "attrs": { "src": "blob:tauri://localhost/abc", "localPath": Value::Null }
        });
        let page = seed_page(&db, &doc(vec![dead.clone(), dead.clone()]));

        let mut store = FakeStore::new(&[]);
        let report = sweep_with(&db, &mut |v| store.register(v)).unwrap();

        // Nothing to do — not a skip, not a write, and no registration work.
        assert_eq!(report, SweepReport::default());
        assert!(store.registrations.is_empty());
        assert!(has_local_image(&content_of(&db, &page)));
    }

    #[test]
    fn a_readable_original_that_vanishes_is_still_a_retryable_skip() {
        // The distinction that matters: a node WITH a localPath whose file is
        // missing is transient (an unmounted drive, a sync in flight) and must
        // still defer its page, unlike a node with no path at all.
        let db = test_db();
        let page = seed_page(&db, &doc(vec![local_image("/img/gone.png", Some("g.png"), json!({}))]));
        let mut store = FakeStore::new(&[]);
        let report = sweep_with(&db, &mut |v| store.register(v)).unwrap();
        assert_eq!(report.pages_skipped, 1);
        assert!(has_local_image(&content_of(&db, &page)));
    }

    #[test]
    fn pages_without_images_are_never_touched() {
        let db = test_db();
        let page = seed_page(&db, &doc(vec![json!({ "type": "text", "text": "just writing" })]));
        let mut store = FakeStore::new(&[]);
        let report = sweep_with(&db, &mut |v| store.register(v)).unwrap();
        assert_eq!(report, SweepReport::default());
        assert_eq!(content_of(&db, &page)["content"][0]["content"][0]["text"], "just writing");
    }

    // ── object fetch (Task 6) ─────────────────────────────────────────

    fn add_attachment_with_size(db: &Db, hash: &str, sync: bool, has_local: bool, size_bytes: i64) {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at) \
             VALUES (?1, 'f.bin', 'application/octet-stream', ?2, ?3, ?4, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![hash, size_bytes, sync as i64, has_local as i64],
        ).unwrap();
    }

    fn row_has_local(db: &Db, hash: &str) -> bool {
        let conn = db.lock().unwrap();
        conn.query_row(
            "SELECT has_local FROM attachments WHERE blob_hash = ?1",
            rusqlite::params![hash],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            != 0
    }

    fn row_size_bytes(db: &Db, hash: &str) -> i64 {
        let conn = db.lock().unwrap();
        conn.query_row(
            "SELECT size_bytes FROM attachments WHERE blob_hash = ?1",
            rusqlite::params![hash],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Seed a row the way a peer's reference op would: authorised, not
    /// local, and carrying the relay address its bytes live at.
    fn add_referenced_attachment(db: &Db, hash: &str, object_key: &str) {
        add_attachment(db, hash, true, false);
        set_object_key(db, hash, object_key);
    }

    // The brief's exact test.
    #[test]
    fn finds_attachments_referenced_but_not_yet_fetched() {
        let db = test_db();
        add_attachment(&db, "arrived", true, true);
        add_referenced_attachment(&db, "referenced-only", "obj-referenced-only");
        let pending = pending_object_fetch(&db).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].0, "referenced-only");
        assert_eq!(
            pending[0].1, "obj-referenced-only",
            "the fetch is addressed by the object key, never by blob_hash"
        );
    }

    #[test]
    fn pending_object_fetch_ignores_unauthorised_or_already_local_rows() {
        let db = test_db();
        add_referenced_attachment(&db, "not-authorised", "obj-a");
        {
            let conn = db.lock().unwrap();
            conn.execute("UPDATE attachments SET sync = 0", []).unwrap();
        }
        add_attachment(&db, "already-local", true, true);
        set_object_key(&db, "already-local", "obj-b");
        assert!(pending_object_fetch(&db).unwrap().is_empty());
    }

    /// A reference op from an early build of this branch recorded a row
    /// with no object key. Nothing can ever fetch it — the relay
    /// addresses objects by `blake3(ciphertext)` and this device has
    /// never held that ciphertext, so there is no address to ask for and
    /// no retry that could behave differently.
    ///
    /// This is a deliberate "nothing happens": doing nothing is correct
    /// because the alternatives are worse. Returning the row would send
    /// a GET to `/attachments/<sha256-of-plaintext>`, which 404s every
    /// tick forever; deleting the row would drop a real attachment out
    /// of the storage panel. Left alone, it stays visible as a pointer
    /// and starts working the moment a peer re-uploads the file (the
    /// new reference op fills the key in via COALESCE).
    #[test]
    fn a_reference_with_no_object_key_is_left_alone_rather_than_retried() {
        let db = test_db();
        add_attachment(&db, "keyless", true, false);
        let dir = tempfile::tempdir().unwrap();

        assert!(
            pending_object_fetch(&db).unwrap().is_empty(),
            "there is no address to fetch this from"
        );

        let mut fetch = |_: &str, _: i64| -> Result<Vec<u8>, FetchSkip> {
            panic!("a keyless row must never reach the network");
        };
        let n = object_fetch_with(&db, dir.path(), &mut fetch).unwrap();
        assert_eq!(n, 0);
        // The row itself survives untouched: still authorised, still
        // waiting, still listed.
        assert!(!row_has_local(&db, "keyless"));
        let conn = db.lock().unwrap();
        let still_there: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attachments WHERE blob_hash = 'keyless' AND sync = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(still_there, 1);
    }

    #[test]
    fn object_fetch_writes_verified_bytes_and_marks_the_row_local() {
        let db = test_db();
        let bytes = b"attachment plaintext".to_vec();
        let hash = crate::attachments::store::hash_hex(&bytes);
        add_referenced_attachment(&db, &hash, "obj-key-1");
        let dir = tempfile::tempdir().unwrap();

        let mut fetch = |k: &str, _: i64| -> Result<Vec<u8>, FetchSkip> {
            assert_eq!(k, "obj-key-1", "fetch called for the wrong object");
            Ok(bytes.clone())
        };
        let n = object_fetch_with(&db, dir.path(), &mut fetch).unwrap();

        assert_eq!(n, 1);
        assert!(row_has_local(&db, &hash));
        assert_eq!(row_size_bytes(&db, &hash), bytes.len() as i64);
        assert!(crate::attachments::store::has_local(dir.path(), &hash));
    }

    // CARRIED FINDING (Task 5 review): a reference row can persist an
    // arbitrary size_bytes straight off an untrusted relay op. Once this
    // sweep flips has_local to 1, that value becomes permanent in
    // storage totals unless it's re-derived from what was actually
    // fetched.
    #[test]
    fn object_fetch_re_derives_size_bytes_from_the_actual_fetched_bytes_not_the_row() {
        let db = test_db();
        let bytes = b"seventeen real bytes".to_vec();
        let hash = crate::attachments::store::hash_hex(&bytes);
        // A malformed/malicious relay op recorded a wildly wrong size —
        // Task 5's merge path persists dto.size_bytes with no bound check.
        add_attachment_with_size(&db, &hash, true, false, i64::MAX);
        set_object_key(&db, &hash, "obj-lying-size");
        let dir = tempfile::tempdir().unwrap();

        let mut fetch = |_: &str, _: i64| -> Result<Vec<u8>, FetchSkip> { Ok(bytes.clone()) };
        let n = object_fetch_with(&db, dir.path(), &mut fetch).unwrap();

        assert_eq!(n, 1);
        assert_eq!(
            row_size_bytes(&db, &hash),
            bytes.len() as i64,
            "size_bytes must come from the actual fetch, not the op's claim"
        );
    }

    #[test]
    fn object_fetch_rejects_a_hash_mismatch_and_leaves_the_row_pending() {
        let db = test_db();
        let hash = "d".repeat(64);
        add_referenced_attachment(&db, &hash, "obj-substituted");
        let dir = tempfile::tempdir().unwrap();

        // The relay returns bytes that don't hash to the claimed value —
        // untrusted, so this must not be written or marked local.
        let mut fetch =
            |_: &str, _: i64| -> Result<Vec<u8>, FetchSkip> { Ok(b"not what you asked for".to_vec()) };
        let n = object_fetch_with(&db, dir.path(), &mut fetch).unwrap();

        assert_eq!(n, 0);
        assert!(!row_has_local(&db, &hash));
        assert!(!crate::attachments::store::has_local(dir.path(), &hash));
    }

    #[test]
    fn a_failed_fetch_is_left_pending_and_does_not_abort_the_sweep() {
        let db = test_db();
        let ok_bytes = b"fine".to_vec();
        let ok_hash = crate::attachments::store::hash_hex(&ok_bytes);
        add_referenced_attachment(&db, "unreachable", "obj-unreachable");
        add_referenced_attachment(&db, &ok_hash, "obj-ok");
        let dir = tempfile::tempdir().unwrap();

        let mut fetch = |k: &str, _: i64| -> Result<Vec<u8>, FetchSkip> {
            if k == "obj-unreachable" {
                Err(FetchSkip::Retryable("relay 404".into()))
            } else {
                Ok(ok_bytes.clone())
            }
        };
        let n = object_fetch_with(&db, dir.path(), &mut fetch).unwrap();

        // Untouched, so the next launch retries it — same rule the image
        // backfill follows for an unreadable original.
        assert_eq!(n, 1, "only the reachable row counts");
        assert!(!row_has_local(&db, "unreachable"));
        assert!(row_has_local(&db, &ok_hash));
    }

    // ── object upload (Task 10) ───────────────────────────────────────
    //
    // The half that was missing: `put_attachment` had no callers, so
    // every attachment referenced an object that was never uploaded.

    fn engine_for(db: &Db) -> crate::op_log::OpLog {
        let conn = db.lock().unwrap();
        std::sync::Arc::new(crate::op_log::OpLogEngine::load(&conn).unwrap())
    }

    /// The single `attachment_blob` op for `hash`, parsed. `None` when
    /// no op was emitted.
    fn emitted_reference(
        db: &Db,
        hash: &str,
    ) -> Option<crate::sync::wire::attachment_blob::AttachmentBlobPayload> {
        let conn = db.lock().unwrap();
        let payload: Option<Vec<u8>> = conn
            .query_row(
                "SELECT payload_blob FROM op_log \
                 WHERE op_kind = 'attachment_blob' AND doc_id = ?1",
                rusqlite::params![hash],
                |r| r.get(0),
            )
            .ok();
        payload.map(|p| serde_json::from_slice(&p).unwrap())
    }

    /// A relay-delete that must never happen. `object_upload_with` only
    /// takes an object back when the relay may be holding one that
    /// nothing references — it could not record the reference locally,
    /// consent was withdrawn mid-flight, or the PUT failed after the key
    /// existed. Every test using this either records cleanly or fails
    /// with no key at all (`UploadFailure::object_key == None`), so a
    /// call here means bytes were deleted from the relay that the
    /// account still points at.
    fn never_discard() -> impl FnMut(&str) -> Result<(), String> {
        |k: &str| panic!("nothing should have been deleted from the relay: {k}")
    }

    /// Put real bytes in the store and a row that has consented to sync
    /// but has never been uploaded — what the off→on edge leaves behind.
    fn seed_upload_candidate(db: &Db, dir: &std::path::Path, bytes: &[u8]) -> String {
        let hash = crate::attachments::store::hash_hex(bytes);
        crate::attachments::store::write_blob(dir, &hash, bytes).unwrap();
        add_attachment_with_size(db, &hash, true, true, bytes.len() as i64);
        hash
    }

    /// The ordering rule, stated as a test: the object key only exists
    /// on the row and in the op because the upload returned it.
    #[test]
    fn upload_records_the_object_key_and_then_emits_the_reference() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"real attachment bytes".to_vec();
        let hash = seed_upload_candidate(&db, dir.path(), &bytes);

        let mut seen: Option<Vec<u8>> = None;
        let mut upload = |plaintext: &[u8]| -> Result<(String, i64), String> {
            // What goes to the relay is derived from the file, not from
            // whatever the row claimed.
            seen = Some(plaintext.to_vec());
            Ok(("obj-uploaded".to_string(), 0))
        };
        let n = object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut never_discard()).unwrap();

        assert_eq!(n, 1);
        assert_eq!(seen.as_deref(), Some(bytes.as_slice()));
        assert_eq!(object_key_of(&db, &hash).as_deref(), Some("obj-uploaded"));
        let op = emitted_reference(&db, &hash).expect("the reference op was emitted");
        assert_eq!(op.object_key.as_deref(), Some("obj-uploaded"));
        assert_eq!(op.blob_hash, hash);
        assert_eq!(op.size_bytes, bytes.len() as i64);
        assert!(op.chunks_b64.is_empty(), "the bytes are in the object now");
    }

    /// A failed upload emits NOTHING. This is the rule the whole sweep
    /// is shaped around: a reference op whose object doesn't exist
    /// leaves every peer fetching a 404 forever, and the op log is
    /// append-only so it can never be taken back.
    #[test]
    fn a_failed_upload_emits_no_op_and_leaves_the_row_pending() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = seed_upload_candidate(&db, dir.path(), b"bytes that never land");

        let mut upload = |_: &[u8]| -> Result<(String, i64), String> { Err("relay 503".into()) };
        let n = object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut never_discard()).unwrap();

        assert_eq!(n, 0);
        assert!(emitted_reference(&db, &hash).is_none(), "no object, no pointer");
        assert!(object_key_of(&db, &hash).is_none());
        // Still pending, so a later tick retries it — but not the very
        // next one: a failure backs the row off (I3) so a file that
        // cannot get through stops re-sending its whole body twice a
        // minute.
        assert!(
            pending_object_upload(&db).unwrap().is_empty(),
            "a failed upload must not be re-sent on the next 30s tick"
        );
        assert_eq!(
            pending_object_upload_at(&db, now_ms() + upload_retry_delay_ms(1) + 1)
                .unwrap()
                .len(),
            1,
            "and it must come back once the backoff expires"
        );
    }

    /// A PUT THAT FAILED IS NOT A RELAY THAT HAS NOTHING.
    ///
    /// The transfer carries a whole-request deadline of ~73 minutes
    /// (`attachment_object::OBJECT_TRANSFER_DEADLINE`). When it expires
    /// this arm ran log-back_off-continue and nothing else, while a
    /// relay that committed the body a second later kept an object no op
    /// will ever name. The relay's `gc_orphan_blobs` bails out, so it is
    /// permanent and it costs the user paid quota — and every retry
    /// seals under a fresh per-object UUID, so each timed-out-but-
    /// committed attempt stranded another one. The two other failure
    /// arms in this function have always discarded; this was the hole.
    #[test]
    fn an_upload_that_may_have_committed_takes_the_object_back() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = seed_upload_candidate(&db, dir.path(), b"bytes that may have landed");

        let mut upload = |_: &[u8]| -> Result<(String, i64), UploadFailure> {
            Err(UploadFailure {
                object_key: Some("obj-timed-out".into()),
                error: "transport: operation timed out".into(),
            })
        };
        let mut discarded: Vec<String> = Vec::new();
        let mut discard = |k: &str| -> Result<(), String> {
            discarded.push(k.to_string());
            Ok(())
        };
        let n =
            object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut discard).unwrap();

        assert_eq!(n, 0);
        assert_eq!(
            discarded,
            vec!["obj-timed-out".to_string()],
            "the object the relay may be holding was left stranded"
        );
        // Unchanged in every other respect: the ordering rule still
        // holds, so the row stays pending and no peer hears of it.
        assert!(emitted_reference(&db, &hash).is_none());
        assert!(object_key_of(&db, &hash).is_none());
    }

    /// The other half of the same arm: a failure UPSTREAM of the seal
    /// carries no key, and must send no DELETE.
    ///
    /// The empty assertion is the point, not an oversight — no key ever
    /// existed, so no bytes can have reached the relay and there is
    /// nothing to reclaim. A DELETE here would be a signed round trip
    /// against a relay that has never heard the name, on every tick of a
    /// device that is simply missing an epoch key.
    #[test]
    fn a_failure_before_the_seal_deletes_nothing() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        seed_upload_candidate(&db, dir.path(), b"never sealed, never sent");

        let mut upload = |_: &[u8]| -> Result<(String, i64), UploadFailure> {
            Err(UploadFailure::from("no content key for epoch 2".to_string()))
        };
        let mut discarded: Vec<String> = Vec::new();
        let mut discard = |k: &str| -> Result<(), String> {
            discarded.push(k.to_string());
            Ok(())
        };
        object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut discard).unwrap();

        assert!(discarded.is_empty(), "deleted {discarded:?} from the relay");
    }

    /// THE SEAM THE KEY USED TO BE LOST AT. The two tests above drive
    /// `object_upload_with` directly; this one drives the real
    /// `run_object_upload_at`, whose upload closure is where the object
    /// key is computed — and where it used to go out of scope the
    /// instant the PUT returned `Err`, so no discard was reachable at
    /// all. Against a relay that refuses the PUT, the DELETE must still
    /// go out, and it must name the key the PUT used.
    #[test]
    fn a_failed_put_against_a_real_relay_deletes_the_key_it_used() {
        use httpmock::prelude::*;
        let server = MockServer::start();
        // httpmock 0.7 cannot report the requests a mock received, and
        // its custom matcher takes a plain fn pointer (no captures) — so
        // the observed (method, path) pairs land in a static. Only this
        // test touches it. Duplicates are harmless: the pairs come from
        // the request itself, so re-evaluating a matcher records the
        // same pair again.
        static SEEN: std::sync::OnceLock<std::sync::Mutex<Vec<(String, String)>>> =
            std::sync::OnceLock::new();
        fn seen() -> &'static std::sync::Mutex<Vec<(String, String)>> {
            SEEN.get_or_init(|| std::sync::Mutex::new(Vec::new()))
        }

        let put = server.mock(|when, then| {
            when.method(PUT).matches(|req| {
                seen()
                    .lock()
                    .unwrap()
                    .push((req.method.clone(), req.path.clone()));
                true
            });
            then.status(500).json_body(serde_json::json!({
                "error": { "code": "internal", "message": "committed, then fell over" }
            }));
        });
        let delete = server.mock(|when, then| {
            when.method(DELETE).matches(|req| {
                seen()
                    .lock()
                    .unwrap()
                    .push((req.method.clone(), req.path.clone()));
                true
            });
            then.status(200)
                .json_body(serde_json::json!({ "deleted": true, "freed_bytes": 3 }));
        });

        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = seed_upload_candidate(&db, dir.path(), b"put me");
        let device_keys = crate::sync::keys::generate_device_keys();
        let user_keys = fresh_user_keys();

        run_object_upload_at(
            &db,
            dir.path(),
            &server.base_url(),
            "u",
            &device_keys,
            &user_keys,
            &engine_for(&db),
        )
        .unwrap();

        put.assert();
        delete.assert();
        // Same object key on both requests: the DELETE reclaims what the
        // PUT may have committed, not some other object.
        let seen = seen().lock().unwrap().clone();
        let key_of = |method: &str| {
            seen.iter()
                .find(|(m, _)| m == method)
                .map(|(_, p)| p.rsplit('/').next().unwrap().to_string())
                .unwrap_or_else(|| panic!("no {method} was ever sent: {seen:?}"))
        };
        assert_eq!(key_of("PUT"), key_of("DELETE"));
        assert!(object_key_of(&db, &hash).is_none(), "nothing was recorded");
    }

    /// I3 — A REPEATEDLY FAILING ATTACHMENT BACKS OFF.
    ///
    /// `pending_object_upload` matched on state alone, so an upload
    /// that cannot succeed — a file too big for the account's uplink, a
    /// relay refusing it, a quota that stays full — re-sent its whole
    /// body on every 30s tick for as long as the app ran. Invisible,
    /// permanent, and compounding: each attempt seals under a fresh
    /// per-object UUID, so any PUT the relay committed before the
    /// client gave up left a DISTINCT orphan on a relay whose orphan GC
    /// bails out. The sweep also runs before `upload::run_pass`, so
    /// these held all page and op sync behind them.
    #[test]
    fn consecutive_failures_push_the_next_attempt_further_out() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        seed_upload_candidate(&db, dir.path(), b"never gets through");

        let mut attempts = 0;
        let mut upload = |_: &[u8]| -> Result<(String, i64), String> {
            attempts += 1;
            Err("relay 503".into())
        };
        let engine = engine_for(&db);

        // Three sweeps, each after its predecessor's backoff expired.
        for n in 1..=3 {
            let at = now_ms() + upload_retry_delay_ms(n) + 1;
            let pending = pending_object_upload_at(&db, at).unwrap();
            assert_eq!(pending.len(), 1, "attempt {n}: the row should be eligible again");
            object_upload_with_at(&db, dir.path(), &engine, &mut upload, &mut never_discard(), at)
                .unwrap();
            // Immediately after: held back, and by more than last time.
            assert!(
                pending_object_upload_at(&db, at).unwrap().is_empty(),
                "attempt {n} is being retried on the very next tick"
            );
        }
        assert_eq!(attempts, 3, "one PUT per eligible sweep, not one per tick");
        assert!(
            upload_retry_delay_ms(3) > upload_retry_delay_ms(1),
            "the wait has to grow, or a permanently broken upload is only slightly quieter"
        );
        assert_eq!(
            upload_retry_delay_ms(99),
            upload_retry_delay_ms(100),
            "and it has to stop growing, so a network that comes back is picked up within \
             the hour rather than next week"
        );
    }

    /// A successful upload clears the debt, so the next attachment that
    /// fails starts from one minute rather than from wherever this row
    /// happened to leave off.
    #[test]
    fn a_successful_upload_clears_the_backoff() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = seed_upload_candidate(&db, dir.path(), b"lands on the second try");
        let engine = engine_for(&db);

        let mut fail = |_: &[u8]| -> Result<(String, i64), String> { Err("relay 503".into()) };
        object_upload_with(&db, dir.path(), &engine, &mut fail, &mut never_discard()).unwrap();


        let at = now_ms() + upload_retry_delay_ms(1) + 1;
        let mut ok = |_: &[u8]| -> Result<(String, i64), String> { Ok(("obj-late".into(), 0)) };
        assert_eq!(pending_object_upload_at(&db, at).unwrap().len(), 1);
        object_upload_with_at(&db, dir.path(), &engine, &mut ok, &mut never_discard(), at).unwrap();

        let conn = db.lock().unwrap();
        let (attempts, retry_at): (i64, i64) = conn
            .query_row(
                "SELECT upload_attempts, upload_retry_at_ms FROM attachments WHERE blob_hash = ?1",
                rusqlite::params![&hash],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((attempts, retry_at), (0, 0));
    }

    /// I2 — A REVOCATION MID-UPLOAD IS NOT SILENTLY IGNORED.
    ///
    /// The window is the whole PUT, tens of seconds for a large file.
    /// The toggle that fires inside it sees `object_key = NULL` — the
    /// sweep hasn't recorded one yet — so it has nothing to DELETE and
    /// nothing to retract, and returns as if the file had never been
    /// on the relay. The sweep then recorded the key on a row that says
    /// `sync = 0` and sent the pointer to every peer. The user's
    /// revocation was ignored, and the only way to remove the bytes was
    /// to toggle sync on and off again.
    #[test]
    fn a_toggle_off_during_the_put_deletes_the_object_instead_of_recording_it() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = seed_upload_candidate(&db, dir.path(), b"the user changed their mind mid-flight");

        // The toggle fires while the bytes are on the wire.
        let mut upload = |_: &[u8]| -> Result<(String, i64), String> {
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE attachments SET sync = 0 WHERE blob_hash = ?1",
                rusqlite::params![&hash],
            )
            .unwrap();
            Ok(("obj-revoked".into(), 0))
        };
        let mut discarded: Vec<String> = Vec::new();
        let mut discard = |k: &str| -> Result<(), String> {
            discarded.push(k.to_string());
            Ok(())
        };
        let n =
            object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut discard).unwrap();

        assert_eq!(n, 0, "nothing was published");
        assert!(
            object_key_of(&db, &hash).is_none(),
            "a row that says sync = 0 must not end up claiming an object on the relay"
        );
        assert!(
            emitted_reference(&db, &hash).is_none(),
            "the pointer went out to every peer after the user revoked it"
        );
        assert_eq!(
            discarded,
            vec!["obj-revoked".to_string()],
            "the bytes the user revoked are still on the relay, and its orphan GC bails"
        );
    }

    /// C2 — THE KEY AND THE REFERENCE COMMIT TOGETHER OR NOT AT ALL.
    ///
    /// The window: the `UPDATE attachments SET object_key` ran in
    /// autocommit mode and the emit was a separate statement that went
    /// through `try_apply`, which swallows every error at warn level by
    /// design. A crash between them — or an op_log INSERT that simply
    /// failed, disk full, WAL error — left `object_key IS NOT NULL`
    /// with no reference op anywhere. The row stops matching
    /// `pending_object_upload`, the toggle still reads "on", no peer
    /// has ever heard of the file, and no query in the codebase looks
    /// for that state. The bytes were paid for and delivered to nobody.
    ///
    /// The failing INSERT is a trigger rather than a mocked engine
    /// because the point is that a REAL op_log write failure rolls the
    /// key back — the same shape the disk-full case has.
    #[test]
    fn an_op_log_failure_rolls_the_object_key_back_and_leaves_the_row_pending() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = seed_upload_candidate(&db, dir.path(), b"uploaded, then the log failed");
        {
            let conn = db.lock().unwrap();
            conn.execute_batch(
                "CREATE TRIGGER no_attachment_ops BEFORE INSERT ON op_log \
                 WHEN NEW.op_kind = 'attachment_blob' \
                 BEGIN SELECT RAISE(ABORT, 'simulated disk full'); END;",
            )
            .unwrap();
        }

        let mut upload = |_: &[u8]| -> Result<(String, i64), String> { Ok(("obj-orphan".into(), 0)) };
        let mut discarded: Vec<String> = Vec::new();
        let mut discard = |k: &str| -> Result<(), String> {
            discarded.push(k.to_string());
            Ok(())
        };
        let n =
            object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut discard).unwrap();

        assert_eq!(n, 0, "nothing was published");
        assert!(
            object_key_of(&db, &hash).is_none(),
            "the row records an object whose reference op never existed — nothing will ever \
             emit it and nothing will ever re-upload it"
        );
        assert!(emitted_reference(&db, &hash).is_none());
        assert_eq!(
            pending_object_upload_at(&db, now_ms() + upload_retry_delay_ms(1) + 1)
                .unwrap()
                .len(),
            1,
            "the row must stay pending so a later tick retries"
        );
        assert_eq!(
            discarded,
            vec!["obj-orphan".to_string()],
            "the object nobody points at is taken back off the relay — it has no orphan GC, \
             so an unreferenced object is paid for forever"
        );
    }

    /// One relay failure must not stop the attachments behind it, and
    /// the sweep must not abort — same rule the fetch side follows.
    #[test]
    fn a_failed_upload_does_not_abort_the_sweep() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let bad = seed_upload_candidate(&db, dir.path(), b"x");
        let good = seed_upload_candidate(&db, dir.path(), b"the longer one, sorted second");

        let mut upload = |plaintext: &[u8]| -> Result<(String, i64), String> {
            if plaintext == b"x" {
                Err("relay 503".into())
            } else {
                Ok(("obj-good".into(), 0))
            }
        };
        let n = object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut never_discard()).unwrap();

        assert_eq!(n, 1);
        assert!(object_key_of(&db, &bad).is_none());
        assert_eq!(object_key_of(&db, &good).as_deref(), Some("obj-good"));
    }

    /// `has_local` said the bytes were here and they aren't (a manual
    /// deletion under the app, a half-restored backup). Nothing to
    /// upload, so nothing is claimed — and no op is emitted for bytes
    /// that don't exist.
    #[test]
    fn an_attachment_whose_bytes_are_missing_is_skipped_not_referenced() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        add_attachment_with_size(&db, &"e".repeat(64), true, true, 10);

        let mut upload = |_: &[u8]| -> Result<(String, i64), String> {
            panic!("nothing should be uploaded for a blob that isn't on disk")
        };
        let n = object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut never_discard()).unwrap();
        assert_eq!(n, 0);
        assert!(emitted_reference(&db, &"e".repeat(64)).is_none());
    }

    /// Two sweeps, one upload. Both self-limiting conditions are live:
    /// the row has an object key and the op exists.
    #[test]
    fn a_second_sweep_does_not_re_upload_the_same_attachment() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let engine = engine_for(&db);
        seed_upload_candidate(&db, dir.path(), b"uploaded once");

        let mut calls = 0;
        let mut upload = |_: &[u8]| -> Result<(String, i64), String> {
            calls += 1;
            Ok((format!("obj-{calls}"), 0))
        };
        assert_eq!(object_upload_with(&db, dir.path(), &engine, &mut upload, &mut never_discard()).unwrap(), 1);
        assert_eq!(object_upload_with(&db, dir.path(), &engine, &mut upload, &mut never_discard()).unwrap(), 0);
        assert_eq!(calls, 1, "the bytes crossed the wire exactly once");
    }

    /// `size_bytes` comes from the file that was actually sealed, not
    /// from the row — the same rule the fetch side follows in the other
    /// direction. A row whose size is stale would otherwise ship a
    /// reference op that disagrees with its own object.
    #[test]
    fn upload_re_derives_size_bytes_from_the_bytes_it_sent() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"twenty-nine bytes exactly ok!".to_vec();
        let hash = crate::attachments::store::hash_hex(&bytes);
        crate::attachments::store::write_blob(dir.path(), &hash, &bytes).unwrap();
        add_attachment_with_size(&db, &hash, true, true, 999_999);

        let mut upload = |_: &[u8]| -> Result<(String, i64), String> { Ok(("obj-size".into(), 0)) };
        object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut never_discard()).unwrap();

        let op = emitted_reference(&db, &hash).unwrap();
        assert_eq!(op.size_bytes, bytes.len() as i64);
        assert_eq!(row_size_bytes(&db, &hash), bytes.len() as i64);
    }

    // ── sealing under the current epoch (Task 11) ─────────────────────
    //
    // THE DEFECT: every attachment object was sealed with
    // `user_keys.content_master_key` — the epoch-0, phrase-derived key —
    // no matter how many rotations had happened. Ops never worked that
    // way (`sync/upload.rs` resolves the key for the op's own epoch).
    // A device revoked at epoch N keeps the epoch-0 key forever, so it
    // could decrypt every attachment uploaded AFTER its revocation.
    // Rotation is supposed to end a revoked device's access; for
    // attachments it did not.

    fn fresh_user_keys() -> crate::sync::keys::UserKeys {
        crate::sync::keys::user_keys_from_phrase(&crate::sync::keys::generate_seed_phrase())
    }

    /// Put the account on `epoch` with a real epoch secret, the way
    /// `rotation::rotate_after_revoke` step 6 does.
    fn rotate_to(db: &Db, epoch: i64) -> [u8; 32] {
        let es = crate::sync::epoch::generate_epoch_secret();
        let conn = db.lock().unwrap();
        crate::sync::config::put_epoch_secret(&conn, epoch, &es).unwrap();
        crate::sync::config::set_current_epoch(&conn, epoch).unwrap();
        es
    }

    fn object_epoch_of_row(db: &Db, hash: &str) -> Option<i64> {
        let conn = db.lock().unwrap();
        conn.query_row(
            "SELECT object_epoch FROM attachments WHERE blob_hash = ?1",
            rusqlite::params![hash],
            |r| r.get::<_, Option<i64>>(0),
        )
        .unwrap()
    }

    /// ★ THE SECURITY TEST. Everything else in this block is scaffolding
    /// around it.
    ///
    /// An object sealed after a rotation must NOT open with the epoch-0
    /// key. That key is exactly what a revoked device still holds: it is
    /// derived from the account phrase, it was never rotated away, and
    /// nothing can take it back. If this assertion fails, revoking a
    /// device does not revoke its access to attachments — which is the
    /// entire security property rotation is sold on.
    ///
    /// Written against the production seal (`seal_epoch_and_key` +
    /// `seal_object`), not a re-implementation of it, so it fails if the
    /// upload path ever goes back to the account key.
    #[test]
    fn an_object_sealed_at_epoch_n_does_not_open_with_the_epoch_zero_key() {
        let db = test_db();
        let user_keys = fresh_user_keys();
        let es = rotate_to(&db, 1);
        let plaintext = b"the file a revoked device must not be able to read".to_vec();

        let (epoch, content_key) = {
            let conn = db.lock().unwrap();
            seal_epoch_and_key(&conn, &user_keys).unwrap()
        };
        assert_eq!(epoch, 1, "sealed under the account's current epoch");
        let (_object_key, ciphertext) = seal_object(&content_key, &plaintext);

        // The revoked device's view: it holds the phrase-derived key and
        // the ciphertext it can still GET off the relay.
        assert!(
            crate::sync::envelope::decrypt_op(&user_keys.content_master_key, &ciphertext).is_err(),
            "an object sealed at epoch 1 opened with the epoch-0 key — a device revoked at \
             epoch 1 can read attachments uploaded after its revocation"
        );

        // And an entitled device, which holds the epoch secret, opens it.
        let epoch_key = crate::sync::epoch::epoch_keys_from_secret(&es).content_master_key;
        let (_id, opened) =
            crate::sync::envelope::decrypt_op(&epoch_key, &ciphertext).expect("epoch 1 opens it");
        assert_eq!(opened, plaintext);
    }

    /// The epoch an object is sealed under and the epoch an op is
    /// stamped with come from ONE place: `config::get_current_epoch`,
    /// read by `op_log::dispatch`'s `apply` and by `seal_epoch_and_key`.
    /// Two sources would drift, and a reference naming the wrong epoch
    /// is unopenable forever.
    #[test]
    fn the_seal_epoch_is_the_same_one_the_op_log_stamps() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let user_keys = fresh_user_keys();
        rotate_to(&db, 4);

        let sealed_at = {
            let conn = db.lock().unwrap();
            seal_epoch_and_key(&conn, &user_keys).unwrap().0
        };

        // Emit a real op through the real engine and read the epoch the
        // op log stamped on it.
        let hash = seed_upload_candidate(&db, dir.path(), b"same epoch, both sides");
        let mut upload = |_: &[u8]| -> Result<(String, i64), String> { Ok(("obj-e".into(), sealed_at)) };
        object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut never_discard()).unwrap();
        let stamped: i64 = {
            let conn = db.lock().unwrap();
            conn.query_row(
                "SELECT epoch FROM op_log WHERE op_kind = 'attachment_blob' AND doc_id = ?1",
                rusqlite::params![&hash],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(
            sealed_at, stamped,
            "the object's seal epoch and the op's stamped epoch must come from the same row"
        );
        assert_eq!(stamped, 4);
    }

    /// Rule: a missing key for the current epoch on UPLOAD is a real
    /// error. `sync/upload.rs` treats it the same way — "the device must
    /// hold the key for any epoch it stamps". The row is left pending so
    /// the next tick retries once the epoch secret arrives. The one
    /// thing it must never do is fall back to the epoch-0 key, which
    /// would silently restore the defect.
    #[test]
    fn a_missing_epoch_key_on_upload_fails_rather_than_sealing_under_epoch_zero() {
        let db = test_db();
        let user_keys = fresh_user_keys();
        // Current epoch says 2 but no epoch secret was ever stored: this
        // device cannot seal under the epoch it is supposed to.
        {
            let conn = db.lock().unwrap();
            crate::sync::config::set_current_epoch(&conn, 2).unwrap();
        }
        let conn = db.lock().unwrap();
        // `SecretKey32` has no Debug (deliberately — it's key material),
        // so match rather than `expect_err`.
        match seal_epoch_and_key(&conn, &user_keys) {
            Ok((epoch, _)) => panic!(
                "sealed at epoch {epoch} with no key for the current epoch — the only way that \
                 succeeds is by falling back to the account key, which is the defect"
            ),
            Err(e) => assert!(e.contains("epoch 2"), "unhelpful error: {e}"),
        }
    }

    /// The whole sweep at a non-zero epoch: what lands on the row and
    /// what goes out on the reference op is the epoch actually sealed
    /// under, not the account's phrase-derived default.
    #[test]
    fn upload_records_the_seal_epoch_on_the_row_and_on_the_reference() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = seed_upload_candidate(&db, dir.path(), b"sealed after a rotation");

        let mut upload = |_: &[u8]| -> Result<(String, i64), String> { Ok(("obj-epoch-3".into(), 3)) };
        assert_eq!(
            object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut never_discard()).unwrap(),
            1
        );

        assert_eq!(object_epoch_of_row(&db, &hash), Some(3));
        let op = emitted_reference(&db, &hash).unwrap();
        assert_eq!(
            crate::sync::wire::attachment_blob::object_epoch_of(&op),
            3,
            "a peer has no other way to know which key opens the object"
        );
    }

    /// A failed upload records neither address nor epoch — the pair is
    /// written together or not at all.
    #[test]
    fn a_failed_upload_records_no_epoch_either() {
        let db = test_db();
        let dir = tempfile::tempdir().unwrap();
        let hash = seed_upload_candidate(&db, dir.path(), b"never lands");
        let mut upload =
            |_: &[u8]| -> Result<(String, i64), String> { Err("no content key for epoch 2".into()) };
        assert_eq!(
            object_upload_with(&db, dir.path(), &engine_for(&db), &mut upload, &mut never_discard()).unwrap(),
            0
        );
        assert!(object_key_of(&db, &hash).is_none());
        assert!(object_epoch_of_row(&db, &hash).is_none());
        assert_eq!(
            pending_object_upload_at(&db, now_ms() + upload_retry_delay_ms(1) + 1)
                .unwrap()
                .len(),
            1,
            "still pending once the failure's backoff expires"
        );
    }

    /// The fetch is driven by the epoch on the ROW, so an object sealed
    /// at epoch 5 is opened with epoch 5's key.
    #[test]
    fn fetch_asks_for_the_key_of_the_epoch_the_object_was_sealed_under() {
        let db = test_db();
        let bytes = b"sealed at five".to_vec();
        let hash = crate::attachments::store::hash_hex(&bytes);
        add_referenced_attachment(&db, &hash, "obj-five");
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE attachments SET object_epoch = 5 WHERE blob_hash = ?1",
                rusqlite::params![&hash],
            )
            .unwrap();
        }
        let dir = tempfile::tempdir().unwrap();

        let mut seen_epoch = None;
        let mut fetch = |_: &str, epoch: i64| -> Result<Vec<u8>, FetchSkip> {
            seen_epoch = Some(epoch);
            Ok(bytes.clone())
        };
        assert_eq!(object_fetch_with(&db, dir.path(), &mut fetch).unwrap(), 1);
        assert_eq!(seen_epoch, Some(5));
    }

    /// ABSENT MEANS 0, AND IT IS NOT A FALLBACK.
    ///
    /// A row whose `object_key` was recorded before `object_epoch`
    /// existed carries NULL. Those objects were sealed by a build that
    /// used `user_keys.content_master_key` for everything — which IS the
    /// epoch-0 key — so opening them at epoch 0 is not a guess about
    /// what they might be, it is what they demonstrably are. Reading
    /// them any other way would fail.
    #[test]
    fn a_row_with_no_recorded_epoch_is_opened_at_epoch_zero_because_that_is_what_sealed_it() {
        let db = test_db();
        let bytes = b"uploaded before the epoch column existed".to_vec();
        let hash = crate::attachments::store::hash_hex(&bytes);
        add_referenced_attachment(&db, &hash, "obj-legacy");
        assert!(
            object_epoch_of_row(&db, &hash).is_none(),
            "the column is genuinely NULL, not 0"
        );
        let dir = tempfile::tempdir().unwrap();

        let mut seen_epoch = None;
        let mut fetch = |_: &str, epoch: i64| -> Result<Vec<u8>, FetchSkip> {
            seen_epoch = Some(epoch);
            Ok(bytes.clone())
        };
        assert_eq!(object_fetch_with(&db, dir.path(), &mut fetch).unwrap(), 1);
        assert_eq!(seen_epoch, Some(0));
        assert!(row_has_local(&db, &hash), "and it opened, so it landed");
    }

    /// Rule: a missing key on FETCH is not an error, it is the intended
    /// lockout — this device wasn't given the epoch secret. Leave the row
    /// alone: no write, no `has_local`, no panic, and no spinning on the
    /// network. `FetchSkip::AlreadyReported` is what keeps the sweep from
    /// logging it every tick.
    #[test]
    fn an_object_this_device_has_no_epoch_key_for_is_left_alone() {
        let db = test_db();
        let hash = "f".repeat(64);
        add_referenced_attachment(&db, &hash, "obj-locked-out");
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE attachments SET object_epoch = 9 WHERE blob_hash = ?1",
                rusqlite::params![&hash],
            )
            .unwrap();
        }
        let dir = tempfile::tempdir().unwrap();

        // What `run_object_fetch_at` does when
        // `content_master_key_for_epoch` returns None: report once, skip.
        let mut fetch =
            |_: &str, _: i64| -> Result<Vec<u8>, FetchSkip> { Err(FetchSkip::AlreadyReported) };
        assert_eq!(object_fetch_with(&db, dir.path(), &mut fetch).unwrap(), 0);

        // Untouched — not marked local, not deleted, still listed. This
        // empty result is right because the alternative to doing nothing
        // is either fabricating a local file or dropping a real
        // attachment out of the storage panel.
        assert!(!row_has_local(&db, &hash));
        assert!(!crate::attachments::store::has_local(dir.path(), &hash));
        assert_eq!(
            pending_object_fetch(&db).unwrap().len(),
            1,
            "the row stays: if this device is re-entitled the epoch secret arrives and it opens"
        );
    }

    /// A locked-out row must not stop the ones behind it. Same rule the
    /// relay-down case follows.
    #[test]
    fn a_locked_out_object_does_not_abort_the_sweep() {
        let db = test_db();
        let ok_bytes = b"openable".to_vec();
        let ok_hash = crate::attachments::store::hash_hex(&ok_bytes);
        add_referenced_attachment(&db, "locked", "obj-locked");
        add_referenced_attachment(&db, &ok_hash, "obj-open");
        let dir = tempfile::tempdir().unwrap();

        let mut fetch = |k: &str, _: i64| -> Result<Vec<u8>, FetchSkip> {
            if k == "obj-locked" {
                Err(FetchSkip::AlreadyReported)
            } else {
                Ok(ok_bytes.clone())
            }
        };
        assert_eq!(object_fetch_with(&db, dir.path(), &mut fetch).unwrap(), 1);
        assert!(!row_has_local(&db, "locked"));
        assert!(row_has_local(&db, &ok_hash));
    }

    /// The full local round trip at a non-zero epoch, through the same
    /// two production functions the upload and fetch paths use: seal
    /// under the current epoch, then open with the key resolved for the
    /// epoch that was recorded.
    #[test]
    fn an_object_sealed_at_a_rotated_epoch_round_trips_through_the_recorded_epoch() {
        let db = test_db();
        let user_keys = fresh_user_keys();
        rotate_to(&db, 2);
        let plaintext = b"round trip after two rotations".to_vec();

        let (epoch, key) = {
            let conn = db.lock().unwrap();
            seal_epoch_and_key(&conn, &user_keys).unwrap()
        };
        let (object_key, ciphertext) = seal_object(&key, &plaintext);
        assert_eq!(
            crate::sync::envelope::blob_hash_hex(&ciphertext),
            object_key,
            "the relay addresses the object by blake3 of the body it is given"
        );

        // The opener knows only the epoch off the reference.
        let opener_key = {
            let conn = db.lock().unwrap();
            crate::sync::epoch::content_master_key_for_epoch(&conn, &user_keys, epoch)
                .unwrap()
                .expect("an entitled device holds it")
        };
        let (_id, opened) =
            crate::sync::envelope::decrypt_op(&opener_key, &ciphertext).expect("opens");
        assert_eq!(opened, plaintext);
    }

    /// Epoch 0 still means the phrase-derived key, so a pre-rotation
    /// account behaves exactly as it did — nothing already on a relay
    /// becomes unreadable.
    #[test]
    fn before_any_rotation_the_seal_key_is_still_the_phrase_derived_one() {
        let db = test_db();
        let user_keys = fresh_user_keys();
        let conn = db.lock().unwrap();
        let (epoch, key) = seal_epoch_and_key(&conn, &user_keys).unwrap();
        assert_eq!(epoch, 0);
        assert_eq!(key.as_bytes(), user_keys.content_master_key.as_bytes());
    }

    // ── launch-time re-arm ────────────────────────────────────────────

    /// The state an install that swept under the pages-only GC scan is
    /// stuck in: bytes gone, `gc_swept = 1`, relay object still alive.
    fn add_swept_attachment(db: &Db, hash: &str) {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at, object_key, object_epoch, gc_swept) \
             VALUES (?1, 'contract.pdf', 'application/pdf', 37, 1, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'obj-alive', 0, 1)",
            rusqlite::params![hash],
        )
        .unwrap();
    }

    fn swept_flag(db: &Db, hash: &str) -> i64 {
        let conn = db.lock().unwrap();
        conn.query_row(
            "SELECT gc_swept FROM attachments WHERE blob_hash = ?1",
            rusqlite::params![hash],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn attachment_doc(hash: &str) -> Value {
        doc(vec![json!({
            "type": "attachment",
            "attrs": { "blob_hash": hash, "filename": "contract.pdf",
                       "mime_type": "application/pdf", "size_bytes": 37 }
        })])
    }

    fn seed_pin(db: &Db, id: &str, content: &Value) {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO shared_objects (id, source_page_id, object_type, content, status, position, created_at, updated_at) \
             VALUES (?1, NULL, 'note', ?2, 'orphaned', 0, 't', 't')",
            rusqlite::params![id, content.to_string()],
        )
        .unwrap();
    }

    /// The healing path that asks nothing of the user. The pin outlived
    /// its page, so no `pages` row names the hash — which is exactly the
    /// shape the old GC scan mistook for an orphan. With no peer op and
    /// no second press of "free up space", launch is the only moment
    /// left to notice the file is still wanted.
    #[test]
    fn launch_re_arms_a_swept_file_a_pin_still_holds() {
        let db = test_db();
        let hash = "swept-but-pinned";
        add_swept_attachment(&db, hash);
        seed_pin(&db, "pin-1", &attachment_doc(hash));

        assert_eq!(rearm_referenced_attachments(&db).unwrap(), 1);
        assert_eq!(swept_flag(&db, hash), 0);
    }

    #[test]
    fn launch_re_arms_a_swept_file_a_page_still_holds() {
        let db = test_db();
        let hash = "swept-but-written";
        add_swept_attachment(&db, hash);
        seed_page(&db, &attachment_doc(hash));

        assert_eq!(rearm_referenced_attachments(&db).unwrap(), 1);
        assert_eq!(swept_flag(&db, hash), 0);
    }

    /// The other half, and the trap: a swept blob nothing references is
    /// the orphan the user chose to drop. Asserting the flag is still
    /// set because that is the invariant — a blanket clear at launch
    /// would undo every explicit GC on the next start, and the fetch
    /// sweep would pull the whole set back down within 30 seconds.
    #[test]
    fn launch_leaves_a_swept_orphan_swept() {
        let db = test_db();
        let hash = "the-orphan-the-user-dropped";
        add_swept_attachment(&db, hash);
        seed_page(&db, &attachment_doc("some-other-file"));

        assert_eq!(rearm_referenced_attachments(&db).unwrap(), 0);
        assert_eq!(swept_flag(&db, hash), 1);
    }

    /// THE COMMON CASE PAYS NOTHING. Nobody has pressed "free up space",
    /// so no row carries `gc_swept = 1` and the two-root content scan —
    /// every page body and every pin body, read and JSON-parsed under
    /// the db lock, at every launch — cannot change a single row. The
    /// assertion is that it never runs, not that it runs quickly: a
    /// timing claim would be unfalsifiable, and this is the whole fix.
    ///
    /// The pages and pins are seeded deliberately: with an empty library
    /// the scan is cheap and skipping it would prove nothing.
    #[test]
    fn nothing_swept_means_the_reference_scan_never_runs() {
        let db = test_db();
        seed_page(&db, &attachment_doc("a-file-in-a-page"));
        seed_pin(&db, "pin-scan", &attachment_doc("a-file-in-a-pin"));
        // A row that was never swept: present, so the check is answering
        // "none are swept" rather than "the table is empty".
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at) \
                 VALUES ('a-file-in-a-page', 'contract.pdf', 'application/pdf', 37, 1, 1, 't', 't')",
                [],
            )
            .unwrap();
        }

        let mut scanned = 0usize;
        let mut scan = |conn: &rusqlite::Connection| {
            scanned += 1;
            crate::attachments::commands::referenced_blob_hashes(conn)
        };
        assert_eq!(rearm_referenced_attachments_with(&db, &mut scan).unwrap(), 0);
        assert_eq!(scanned, 0, "the content scan ran with nothing it could re-arm");
    }

    /// The other direction, so the early-out cannot be widened into
    /// "never scan": one swept row is enough to pay for the scan, and
    /// the re-arm still happens.
    #[test]
    fn one_swept_row_still_earns_the_scan() {
        let db = test_db();
        let hash = "swept-and-still-pinned";
        add_swept_attachment(&db, hash);
        seed_pin(&db, "pin-earns", &attachment_doc(hash));

        let mut scanned = 0usize;
        let mut scan = |conn: &rusqlite::Connection| {
            scanned += 1;
            crate::attachments::commands::referenced_blob_hashes(conn)
        };
        assert_eq!(rearm_referenced_attachments_with(&db, &mut scan).unwrap(), 1);
        assert_eq!(scanned, 1);
        assert_eq!(swept_flag(&db, hash), 0);
    }
}
