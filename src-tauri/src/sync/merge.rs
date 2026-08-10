//! Apply a received op into the local domain tables.
//!
//! Phase 14.11 wires the decrypted JSON payload back into `pages`,
//! `lineages`, `shared_objects`, and `settings`. Conflict policy is
//! last-writer-wins by relay-assigned `user_seq`: the pull pipeline
//! processes ops in ascending `user_seq` order (see
//! `sync::pull::run_pass`), so a later UPDATE simply overwrites
//! whatever an earlier op (local or remote) put there.
//!
//! Scope: settings, page content + matters/shifted, lineage lifecycle,
//! pin lifecycle, and `page_yjs` for continuous trails (CRDT-aware via
//! `crate::sync::yjs::apply_update`). Line-level page ops (`save_line`,
//! `update_line_text`, etc.) are skipped because the writing surface
//! flushes the full TipTap doc via `save_page_content` after every
//! meaningful change, so the line-level deltas are redundant for
//! receive-side state.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeOutcome {
    /// Op was recognised AND mutated local state.
    Applied,
    /// op_kind we don't have a handler for yet. Pull loop continues.
    SkippedUnknownKind,
    /// op_kind known, but the per-kind handler doesn't recognise this
    /// op_name. Pull loop continues with a debug-level log.
    SkippedUnknownOp,
    /// Payload was malformed (missing required fields). Pull loop
    /// continues — we don't want one bad op to wedge sync.
    SkippedMalformed,
    /// The target row's `applied_hlc_ts` is already >= this op's HLC,
    /// so applying would overwrite newer state with older. The op
    /// stays in op_log (audit trail) but the domain row is untouched.
    SkippedStaleHlc,
}

#[derive(Debug)]
pub enum MergeError {
    Db(String),
}

impl std::fmt::Display for MergeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MergeError::Db(s) => write!(f, "merge db error: {s}"),
        }
    }
}

impl std::error::Error for MergeError {}

impl From<rusqlite::Error> for MergeError {
    fn from(e: rusqlite::Error) -> Self {
        MergeError::Db(e.to_string())
    }
}

/// Top-level dispatcher. Called by `sync::pull::apply_remote_op` after
/// the ciphertext has been decrypted and the `op_log` row written.
///
/// HLC ordering: each op's `hlc_ts` is embedded in the JSON payload by
/// `op_log/dispatch.rs::OpLogEngine::apply` on the sender. Here we
/// pull it back out and pass it to each handler, which gates the
/// domain-table write by `applied_hlc_ts < hlc_ts`. An op with an
/// older HLC than the row's currently-applied state returns
/// `SkippedStaleHlc` and leaves the row untouched.
pub fn apply(
    conn: &Connection,
    op_kind: &str,
    payload_blob: &[u8],
) -> Result<MergeOutcome, MergeError> {
    let payload: Value = match serde_json::from_slice(payload_blob) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("merge: payload JSON parse failed (op_kind={op_kind}): {e}");
            return Ok(MergeOutcome::SkippedMalformed);
        }
    };

    // Absent hlc_ts → treat as 0, which means any existing row wins
    // (applied_hlc_ts >= 0 is always true). Forward-compat with a v0.3
    // op that pre-dates the HLC payload embedding.
    let hlc_ts = payload
        .get("hlc_ts")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    match op_kind {
        "setting_op" => merge_setting(conn, &payload, hlc_ts),
        "page_blob" => merge_page(conn, &payload, hlc_ts),
        "page_yjs" => merge_page_yjs(conn, &payload, hlc_ts),
        "lineage_op" => merge_lineage(conn, &payload, hlc_ts),
        "pin_op" => merge_pin(conn, &payload, hlc_ts),
        "tombstone" => merge_tombstone(conn, &payload, hlc_ts),
        "attachment_blob" => merge_attachment_blob(conn, &payload, hlc_ts),
        _ => Ok(MergeOutcome::SkippedUnknownKind),
    }
}

/// Apply an incoming yjs update to the receiver's local Y.Doc state
/// for the named page. Phase 14.18 wires the storage: the prior
/// `pages.yjs_state` (if any) is decoded, the incoming update is
/// folded in, and the merged bytes are written back.
///
/// **HLC gating: intentionally absent.** A yjs update is a CRDT
/// payload — applying it out of order produces the same final state
/// as applying it in order (verified by sync::yjs::tests::
/// updates_converge_regardless_of_order). Stale page_yjs updates
/// from peers are NOT redundant; they may carry edits that have not
/// been merged elsewhere. The HLC stamp on the row tracks the latest
/// observed update for observability (MAX semantics) but never gates
/// the merge itself. This is the load-bearing distinction between
/// the prose CRDT and the lww-by-hlc primitives in the rest of this
/// file.
fn merge_page_yjs(
    conn: &Connection,
    payload: &Value,
    hlc_ts: i64,
) -> Result<MergeOutcome, MergeError> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let Some(page_id) = payload.get("page_id").and_then(|v| v.as_str()) else {
        return Ok(MergeOutcome::SkippedMalformed);
    };
    let Some(update_b64) = payload
        .get("fields")
        .and_then(|f| f.get("update"))
        .and_then(|v| v.as_str())
    else {
        return Ok(MergeOutcome::SkippedMalformed);
    };
    let update_bytes = match B64.decode(update_b64) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("yjs merge: update_b64 not base64 (page_id={page_id}): {e}");
            return Ok(MergeOutcome::SkippedMalformed);
        }
    };

    // Read the page row's current yjs_state. A missing row means we
    // haven't received the create_new_page op yet — the page_yjs op
    // is orphaned; log + skip rather than create a phantom row.
    let prior: Option<Option<Vec<u8>>> = conn
        .query_row(
            "SELECT yjs_state FROM pages WHERE id = ?",
            params![page_id],
            |r| r.get::<_, Option<Vec<u8>>>(0),
        )
        .ok()
        .map(Some)
        .unwrap_or(None);
    let prior_state: Option<Vec<u8>> = match prior {
        // A missing row means we haven't received the create_new_page op
        // yet — the page_yjs op is orphaned. Skip rather than fabricate a
        // phantom row (the create op will arrive and carry the page, then
        // a later yjs update folds in). yjs itself is not HLC-gated; the
        // only skip reason here is the absent page.
        Some(opt) => opt,
        None => return Ok(MergeOutcome::SkippedMalformed),
    };

    let merged = match crate::sync::yjs::apply_update(prior_state.as_deref(), &update_bytes) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("yjs merge: invalid update for page_id={page_id}: {e}");
            return Ok(MergeOutcome::SkippedMalformed);
        }
    };

    // The sender may include a content_json snapshot derived from the
    // yjs state so receivers can keep their FTS index fresh without
    // running a yrs→TipTap-JSON conversion themselves. Optional —
    // older peers won't include it, and receivers' editors can re-
    // derive it on next open.
    let snapshot_json = payload
        .get("fields")
        .and_then(|f| f.get("content_json"))
        .and_then(|v| v.as_str());

    // Persist merged state. The HLC stamp uses MAX so that an out-of-
    // order arrival doesn't decrement the observed-watermark. The
    // updated_at touch keeps the page row's mtime fresh for the
    // memory-view rolodex. When a content_json snapshot is present,
    // overwrite the column too — yjs_state is the source of truth so
    // the snapshot can't fight it.
    let now = chrono::Utc::now().to_rfc3339();
    match snapshot_json {
        Some(snap) => {
            conn.execute(
                "UPDATE pages
                    SET yjs_state = ?,
                        content_json = ?,
                        updated_at = ?,
                        applied_hlc_ts = MAX(applied_hlc_ts, ?)
                  WHERE id = ?",
                params![merged, snap, &now, hlc_ts, page_id],
            )?;
            // The snapshot just became this device's content for the
            // page, and a continuous-trail doc carries file blocks like
            // any other. Whatever it names is referenced again, so a row
            // this device swept as an orphan must be re-armed — the yjs
            // path had no re-arm at all, which left a peer's re-added
            // attachment permanently unfetchable (`pending_object_fetch`
            // skips `gc_swept = 1`) on a page that visibly names it.
            //
            // Read the row rather than `snap`: the write above is
            // unconditional today, but every re-arm bug in this file so
            // far has been a payload trusted after a write that did not
            // land (see `rearm_swept_attachments_of_row`). Reading the
            // row is right either way, and stays right if this UPDATE
            // ever grows a gate.
            rearm_swept_attachments_of_row(conn, PAGE_CONTENT_SQL, page_id);
        }
        None => {
            conn.execute(
                "UPDATE pages
                    SET yjs_state = ?,
                        updated_at = ?,
                        applied_hlc_ts = MAX(applied_hlc_ts, ?)
                  WHERE id = ?",
                params![merged, &now, hlc_ts, page_id],
            )?;
            // No re-arm here, deliberately: content_json was NOT
            // written, so the row's references are exactly what they
            // were before this op and nothing new can be pointed at. The
            // merged yjs_state may well name a blob the mirror does not
            // — that is the same hole `referenced_blob_hashes` documents
            // (GC cannot see inside yjs_state either), and closing it
            // means decoding yjs here and there, not re-arming off a
            // stale column.
        }
    }
    Ok(MergeOutcome::Applied)
}

// ---- settings: flat key/value upsert ----

fn merge_setting(
    conn: &Connection,
    payload: &Value,
    hlc_ts: i64,
) -> Result<MergeOutcome, MergeError> {
    if op_name(payload) != "set" {
        return Ok(MergeOutcome::SkippedUnknownOp);
    }
    let Some(key) = payload.get("key").and_then(|v| v.as_str()) else {
        return Ok(MergeOutcome::SkippedMalformed);
    };
    let value: Option<&str> = payload.get("value").and_then(|v| v.as_str());
    match value {
        Some(v) => {
            // ON CONFLICT clause guards by HLC: an older op leaves the
            // row untouched. INSERT into a non-existent row always wins
            // (the row has applied_hlc_ts implicitly 0 < any positive hlc).
            let n = conn.execute(
                "INSERT INTO settings (key, value, applied_hlc_ts) VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE
                   SET value = excluded.value,
                       applied_hlc_ts = excluded.applied_hlc_ts
                   WHERE excluded.applied_hlc_ts > settings.applied_hlc_ts",
                params![key, v, hlc_ts],
            )?;
            if n == 0 {
                return Ok(MergeOutcome::SkippedStaleHlc);
            }
        }
        None => {
            let n = conn.execute(
                "DELETE FROM settings WHERE key = ? AND applied_hlc_ts < ?",
                params![key, hlc_ts],
            )?;
            if n == 0 {
                // Either the row was gone already (idempotent) or it has
                // a newer HLC than this delete (stale). Distinguish for
                // the caller: "row didn't exist" is Applied; "row exists
                // but newer" is SkippedStaleHlc.
                let present: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM settings WHERE key = ?",
                        params![key],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if present > 0 {
                    return Ok(MergeOutcome::SkippedStaleHlc);
                }
            }
        }
    }
    Ok(MergeOutcome::Applied)
}

// ---- pages: create, save_content, what_matters/shifted ----

fn merge_page(
    conn: &Connection,
    payload: &Value,
    hlc_ts: i64,
) -> Result<MergeOutcome, MergeError> {
    let op = op_name(payload);
    let Some(page_id) = payload.get("page_id").and_then(|v| v.as_str()) else {
        return Ok(MergeOutcome::SkippedMalformed);
    };
    let fields = payload.get("fields").cloned().unwrap_or(Value::Null);
    let now = chrono::Utc::now().to_rfc3339();

    match op {
        "backfill_page_initial_state" => {
            let date = fields.get("date").and_then(|v| v.as_str()).unwrap_or("1970-01-01");
            let page_number = fields.get("page_number").and_then(|v| v.as_i64()).unwrap_or(1);
            let lineage_id = fields.get("lineage_id").and_then(|v| v.as_str());
            let content = fields.get("content_json").and_then(|v| v.as_str());
            let what_matters = fields.get("what_matters_now").and_then(|v| v.as_str());
            let what_shifted = fields.get("what_shifted").and_then(|v| v.as_str());
            insert_page_with_collision_resolution(
                conn, page_id, date, page_number, lineage_id,
                content, what_matters, what_shifted, hlc_ts, &now,
            )?;
            if let Err(e) = check_pin_divergence(conn, page_id) {
                log::warn!("pin divergence check failed for page {page_id}: {e}");
            }
            if let Some(c) = content {
                if let Err(e) = rescue_orphaned_pins(conn, page_id, c) {
                    log::warn!("pin orphan rescue failed for page {page_id}: {e}");
                }
                // Re-arm from what the row NOW holds, not from `c`.
                // `insert_page_with_collision_resolution` returns early when
                // the id already exists, and this op is a *backfill* — two
                // devices routinely backfill the same pre-op-log page, so the
                // skipped-insert case is the common one, and `c` is then a
                // snapshot this device may have moved on from.
                rearm_swept_attachments_of_row(conn, PAGE_CONTENT_SQL, page_id);
            }
            Ok(MergeOutcome::Applied)
        }
        "create_new_page" | "get_or_create_today" => {
            let Some(date) = fields.get("date").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            let Some(page_number) = fields.get("page_number").and_then(|v| v.as_i64()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            insert_page_with_collision_resolution(
                conn, page_id, date, page_number, None,
                None, None, None, hlc_ts, &now,
            )?;
            Ok(MergeOutcome::Applied)
        }
        "save_page_content" => {
            let Some(content) = fields.get("content_json").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            // Gate before writing. An absent row is reported as malformed
            // (a stray content op for a page whose create we haven't seen —
            // the create/backfill op carries the row into existence, so we
            // refuse to fabricate a phantom here); a row already stamped at
            // a newer HLC is SkippedStaleHlc. Only a present, older row is
            // updated.
            if let Some(skip) = stale_or_missing_page(conn, page_id, hlc_ts)? {
                return Ok(skip);
            }
            conn.execute(
                "UPDATE pages
                   SET content_json = ?, updated_at = ?, applied_hlc_ts = ?
                 WHERE id = ? AND applied_hlc_ts < ?",
                params![content, &now, hlc_ts, page_id, hlc_ts],
            )?;
            if let Err(e) = check_pin_divergence(conn, page_id) {
                log::warn!("pin divergence check failed for page {page_id}: {e}");
            }
            if let Err(e) = rescue_orphaned_pins(conn, page_id, content) {
                log::warn!("pin orphan rescue failed for page {page_id}: {e}");
            }
            rearm_swept_attachments(conn, content);
            Ok(MergeOutcome::Applied)
        }
        "update_what_matters_now" | "update_what_shifted" => {
            // Last-write-wins by HLC, like the page's other scalar fields.
            // This used to concatenate both edits with " · " to avoid losing
            // a concurrent cross-device focus line (design §3.30), but that
            // also concatenated a single user's *sequential* edits: changing
            // your focus showed "old · new" on the other device. A focus line
            // is a singleton, so the newest edit replaces. Genuinely concurrent
            // edits resolve to the higher HLC, which is the user expectation
            // ("take the last change").
            let text = fields.get("text").and_then(|v| v.as_str()).unwrap_or("");
            // The column name is one of two whitelisted literals so `format!`
            // is injection-safe.
            let column = if op == "update_what_matters_now" {
                "what_matters_now"
            } else {
                "what_shifted"
            };
            // Empty op text = clear (store NULL).
            let value: Option<&str> = if text.is_empty() { None } else { Some(text) };
            // A focus op can arrive before the page's create, so fabricate the
            // row if absent. ensure_page_exists stamps it at this op's hlc, so
            // the gate below uses `<=` to let this very op write its value while
            // still rejecting a strictly-older (stale) op.
            ensure_page_exists(conn, page_id, hlc_ts)?;
            let sql = format!(
                "UPDATE pages
                   SET {column} = ?, updated_at = ?, applied_hlc_ts = ?
                 WHERE id = ? AND applied_hlc_ts <= ?"
            );
            conn.execute(&sql, params![value, &now, hlc_ts, page_id, hlc_ts])?;
            Ok(MergeOutcome::Applied)
        }
        "set_focus_lineage" => {
            let lineage_id = fields.get("lineage_id").and_then(|v| v.as_str());
            let n = conn.execute(
                "UPDATE pages
                   SET lineage_id = ?, updated_at = ?, applied_hlc_ts = ?
                 WHERE id = ? AND applied_hlc_ts < ?",
                params![lineage_id, &now, hlc_ts, page_id, hlc_ts],
            )?;
            if n == 0 {
                ensure_page_exists(conn, page_id, hlc_ts)?;
                conn.execute(
                    "UPDATE pages
                       SET lineage_id = ?, updated_at = ?, applied_hlc_ts = ?
                     WHERE id = ? AND applied_hlc_ts < ?",
                    params![lineage_id, &now, hlc_ts, page_id, hlc_ts],
                )?;
            }
            Ok(MergeOutcome::Applied)
        }
        _ => Ok(MergeOutcome::SkippedUnknownOp),
    }
}

/// Auto-create a page row if it doesn't exist. Used when a content op
/// arrives before the corresponding create op (out-of-order delivery).
fn ensure_page_exists(conn: &Connection, page_id: &str, hlc_ts: i64) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let page_number = next_free_page_number(conn, &today)?;
    conn.execute(
        "INSERT OR IGNORE INTO pages
           (id, date, page_number, created_at, updated_at, applied_hlc_ts)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![page_id, &today, page_number, &now, &now, hlc_ts],
    )?;
    Ok(())
}

/// Classify a page-targeting LWW op against the target row before it
/// writes. Returns `Some(outcome)` when the op must be skipped — either
/// the page row is absent (`SkippedMalformed`, so we never fabricate a
/// phantom row from a stray content op) or the row's `applied_hlc_ts`
/// already stamps a state at least as new as this op (`SkippedStaleHlc`).
/// Returns `None` when the op should proceed (row exists and the op is
/// strictly newer than the row's applied stamp).
fn stale_or_missing_page(
    conn: &Connection,
    page_id: &str,
    hlc_ts: i64,
) -> Result<Option<MergeOutcome>, MergeError> {
    let applied: Option<i64> = conn
        .query_row(
            "SELECT applied_hlc_ts FROM pages WHERE id = ?",
            params![page_id],
            |r| r.get(0),
        )
        .optional()?;
    match applied {
        None => Ok(Some(MergeOutcome::SkippedMalformed)),
        Some(stamp) if stamp >= hlc_ts => Ok(Some(MergeOutcome::SkippedStaleHlc)),
        Some(_) => Ok(None),
    }
}

/// Find the next available page_number for a given date. Used when
/// a synced page collides with the existing UNIQUE(date, page_number)
/// constraint — two devices both created page 1 for today.
fn next_free_page_number(conn: &Connection, date: &str) -> rusqlite::Result<i64> {
    let max: Option<i64> = conn
        .query_row(
            "SELECT MAX(page_number) FROM pages WHERE date = ?",
            params![date],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    Ok(max.unwrap_or(0) + 1)
}

/// Insert a page, resolving date+page_number collisions by assigning
/// the next free page_number. Returns the actual page_number used.
fn insert_page_with_collision_resolution(
    conn: &Connection,
    page_id: &str,
    date: &str,
    requested_page_number: i64,
    lineage_id: Option<&str>,
    content: Option<&str>,
    what_matters: Option<&str>,
    what_shifted: Option<&str>,
    hlc_ts: i64,
    now: &str,
) -> rusqlite::Result<()> {
    // If the page already exists with this id, do nothing (idempotent).
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM pages WHERE id = ?",
            params![page_id],
            |r| r.get(0),
        )
        .optional()?;
    if existing_id.is_some() {
        return Ok(());
    }
    // Check for collision on (date, page_number).
    let mut page_number = requested_page_number;
    let collision: Option<String> = conn
        .query_row(
            "SELECT id FROM pages WHERE date = ? AND page_number = ?",
            params![date, page_number],
            |r| r.get(0),
        )
        .optional()?;
    if collision.is_some() {
        page_number = next_free_page_number(conn, date)?;
    }
    // Use the op's HLC physical time as created_at so the page's
    // created_at reflects when it was originally created, not when this
    // device received the sync op. This keeps rail order consistent
    // across devices (HLC is monotonic and synced).
    let created_at = hlc_to_rfc3339(hlc_ts).unwrap_or_else(|| now.to_string());
    conn.execute(
        "INSERT INTO pages
           (id, date, page_number, lineage_id, content_json,
            what_matters_now, what_shifted,
            created_at, updated_at, applied_hlc_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            page_id, date, page_number, lineage_id, content,
            what_matters, what_shifted,
            created_at, now, hlc_ts
        ],
    )?;
    Ok(())
}

/// A merged page or pin op names blob hashes. Any of them this device
/// has swept must be un-swept: something references the file again.
///
/// `gc_swept = 1` is a one-word claim — "the user asked to be rid of an
/// orphan" — and it shuts every path back to the bytes
/// (`attachments::backfill::pending_object_fetch` skips swept rows,
/// `attachment_open` has no fetch-on-demand, `should_enqueue_blob`
/// requires has_local). The claim stops being true the moment a
/// reference lands, and a peer's op is one of the two ways that
/// happens. The other is [`attachments::commands::attachment_gc_inner`],
/// which re-arms on the same rule; this one is the half that needs no
/// action from the user, and it is what recovers a device that swept a
/// pinned file before the GC scan learned to look at pins.
///
/// Best-effort by design: it only ever clears a flag, so a failure here
/// must not fail the merge that carried the reference.
fn rearm_swept_attachments(conn: &Connection, content_json: &str) {
    let mut hashes = std::collections::HashSet::new();
    crate::attachments::commands::collect_blob_hashes(content_json, &mut hashes);
    for hash in hashes {
        if let Err(e) = conn.execute(
            "UPDATE attachments SET gc_swept = 0 WHERE blob_hash = ?1 AND gc_swept = 1",
            params![&hash],
        ) {
            log::warn!("merge: could not re-arm swept attachment {hash}: {e}");
        }
    }
}

const PAGE_CONTENT_SQL: &str = "SELECT content_json FROM pages WHERE id = ?";
const PIN_CONTENT_SQL: &str = "SELECT content FROM shared_objects WHERE id = ?";

/// Re-arm from the row's CURRENT content, for the ops whose write may
/// silently not have applied.
///
/// `gc_swept = 0` is only true of a hash something on THIS device still
/// references. An op's payload is evidence of that only when the op's
/// write actually landed: `insert_page_with_collision_resolution`
/// returns early for a known page id, and `INSERT OR IGNORE` leaves an
/// existing pin alone, and in both cases the payload describes a state
/// this device never adopted. Two devices each backfilling the same
/// pre-op-log page is the ordinary way that happens — the peer's
/// backfill carries the OLD snapshot, the insert is skipped, and
/// re-arming on the payload would un-sweep a blob the user explicitly
/// freed, which `pending_object_fetch` then re-downloads inside 30
/// seconds. Reading the row instead makes the re-arm say what it means
/// whether or not the write applied. The sites whose write is already
/// gated (`save_page_content`, `update_pin_content`) call
/// [`rearm_swept_attachments`] directly — there the payload IS the row.
fn rearm_swept_attachments_of_row(conn: &Connection, sql: &str, id: &str) {
    let current: Option<String> = match conn
        .query_row(sql, params![id], |r| r.get::<_, Option<String>>(0))
        .optional()
    {
        Ok(v) => v.flatten(),
        Err(e) => {
            log::warn!("merge: could not read content for re-arm (id={id}): {e}");
            return;
        }
    };
    if let Some(content) = current {
        rearm_swept_attachments(conn, &content);
    }
}

/// After a page's content_json is updated by a remote op, scan the
/// content for pinId attrs and un-orphan any pins whose pinId is now
/// found in the source. Mirrors commands::refresh_pin_caches's
/// status-flip clause, but does NOT touch pin content or title (the
/// remote sync already handled those via pin_op ops).
fn rescue_orphaned_pins(
    conn: &Connection,
    page_id: &str,
    content_json: &str,
) -> rusqlite::Result<()> {
    let doc: Value = match serde_json::from_str(content_json) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    let mut pin_ids: Vec<String> = Vec::new();
    fn walk(node: &Value, out: &mut Vec<String>) {
        if let Some(pid) = node.get("attrs").and_then(|a| a.get("pinId")).and_then(|v| v.as_str()) {
            out.push(pid.to_string());
        }
        if let Some(arr) = node.get("content").and_then(|c| c.as_array()) {
            for child in arr {
                walk(child, out);
            }
        }
    }
    walk(&doc, &mut pin_ids);
    for pid in &pin_ids {
        conn.execute(
            "UPDATE shared_objects \
                SET status = 'open', source_page_id = COALESCE(source_page_id, ?) \
              WHERE id = ? AND status = 'orphaned'",
            params![page_id, pid],
        )?;
    }
    Ok(())
}

/// Convert a packed HLC timestamp to an RFC3339 string for created_at.
/// HLC layout: physical_ms << 16 | logical. Returns None if the time
/// is out of range for chrono.
fn hlc_to_rfc3339(hlc_ts: i64) -> Option<String> {
    if hlc_ts <= 0 {
        return None;
    }
    let physical_ms = hlc_ts >> 16;
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(physical_ms)
        .map(|dt| dt.to_rfc3339())
}

// ---- lineages: create + rename + set_parent ----

fn merge_lineage(
    conn: &Connection,
    payload: &Value,
    hlc_ts: i64,
) -> Result<MergeOutcome, MergeError> {
    let op = op_name(payload);
    let Some(lineage_id) = payload.get("lineage_id").and_then(|v| v.as_str()) else {
        return Ok(MergeOutcome::SkippedMalformed);
    };
    let fields = payload.get("fields").cloned().unwrap_or(Value::Null);
    let now = chrono::Utc::now().to_rfc3339();

    match op {
        "create_lineage" | "backfill_create_lineage" => {
            let Some(name) = fields.get("name").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            let mode = fields
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("discrete");
            let parent_id = fields.get("parent_id").and_then(|v| v.as_str());
            conn.execute(
                "INSERT OR IGNORE INTO lineages
                   (id, name, created_at, mode, parent_id, applied_hlc_ts)
                 VALUES (?, ?, ?, ?, ?, ?)",
                params![lineage_id, name, &now, mode, parent_id, hlc_ts],
            )?;
            Ok(MergeOutcome::Applied)
        }
        "rename_lineage" => {
            let Some(new_name) = fields.get("name").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            let n = conn.execute(
                "UPDATE lineages
                   SET name = ?, applied_hlc_ts = ?
                 WHERE id = ? AND applied_hlc_ts < ?",
                params![new_name, hlc_ts, lineage_id, hlc_ts],
            )?;
            if n == 0 {
                return Ok(stale_or_missing(conn, "lineages", lineage_id, hlc_ts));
            }
            Ok(MergeOutcome::Applied)
        }
        "set_lineage_parent" => {
            let parent_id = fields.get("parent_id").and_then(|v| v.as_str());
            let n = conn.execute(
                "UPDATE lineages
                   SET parent_id = ?, applied_hlc_ts = ?
                 WHERE id = ? AND applied_hlc_ts < ?",
                params![parent_id, hlc_ts, lineage_id, hlc_ts],
            )?;
            if n == 0 {
                return Ok(stale_or_missing(conn, "lineages", lineage_id, hlc_ts));
            }
            Ok(MergeOutcome::Applied)
        }
        _ => Ok(MergeOutcome::SkippedUnknownOp),
    }
}

/// Generic stale-or-missing helper for UPDATE-gated handlers. table
/// must be a whitelisted identifier (no injection — used with the
/// const set "lineages" | "shared_objects" below).
fn stale_or_missing(
    conn: &Connection,
    table: &'static str,
    id: &str,
    hlc_ts: i64,
) -> MergeOutcome {
    let sql = format!("SELECT applied_hlc_ts FROM {table} WHERE id = ?");
    let existing: Option<i64> = conn.query_row(&sql, params![id], |r| r.get(0)).ok();
    match existing {
        Some(ts) if ts >= hlc_ts => MergeOutcome::SkippedStaleHlc,
        Some(_) => MergeOutcome::Applied,
        None => {
            log::warn!("merge: {table} op for unknown id={id} — create op may have been missed");
            MergeOutcome::SkippedMalformed
        }
    }
}

// ---- pins (shared_objects): create + update_content + status/scope/auto_insert/reorder ----

fn merge_pin(
    conn: &Connection,
    payload: &Value,
    hlc_ts: i64,
) -> Result<MergeOutcome, MergeError> {
    let op = op_name(payload);
    // `reorder_pins` is a batch op with no top-level `pin_id` — its
    // identifiers live in `ids: [...]`. Dispatch it before the
    // per-pin gate below.
    if op == "reorder_pins" {
        return merge_pin_reorder(conn, payload, hlc_ts);
    }
    let Some(pin_id) = payload.get("pin_id").and_then(|v| v.as_str()) else {
        return Ok(MergeOutcome::SkippedMalformed);
    };
    let fields = payload.get("fields").cloned().unwrap_or(Value::Null);
    let now = chrono::Utc::now().to_rfc3339();

    match op {
        "create_pin" | "backfill_create_pin" => {
            let lineage_id = fields.get("lineage_id").and_then(|v| v.as_str());
            let source_page_id = fields.get("source_page_id").and_then(|v| v.as_str());
            let Some(object_type) = fields.get("object_type").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            let Some(content) = fields.get("content").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            let title = fields.get("title").and_then(|v| v.as_str());
            conn.execute(
                "INSERT OR IGNORE INTO shared_objects
                   (id, lineage_id, source_page_id, object_type, title, content,
                    status, position, created_at, updated_at, applied_hlc_ts)
                 VALUES (?, ?, ?, ?, ?, ?, 'open', 0, ?, ?, ?)",
                params![
                    pin_id,
                    lineage_id,
                    source_page_id,
                    object_type,
                    title,
                    content,
                    &now,
                    &now,
                    hlc_ts,
                ],
            )?;
            // `INSERT OR IGNORE`: an already-present pin keeps its own
            // content, so re-arm off the row rather than off `content`,
            // which in that case is a snapshot of someone else's state.
            rearm_swept_attachments_of_row(conn, PIN_CONTENT_SQL, pin_id);
            Ok(MergeOutcome::Applied)
        }
        "update_pin_content" => {
            let content = fields.get("content").and_then(|v| v.as_str());
            let title = fields.get("title").and_then(|v| v.as_str());
            let n = conn.execute(
                "UPDATE shared_objects
                    SET content = COALESCE(?, content),
                        title   = COALESCE(?, title),
                        updated_at = ?,
                        applied_hlc_ts = ?
                  WHERE id = ? AND applied_hlc_ts < ?",
                params![content, title, &now, hlc_ts, pin_id, hlc_ts],
            )?;
            if n == 0 {
                return Ok(stale_or_missing(conn, "shared_objects", pin_id, hlc_ts));
            }
            if let Some(content) = content {
                rearm_swept_attachments(conn, content);
            }
            Ok(MergeOutcome::Applied)
        }
        "update_pin_status" => {
            let Some(status) = fields.get("status").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            let n = conn.execute(
                "UPDATE shared_objects
                    SET status = ?, updated_at = ?, applied_hlc_ts = ?
                  WHERE id = ? AND applied_hlc_ts < ?",
                params![status, &now, hlc_ts, pin_id, hlc_ts],
            )?;
            if n == 0 {
                return Ok(stale_or_missing(conn, "shared_objects", pin_id, hlc_ts));
            }
            Ok(MergeOutcome::Applied)
        }
        "update_pin_scope" => {
            // lineage_id may be NULL — pins can be global (no trail).
            let lineage_id = fields.get("lineage_id").and_then(|v| v.as_str());
            let n = conn.execute(
                "UPDATE shared_objects
                    SET lineage_id = ?, updated_at = ?, applied_hlc_ts = ?
                  WHERE id = ? AND applied_hlc_ts < ?",
                params![lineage_id, &now, hlc_ts, pin_id, hlc_ts],
            )?;
            if n == 0 {
                return Ok(stale_or_missing(conn, "shared_objects", pin_id, hlc_ts));
            }
            Ok(MergeOutcome::Applied)
        }
        "update_pin_auto_insert" => {
            let Some(auto_insert) = fields.get("auto_insert").and_then(|v| v.as_bool()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            let n = conn.execute(
                "UPDATE shared_objects
                    SET auto_insert = ?, updated_at = ?, applied_hlc_ts = ?
                  WHERE id = ? AND applied_hlc_ts < ?",
                params![auto_insert as i64, &now, hlc_ts, pin_id, hlc_ts],
            )?;
            if n == 0 {
                return Ok(stale_or_missing(conn, "shared_objects", pin_id, hlc_ts));
            }
            Ok(MergeOutcome::Applied)
        }
        _ => Ok(MergeOutcome::SkippedUnknownOp),
    }
}

/// `reorder_pins` lives at the top level (no per-pin `pin_id`) so it's
/// dispatched before the per-pin gate in `merge_pin`. Each id's
/// position is its index in the array. The reorder is a "batch LWW"
/// op — each pin's position is gated independently by its own HLC.
fn merge_pin_reorder(
    conn: &Connection,
    payload: &Value,
    hlc_ts: i64,
) -> Result<MergeOutcome, MergeError> {
    let Some(ids) = payload.get("ids").and_then(|v| v.as_array()) else {
        return Ok(MergeOutcome::SkippedMalformed);
    };
    let now = chrono::Utc::now().to_rfc3339();
    let mut all_stale = true;
    for (position, id_val) in ids.iter().enumerate() {
        let Some(pin_id) = id_val.as_str() else { continue };
        let n = conn.execute(
            "UPDATE shared_objects
                SET position = ?, updated_at = ?, applied_hlc_ts = ?
              WHERE id = ? AND applied_hlc_ts < ?",
            params![position as i64, &now, hlc_ts, pin_id, hlc_ts],
        )?;
        if n > 0 {
            all_stale = false;
        }
    }
    if all_stale && !ids.is_empty() {
        Ok(MergeOutcome::SkippedStaleHlc)
    } else {
        Ok(MergeOutcome::Applied)
    }
}

// ---- tombstone: delete lineage (with reparenting) / fold lineage / delete pin ----

fn merge_tombstone(
    conn: &Connection,
    payload: &Value,
    hlc_ts: i64,
) -> Result<MergeOutcome, MergeError> {
    let op = op_name(payload);
    match op {
        "delete_lineage" => {
            let Some(lineage_id) = payload.get("lineage_id").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            // A stale delete must not erase a row that's been touched
            // by a newer op locally (e.g. rename arrived after this
            // delete was issued elsewhere).
            if !row_is_stalable(conn, "lineages", lineage_id, hlc_ts)? {
                return Ok(MergeOutcome::SkippedStaleHlc);
            }
            let target = payload.get("target_lineage_id").and_then(|v| v.as_str());
            // Cascade reparent — gated per-child so a child that's
            // been moved by a newer op keeps its current lineage.
            conn.execute(
                "UPDATE lineages
                    SET parent_id = ?, applied_hlc_ts = ?
                  WHERE parent_id = ? AND applied_hlc_ts < ?",
                params![target, hlc_ts, lineage_id, hlc_ts],
            )?;
            conn.execute(
                "UPDATE pages
                    SET lineage_id = ?, applied_hlc_ts = ?
                  WHERE lineage_id = ? AND applied_hlc_ts < ?",
                params![target, hlc_ts, lineage_id, hlc_ts],
            )?;
            conn.execute(
                "UPDATE shared_objects
                    SET lineage_id = ?, applied_hlc_ts = ?
                  WHERE lineage_id = ? AND applied_hlc_ts < ?",
                params![target, hlc_ts, lineage_id, hlc_ts],
            )?;
            conn.execute("DELETE FROM lineages WHERE id = ?", params![lineage_id])?;
            Ok(MergeOutcome::Applied)
        }
        "fold_lineage" => {
            let Some(source_id) = payload.get("source_id").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            let Some(target_id) = payload.get("target_id").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            if !row_is_stalable(conn, "lineages", source_id, hlc_ts)? {
                return Ok(MergeOutcome::SkippedStaleHlc);
            }
            conn.execute(
                "UPDATE pages
                    SET lineage_id = ?, applied_hlc_ts = ?
                  WHERE lineage_id = ? AND applied_hlc_ts < ?",
                params![target_id, hlc_ts, source_id, hlc_ts],
            )?;
            conn.execute(
                "UPDATE shared_objects
                    SET lineage_id = ?, applied_hlc_ts = ?
                  WHERE lineage_id = ? AND applied_hlc_ts < ?",
                params![target_id, hlc_ts, source_id, hlc_ts],
            )?;
            conn.execute(
                "UPDATE lineages
                    SET parent_id = ?, applied_hlc_ts = ?
                  WHERE parent_id = ? AND applied_hlc_ts < ?",
                params![target_id, hlc_ts, source_id, hlc_ts],
            )?;
            conn.execute("DELETE FROM lineages WHERE id = ?", params![source_id])?;
            Ok(MergeOutcome::Applied)
        }
        "cleanup_orphan_page" => {
            let Some(page_id) = payload.get("page_id").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            // HLC-gate the delete like the other tombstones (delete_pin /
            // delete_lineage). Without this, a stale or forged cleanup op
            // could remove a page that a newer write already revived. This
            // is defense-in-depth; the root protection against a forged op
            // is per-op author authentication (security audit C1).
            conn.execute(
                "DELETE FROM pages WHERE id = ? AND applied_hlc_ts < ?",
                params![page_id, hlc_ts],
            )?;
            Ok(MergeOutcome::Applied)
        }
        "delete_pin" => {
            let Some(pin_id) = payload.get("pin_id").and_then(|v| v.as_str()) else {
                return Ok(MergeOutcome::SkippedMalformed);
            };
            let n = conn.execute(
                "DELETE FROM shared_objects WHERE id = ? AND applied_hlc_ts < ?",
                params![pin_id, hlc_ts],
            )?;
            if n == 0 {
                // Either the pin's gone already (idempotent) or it has
                // a newer HLC than this delete (stale resurrect-blocker).
                let present: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM shared_objects WHERE id = ?",
                        params![pin_id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if present > 0 {
                    return Ok(MergeOutcome::SkippedStaleHlc);
                }
            }
            Ok(MergeOutcome::Applied)
        }
        _ => Ok(MergeOutcome::SkippedUnknownOp),
    }
}

/// True if the row exists AND its current applied_hlc_ts is strictly
/// less than `hlc_ts` (so an op with `hlc_ts` may proceed to delete or
/// mutate it). A missing row counts as stalable too — the tombstone is
/// effectively a no-op in that case but doesn't represent an error.
fn row_is_stalable(
    conn: &Connection,
    table: &'static str,
    id: &str,
    hlc_ts: i64,
) -> Result<bool, MergeError> {
    let sql = format!("SELECT applied_hlc_ts FROM {table} WHERE id = ?");
    let existing: Option<i64> = conn.query_row(&sql, params![id], |r| r.get(0)).ok();
    Ok(match existing {
        Some(ts) => ts < hlc_ts,
        None => true,
    })
}

fn op_name(payload: &Value) -> &str {
    payload.get("op").and_then(|v| v.as_str()).unwrap_or("")
}

fn check_pin_divergence(conn: &Connection, page_id: &str) -> rusqlite::Result<()> {
    let page_content: Option<String> = conn
        .query_row(
            "SELECT content_json FROM pages WHERE id = ?",
            params![page_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();

    // Walk the doc tree looking for every node that still carries a
    // `pinId` attr. The old check compared serialised pin.content as a
    // substring of the page's content_json — that's unreliable because
    // JSON stringification (key order, whitespace, escaping) differs
    // between the pin's stored snapshot and the editor's getJSON() call,
    // so identical content still failed the substring match and every
    // synced pin showed "source changed on another device" forever.
    // PinId is the stable, semantic anchor — if the doc still has a node
    // tagged with this pin's id, the pin is still present, period.
    let live_pin_ids: std::collections::HashSet<String> = match page_content
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
    {
        Some(doc) => {
            let mut found = std::collections::HashSet::new();
            collect_pin_ids(&doc, &mut found);
            found
        }
        None => std::collections::HashSet::new(),
    };

    let mut stmt = conn.prepare(
        "SELECT id FROM shared_objects WHERE source_page_id = ? AND status != 'orphaned'",
    )?;
    let pin_ids: Vec<String> = stmt
        .query_map(params![page_id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    for pin_id in &pin_ids {
        let is_diverged = !live_pin_ids.contains(pin_id);
        conn.execute(
            "UPDATE shared_objects SET diverged = ? WHERE id = ?",
            params![is_diverged as i64, pin_id],
        )?;
    }
    Ok(())
}

/// Walk a TipTap doc tree collecting every `attrs.pinId` value present.
/// Kept private to merge.rs so the divergence check is self-contained;
/// commands.rs has a near-twin (`collect_pin_nodes`) that also captures
/// the surrounding node for cache refresh, which we don't need here.
fn collect_pin_ids(node: &serde_json::Value, out: &mut std::collections::HashSet<String>) {
    if let Some(attrs) = node.get("attrs").and_then(|a| a.as_object()) {
        if let Some(pin_id) = attrs.get("pinId").and_then(|v| v.as_str()) {
            out.insert(pin_id.to_string());
        }
    }
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            collect_pin_ids(child, out);
        }
    }
}

// ---- attachment_blob: reassemble chunks, verify sha256, write to store ----

/// Receive-side handler for the `attachment_blob` op_kind. Reassembles
/// chunked base64 bytes from the payload, verifies sha256 against the
/// claimed `blob_hash`, writes to the content-addressed blob store
/// under `<app_data>/blobs/`, then upserts the `attachments` index row.
///
/// Hash mismatch and reassembly failures are treated as malformed so
/// the pull loop can skip the op without wedging sync. A failed on-disk
/// write IS surfaced as `MergeError` so the surrounding transaction
/// rolls back — a partial write would leave the index claiming
/// `has_local = 1` for a blob the user can't actually open.
///
/// HLC: attachments are content-addressed by blob_hash, so a duplicate
/// op is a no-op (the file already exists, the upsert just refreshes
/// `last_seen_at`). No HLC gating needed — the same hash always implies
/// the same bytes.
fn merge_attachment_blob(
    conn: &Connection,
    payload: &Value,
    _hlc_ts: i64,
) -> Result<MergeOutcome, MergeError> {
    use crate::sync::wire::attachment_blob::{
        payload_is_reference, payload_is_revocation, reassemble, AttachmentBlobPayload,
    };

    let dto: AttachmentBlobPayload = match serde_json::from_value(payload.clone()) {
        Ok(d) => d,
        Err(_) => return Ok(MergeOutcome::SkippedMalformed),
    };

    // BEFORE the reference branch, not after: a revocation is
    // reference-shaped (no chunks), so falling through would re-record
    // the very object_key it is retracting and re-arm the 404 loop.
    if payload_is_revocation(&dto) {
        return merge_attachment_revocation(conn, &dto);
    }

    if payload_is_reference(&dto) {
        // `payload_is_reference` is true whenever `chunks_b64` is empty,
        // which is also what an inline payload for a ZERO-BYTE file would
        // look like (`Vec::chunks` on an empty slice yields no chunks).
        // No real client ever produces that: `insert_attachment` rejects
        // empty files before an op is ever emitted, on both the legacy
        // inline path and the reference path (a blob that doesn't exist
        // has no size to reference). So `size_bytes == 0` here can only
        // come from a malformed or malicious op — reject it outright
        // rather than guessing which shape was intended, and don't let
        // it fall through as a legitimate reference waiting on bytes
        // that will never arrive.
        if dto.size_bytes == 0 {
            log::warn!("attachment_blob reference with size_bytes == 0, treating as malformed");
            return Ok(MergeOutcome::SkippedMalformed);
        }
        return merge_attachment_reference(conn, &dto);
    }

    let bytes = match reassemble(&dto) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("attachment_blob reassemble failed: {e}");
            return Ok(MergeOutcome::SkippedMalformed);
        }
    };
    // Verify hash before writing — never trust a peer to send bytes
    // matching the hash they claim.
    let actual = {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(&bytes);
        hex::encode(h.finalize())
    };
    if actual != dto.blob_hash {
        log::warn!(
            "attachment_blob hash mismatch: expected {} got {}",
            dto.blob_hash,
            actual
        );
        return Ok(MergeOutcome::SkippedMalformed);
    }
    // Resolve app_data_dir from the connection's underlying file path.
    // The DB lives at `<app_data>/<dbfile>`, so the parent IS app_data.
    // In-memory connections (used by tests) return None; we skip the
    // on-disk write in that case so the index-only path is still
    // exercisable from unit tests.
    let db_path = conn.path().map(|p| p.to_string()).unwrap_or_default();
    if !db_path.is_empty() {
        let app_data_dir = std::path::Path::new(&db_path)
            .parent()
            .ok_or_else(|| MergeError::Db("db path has no parent".into()))?
            .to_path_buf();
        if let Err(e) =
            crate::attachments::store::write_blob(&app_data_dir, &dto.blob_hash, &bytes)
        {
            log::warn!("attachment_blob write failed: {e}");
            return Err(MergeError::Db(format!("blob write: {e}")));
        }
    }
    // Upsert into the attachments index so the storage panel and pin
    // open-paths know the blob is locally available. Filename defaults
    // to the hash on receive — peers may not have shared the original
    // filename (it's a UX hint, not part of the content address).
    let now = chrono::Utc::now().to_rfc3339();
    let filename = dto.blob_hash.clone();
    conn.execute(
        "INSERT INTO attachments \
            (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at) \
         VALUES (?1, ?2, ?3, ?4, 1, 1, ?5, ?5) \
         ON CONFLICT(blob_hash) DO UPDATE SET \
            has_local = 1, last_seen_at = excluded.last_seen_at",
        rusqlite::params![
            &dto.blob_hash,
            &filename,
            &dto.mime_type,
            dto.size_bytes,
            &now
        ],
    )?;
    Ok(MergeOutcome::Applied)
}

/// Receive-side handler for a reference-shaped `attachment_blob` payload
/// (`payload_is_reference` is true, `size_bytes > 0`). The bytes live at
/// `PUT /v1/users/<uid>/attachments/<hash>`, not in this op — fetching
/// them is network I/O, which `merge` must never do inline (it runs
/// inside the pull transaction). So this just records that the
/// attachment exists and is not yet local; the sync worker (Task 6)
/// finds `has_local = 0` rows and fetches the bytes afterwards.
///
/// `ON CONFLICT` only refreshes `last_seen_at` and deliberately leaves
/// `has_local` alone: if this same content-addressed hash already has
/// its bytes locally (written by an earlier legacy inline op, or a
/// previous fetch), a reference op arriving after it must not downgrade
/// `has_local` back to 0 and orphan a file the user can already open.
///
/// `object_key` is recorded because it is the ONLY address the bytes can
/// be fetched by — `blob_hash` is sha256 of the plaintext and the relay
/// has never seen the plaintext. It is filled in with `COALESCE`, so an
/// object key this device already knows always wins: the same file
/// encrypted on two devices yields two different (equally valid) object
/// keys, and the local one is the one this device's un-sync must delete.
/// Overwriting it with a peer's key would leak this device's object on
/// the relay forever.
///
/// A payload with no `object_key` at all (an early build of this branch)
/// still records its row: the attachment genuinely exists on the account
/// and belongs in the storage panel. It simply can never be fetched —
/// see `attachments::backfill::pending_object_fetch`.
///
/// `object_epoch` travels with the key and is written by the same
/// choice, never coalesced independently. The two are one fact — "the
/// bytes are at K, sealed under E" — and mixing this device's K with a
/// peer's E would produce an address whose recorded epoch is wrong,
/// which is unopenable rather than merely suboptimal. An op that
/// predates the field records epoch 0, which is what it was genuinely
/// sealed under (see `wire::attachment_blob::object_epoch_of`).
///
/// `sync` moves with them for the same reason, and only when the
/// incoming key is the one adopted. A row can reach this handler with
/// `sync = 0` because a RETRACTION cleared it (see
/// `merge_attachment_revocation`) — the user un-synced the file on
/// another device. When the file is later re-synced, the new reference
/// is the account saying it is on the relay again, and a row left at
/// `sync = 0` would record the new address and then never fetch it.
/// Where this device kept an object key of its own, nothing about its
/// own consent is being restated, so `sync` is left exactly as it is.
///
/// "The incoming key is the one adopted" requires an incoming key. The
/// guard used to test only `attachments.object_key IS NULL`, so a
/// KEYLESS reference — the early-build shape whose existence on real
/// devices `attachments::backfill::pending_object_fetch` documents —
/// set `sync = 1` while `COALESCE(NULL, NULL)` left `object_key` NULL.
/// That pair is exactly `pending_object_upload`'s predicate: a device
/// where the user had set `sync = 0` would upload the bytes and publish
/// a reference, re-arming an upload the user revoked. Nothing about a
/// reference that carries no address is the account saying the file is
/// on the relay.
fn merge_attachment_reference(
    conn: &Connection,
    dto: &crate::sync::wire::attachment_blob::AttachmentBlobPayload,
) -> Result<MergeOutcome, MergeError> {
    let now = chrono::Utc::now().to_rfc3339();
    let filename = dto.blob_hash.clone();
    let object_epoch = dto
        .object_key
        .as_ref()
        .map(|_| crate::sync::wire::attachment_blob::object_epoch_of(dto));
    conn.execute(
        "INSERT INTO attachments \
            (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at, object_key, object_epoch) \
         VALUES (?1, ?2, ?3, ?4, 1, 0, ?5, ?5, ?6, ?7) \
         ON CONFLICT(blob_hash) DO UPDATE SET \
            last_seen_at = excluded.last_seen_at, \
            sync = CASE WHEN attachments.object_key IS NULL \
                          AND excluded.object_key IS NOT NULL \
                        THEN 1 ELSE attachments.sync END, \
            object_epoch = CASE WHEN attachments.object_key IS NULL \
                                THEN excluded.object_epoch ELSE attachments.object_epoch END, \
            object_key = COALESCE(attachments.object_key, excluded.object_key)",
        rusqlite::params![
            &dto.blob_hash,
            &filename,
            &dto.mime_type,
            dto.size_bytes,
            &now,
            &dto.object_key,
            object_epoch
        ],
    )?;
    Ok(MergeOutcome::Applied)
}

/// Receive-side handler for a REVOCATION (`payload_is_revocation`): the
/// device that uploaded `object_key` has deleted it from the relay.
///
/// The op log is append-only, so the reference op that published that
/// key survives forever. Without this handler a peer holding
/// `(sync = 1, has_local = 0, object_key = K)` GETs the deleted K on
/// every tick, 404s, and retries for the life of the account —
/// `pending_object_fetch` selects exactly that shape.
///
/// MATCHED ON `object_key`, not on `blob_hash` alone. The same file
/// sealed on two devices lands under two different, equally valid
/// object keys, and `merge_attachment_reference`'s COALESCE means each
/// device keeps its own. A revocation of A's key must leave B's object
/// — which is still on the relay and still fetchable — untouched. The
/// match also makes the op order-tolerant: a revocation arriving after
/// the file was re-synced (a new key on the row) is a no-op rather than
/// a retraction of the live object.
///
/// `sync` goes to 0 with the key because un-syncing is an account-level
/// statement by the one user who owns every device here: the bytes are
/// not to be on the relay. `has_local` and the file on disk are
/// deliberately untouched — sinking is not shredding, and a peer that
/// already fetched the file keeps it.
///
/// A revocation for a `blob_hash` this device has never seen updates
/// nothing. That empty result is right: inserting a row would
/// resurrect, as a pointer to nothing, an attachment whose only op says
/// it is gone.
fn merge_attachment_revocation(
    conn: &Connection,
    dto: &crate::sync::wire::attachment_blob::AttachmentBlobPayload,
) -> Result<MergeOutcome, MergeError> {
    let Some(object_key) = dto.object_key.as_ref() else {
        // `payload_is_revocation` already guarantees this; belt and
        // braces so a future caller can't address the whole content.
        return Ok(MergeOutcome::SkippedMalformed);
    };
    conn.execute(
        "UPDATE attachments SET sync = 0, object_key = NULL, object_epoch = NULL \
         WHERE blob_hash = ?1 AND object_key = ?2",
        rusqlite::params![&dto.blob_hash, object_key],
    )?;
    Ok(MergeOutcome::Applied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_db;
    use serde_json::json;

    /// Test helper. Injects a strictly-monotonic `hlc_ts` into the
    /// payload so a single test can call `apply()` multiple times and
    /// each op gates cleanly against the previous one's stamp. Tests
    /// that exercise the stale-skip path override by passing
    /// `"hlc_ts"` in the json! literal.
    fn payload_bytes(mut v: serde_json::Value) -> Vec<u8> {
        use std::sync::atomic::{AtomicI64, Ordering};
        // Start well above 0 (rows' default applied_hlc_ts) but well
        // below any real ms-since-epoch HLC, so tests that mix this
        // helper with hand-rolled HLCs don't accidentally collide.
        static NEXT: AtomicI64 = AtomicI64::new(1_000_000);
        if let serde_json::Value::Object(obj) = &mut v {
            obj.entry("hlc_ts")
                .or_insert_with(|| serde_json::Value::from(NEXT.fetch_add(1, Ordering::SeqCst)));
        }
        serde_json::to_vec(&v).unwrap()
    }

    /// Unknown op_kind is a no-op + signals skip up to the pull
    /// pipeline so it keeps advancing the cursor. Matches the spec §4
    /// forward-compat rule for unknown kinds.
    #[test]
    fn unknown_op_kind_is_skipped_silently() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let out = apply(&conn, "future_kind_v9", &payload_bytes(json!({}))).unwrap();
        assert_eq!(out, MergeOutcome::SkippedUnknownKind);
    }

    /// Malformed JSON does not crash sync; pull keeps moving.
    #[test]
    fn malformed_payload_is_skipped() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let out = apply(&conn, "setting_op", b"{ not json").unwrap();
        assert_eq!(out, MergeOutcome::SkippedMalformed);
    }

    // ---- setting_op ----

    #[test]
    fn setting_set_upserts_into_settings_table() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let payload = json!({"op":"set", "key":"lock_timeout_minutes", "value":"30"});
        let out = apply(&conn, "setting_op", &payload_bytes(payload)).unwrap();
        assert_eq!(out, MergeOutcome::Applied);

        let v: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'lock_timeout_minutes'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, "30");
    }

    #[test]
    fn setting_set_overwrites_existing_value() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('k', 'old')",
            [],
        )
        .unwrap();
        let payload = json!({"op":"set", "key":"k", "value":"new"});
        apply(&conn, "setting_op", &payload_bytes(payload)).unwrap();
        let v: String = conn
            .query_row("SELECT value FROM settings WHERE key='k'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "new");
    }

    #[test]
    fn setting_set_with_null_value_deletes_row() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('k', 'something')",
            [],
        )
        .unwrap();
        let payload = json!({"op":"set", "key":"k", "value": null});
        apply(&conn, "setting_op", &payload_bytes(payload)).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings WHERE key='k'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    // ---- page_blob ----

    #[test]
    fn create_new_page_inserts_pages_row() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let payload = json!({
            "op": "create_new_page",
            "page_id": "p-abc",
            "fields": {"date":"2026-05-16","page_number": 1}
        });
        apply(&conn, "page_blob", &payload_bytes(payload)).unwrap();
        let (d, n): (String, i64) = conn
            .query_row(
                "SELECT date, page_number FROM pages WHERE id = 'p-abc'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(d, "2026-05-16");
        assert_eq!(n, 1);
    }

    #[test]
    fn save_page_content_overwrites_content_json() {
        let db = test_db();
        let conn = db.lock().unwrap();
        // Seed a page row first (the create_new_page op would normally
        // do this; here we INSERT directly to isolate the save merge).
        conn.execute(
            "INSERT INTO pages (id, date, page_number, content_json, created_at, updated_at)
             VALUES ('p-1', '2026-05-16', 1, '{\"old\":1}', '0', '0')",
            [],
        )
        .unwrap();
        let new_content = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
        let payload = json!({
            "op": "save_page_content",
            "page_id": "p-1",
            "fields": {"content_json": new_content}
        });
        apply(&conn, "page_blob", &payload_bytes(payload)).unwrap();
        let got: String = conn
            .query_row("SELECT content_json FROM pages WHERE id='p-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(got, new_content);
    }

    #[test]
    fn save_page_content_for_unknown_page_does_not_create_phantom_row() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let payload = json!({
            "op": "save_page_content",
            "page_id": "never-existed",
            "fields": {"content_json": "{}"}
        });
        // The HLC gate's stale_or_missing_page helper distinguishes
        // "row absent" (SkippedMalformed) from "row newer than op"
        // (SkippedStaleHlc). Either way, no phantom row is created.
        let out = apply(&conn, "page_blob", &payload_bytes(payload)).unwrap();
        assert_eq!(out, MergeOutcome::SkippedMalformed);
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE id='never-existed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0, "no phantom row created");
    }

    #[test]
    fn what_matters_now_updates_the_column() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at)
             VALUES ('p-2', '2026-05-16', 1, '0', '0')",
            [],
        )
        .unwrap();
        let payload = json!({
            "op": "update_what_matters_now",
            "page_id": "p-2",
            "fields": {"text": "finish the merge surface"}
        });
        apply(&conn, "page_blob", &payload_bytes(payload)).unwrap();
        let v: String = conn
            .query_row(
                "SELECT what_matters_now FROM pages WHERE id='p-2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, "finish the merge surface");
    }

    #[test]
    fn line_level_page_op_is_skipped_without_warning() {
        // save_line / update_line_text etc. flow through page_blob in
        // the wire envelope. We deliberately don't fold them — the
        // bulk `save_page_content` that follows covers state — so the
        // merge should report SkippedUnknownOp and the pull loop
        // continues.
        let db = test_db();
        let conn = db.lock().unwrap();
        let payload = json!({
            "op": "save_line",
            "page_id": "p-x",
            "fields": {"text": "line text"}
        });
        let out = apply(&conn, "page_blob", &payload_bytes(payload)).unwrap();
        assert_eq!(out, MergeOutcome::SkippedUnknownOp);
    }

    // ---- lineage_op ----

    #[test]
    fn create_lineage_inserts_row() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let payload = json!({
            "op": "create_lineage",
            "lineage_id": "lin-1",
            "fields": {"name":"draft trail","mode":"continuous"}
        });
        apply(&conn, "lineage_op", &payload_bytes(payload)).unwrap();
        let (name, mode): (String, String) = conn
            .query_row(
                "SELECT name, mode FROM lineages WHERE id='lin-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, "draft trail");
        assert_eq!(mode, "continuous");
    }

    #[test]
    fn rename_lineage_updates_name() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO lineages (id, name, created_at, mode)
             VALUES ('lin-2', 'old name', '0', 'discrete')",
            [],
        )
        .unwrap();
        let payload = json!({
            "op": "rename_lineage",
            "lineage_id": "lin-2",
            "fields": {"name":"new name"}
        });
        apply(&conn, "lineage_op", &payload_bytes(payload)).unwrap();
        let v: String = conn
            .query_row("SELECT name FROM lineages WHERE id='lin-2'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(v, "new name");
    }

    // ---- pin_op ----

    #[test]
    fn create_pin_inserts_shared_object() {
        let db = test_db();
        let conn = db.lock().unwrap();
        // Pin needs a source_page_id that exists (FK).
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at)
             VALUES ('p-source', '2026-05-16', 1, '0', '0')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO lineages (id, name, created_at) VALUES ('lin-a', 'a', '0')",
            [],
        )
        .unwrap();
        let payload = json!({
            "op": "create_pin",
            "pin_id": "pin-1",
            "fields": {
                "lineage_id": "lin-a",
                "source_page_id": "p-source",
                "object_type": "note",
                "content": "the pinned slice is the artifact",
                "title": null
            }
        });
        apply(&conn, "pin_op", &payload_bytes(payload)).unwrap();
        let c: String = conn
            .query_row("SELECT content FROM shared_objects WHERE id='pin-1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(c, "the pinned slice is the artifact");
    }

    // ---- 14.12: tombstone + remaining ops ----

    #[test]
    fn set_lineage_parent_updates_parent_id() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO lineages (id, name, created_at, mode) VALUES
                ('parent-a', 'parent a', '0', 'discrete'),
                ('parent-b', 'parent b', '0', 'discrete'),
                ('child', 'child', '0', 'discrete')",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE lineages SET parent_id = 'parent-a' WHERE id = 'child'",
            [],
        )
        .unwrap();

        let payload = json!({
            "op": "set_lineage_parent",
            "lineage_id": "child",
            "fields": {"parent_id": "parent-b"}
        });
        apply(&conn, "lineage_op", &payload_bytes(payload)).unwrap();

        let parent: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM lineages WHERE id = 'child'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(parent.as_deref(), Some("parent-b"));

        // Null parent_id makes the lineage top-level.
        let payload = json!({
            "op": "set_lineage_parent",
            "lineage_id": "child",
            "fields": {"parent_id": null}
        });
        apply(&conn, "lineage_op", &payload_bytes(payload)).unwrap();
        let parent: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM lineages WHERE id = 'child'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(parent.is_none());
    }

    #[test]
    fn update_pin_status_changes_status() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO shared_objects (id, source_page_id, object_type, content, status, position, created_at, updated_at)
             VALUES ('pin-s', NULL, 'note', 'x', 'open', 0, '0', '0')",
            [],
        )
        .unwrap();
        let payload = json!({
            "op": "update_pin_status",
            "pin_id": "pin-s",
            "fields": {"status": "closed"}
        });
        apply(&conn, "pin_op", &payload_bytes(payload)).unwrap();
        let s: String = conn
            .query_row(
                "SELECT status FROM shared_objects WHERE id='pin-s'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(s, "closed");
    }

    #[test]
    fn update_pin_scope_changes_lineage_id() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO lineages (id, name, created_at, mode)
             VALUES ('lin-a', 'a', '0', 'discrete'),
                    ('lin-b', 'b', '0', 'discrete')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO shared_objects (id, lineage_id, source_page_id, object_type, content, status, position, created_at, updated_at)
             VALUES ('pin-sc', 'lin-a', NULL, 'note', 'x', 'open', 0, '0', '0')",
            [],
        )
        .unwrap();
        let payload = json!({
            "op": "update_pin_scope",
            "pin_id": "pin-sc",
            "fields": {"lineage_id": "lin-b"}
        });
        apply(&conn, "pin_op", &payload_bytes(payload)).unwrap();
        let lineage: Option<String> = conn
            .query_row(
                "SELECT lineage_id FROM shared_objects WHERE id='pin-sc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lineage.as_deref(), Some("lin-b"));

        // Null lineage_id → global pin.
        let payload = json!({
            "op": "update_pin_scope",
            "pin_id": "pin-sc",
            "fields": {"lineage_id": null}
        });
        apply(&conn, "pin_op", &payload_bytes(payload)).unwrap();
        let lineage: Option<String> = conn
            .query_row(
                "SELECT lineage_id FROM shared_objects WHERE id='pin-sc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(lineage.is_none());
    }

    #[test]
    fn update_pin_auto_insert_flips_boolean() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO shared_objects (id, source_page_id, object_type, content, status, position, auto_insert, created_at, updated_at)
             VALUES ('pin-ai', NULL, 'note', 'x', 'open', 0, 0, '0', '0')",
            [],
        )
        .unwrap();
        let payload = json!({
            "op": "update_pin_auto_insert",
            "pin_id": "pin-ai",
            "fields": {"auto_insert": true}
        });
        apply(&conn, "pin_op", &payload_bytes(payload)).unwrap();
        let v: i64 = conn
            .query_row(
                "SELECT auto_insert FROM shared_objects WHERE id='pin-ai'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, 1);
    }

    #[test]
    fn reorder_pins_writes_position_by_array_index() {
        let db = test_db();
        let conn = db.lock().unwrap();
        for (i, id) in ["pin-a", "pin-b", "pin-c"].iter().enumerate() {
            conn.execute(
                "INSERT INTO shared_objects (id, source_page_id, object_type, content, status, position, created_at, updated_at)
                 VALUES (?, NULL, 'note', 'x', 'open', ?, '0', '0')",
                params![id, i as i64],
            )
            .unwrap();
        }
        // Reverse the order.
        let payload = json!({
            "op": "reorder_pins",
            "ids": ["pin-c", "pin-b", "pin-a"]
        });
        apply(&conn, "pin_op", &payload_bytes(payload)).unwrap();
        let order: Vec<(String, i64)> = conn
            .prepare("SELECT id, position FROM shared_objects ORDER BY position ASC")
            .unwrap()
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(order[0].0, "pin-c");
        assert_eq!(order[1].0, "pin-b");
        assert_eq!(order[2].0, "pin-a");
    }

    #[test]
    fn delete_lineage_reparents_and_deletes() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO lineages (id, name, created_at, mode) VALUES
                ('lin-grand', 'g', '0', 'discrete'),
                ('lin-parent', 'p', '0', 'discrete'),
                ('lin-child', 'c', '0', 'discrete')",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE lineages SET parent_id = 'lin-grand' WHERE id = 'lin-parent'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE lineages SET parent_id = 'lin-parent' WHERE id = 'lin-child'",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, lineage_id, created_at, updated_at)
             VALUES ('p-x', '2026-05-16', 1, 'lin-parent', '0', '0')",
            [],
        )
        .unwrap();

        // Delete lin-parent, reparenting children to lin-grand.
        let payload = json!({
            "op": "delete_lineage",
            "lineage_id": "lin-parent",
            "target_lineage_id": "lin-grand"
        });
        apply(&conn, "tombstone", &payload_bytes(payload)).unwrap();

        // lin-parent gone.
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM lineages WHERE id='lin-parent'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        // lin-child re-parented to lin-grand.
        let p: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM lineages WHERE id='lin-child'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(p.as_deref(), Some("lin-grand"));
        // The page moved with the reparent.
        let l: Option<String> = conn
            .query_row("SELECT lineage_id FROM pages WHERE id='p-x'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(l.as_deref(), Some("lin-grand"));
    }

    #[test]
    fn delete_lineage_with_null_target_makes_children_top_level() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO lineages (id, name, created_at, mode) VALUES
                ('lin-root', 'r', '0', 'discrete'),
                ('lin-kid', 'k', '0', 'discrete')",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE lineages SET parent_id = 'lin-root' WHERE id = 'lin-kid'",
            [],
        )
        .unwrap();
        let payload = json!({
            "op": "delete_lineage",
            "lineage_id": "lin-root",
            "target_lineage_id": null
        });
        apply(&conn, "tombstone", &payload_bytes(payload)).unwrap();
        let p: Option<String> = conn
            .query_row("SELECT parent_id FROM lineages WHERE id='lin-kid'", [], |r| r.get(0))
            .unwrap();
        assert!(p.is_none(), "child becomes top-level when target is null");
    }

    #[test]
    fn fold_lineage_moves_rows_then_deletes_source() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO lineages (id, name, created_at, mode) VALUES
                ('lin-src', 's', '0', 'discrete'),
                ('lin-dst', 'd', '0', 'discrete')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, lineage_id, created_at, updated_at)
             VALUES ('p-a', '2026-05-16', 1, 'lin-src', '0', '0')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO shared_objects (id, lineage_id, source_page_id, object_type, content, status, position, created_at, updated_at)
             VALUES ('pin-a', 'lin-src', NULL, 'note', 'x', 'open', 0, '0', '0')",
            [],
        )
        .unwrap();

        let payload = json!({
            "op": "fold_lineage",
            "source_id": "lin-src",
            "target_id": "lin-dst",
            "pages_moved": 1,
            "pins_moved": 1
        });
        apply(&conn, "tombstone", &payload_bytes(payload)).unwrap();

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM lineages WHERE id='lin-src'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        let l: Option<String> = conn
            .query_row("SELECT lineage_id FROM pages WHERE id='p-a'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(l.as_deref(), Some("lin-dst"));
        let l2: Option<String> = conn
            .query_row(
                "SELECT lineage_id FROM shared_objects WHERE id='pin-a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(l2.as_deref(), Some("lin-dst"));
    }

    #[test]
    fn delete_pin_removes_row() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO shared_objects (id, source_page_id, object_type, content, status, position, created_at, updated_at)
             VALUES ('pin-del', NULL, 'note', 'x', 'open', 0, '0', '0')",
            [],
        )
        .unwrap();
        let payload = json!({"op":"delete_pin","pin_id":"pin-del"});
        apply(&conn, "tombstone", &payload_bytes(payload)).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shared_objects WHERE id='pin-del'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
    }

    /// page_yjs with a valid yjs update against an existing page row
    /// applies cleanly and persists merged bytes into `pages.yjs_state`.
    #[test]
    fn page_yjs_with_valid_update_returns_applied() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        use yrs::{ReadTxn, StateVector, Text, Transact};
        let db = test_db();
        let conn = db.lock().unwrap();
        // Seed a page row — page_yjs merges into an existing page; it
        // does not create.
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at)
             VALUES ('p-yjs-1', '2026-05-20', 1, '0', '0')",
            [],
        )
        .unwrap();
        let doc = yrs::Doc::new();
        let text = doc.get_or_insert_text("body");
        {
            let mut tx = doc.transact_mut();
            text.insert(&mut tx, 0, "hello yjs");
        }
        let update_bytes = doc
            .transact()
            .encode_state_as_update_v2(&StateVector::default());
        let payload = json!({
            "op": "yjs_update",
            "page_id": "p-yjs-1",
            "fields": {"update": B64.encode(&update_bytes)}
        });
        let out = apply(&conn, "page_yjs", &payload_bytes(payload)).unwrap();
        assert_eq!(out, MergeOutcome::Applied);
        // yjs_state column is now populated.
        let stored: Option<Vec<u8>> = conn
            .query_row("SELECT yjs_state FROM pages WHERE id='p-yjs-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(
            stored.map(|v| !v.is_empty()).unwrap_or(false),
            "yjs_state must contain non-empty merged bytes after merge"
        );
    }

    /// page_yjs with garbage update bytes returns SkippedMalformed
    /// (logs + keeps the pull loop moving). Seed a page row so we
    /// actually exercise the apply_update branch, not the missing-
    /// page branch.
    #[test]
    fn page_yjs_with_garbage_update_is_skipped_malformed() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at)
             VALUES ('p-yjs-2', '2026-05-20', 1, '0', '0')",
            [],
        )
        .unwrap();
        let payload = json!({
            "op": "yjs_update",
            "page_id": "p-yjs-2",
            "fields": {"update": B64.encode([1u8, 2, 3, 4])}
        });
        let out = apply(&conn, "page_yjs", &payload_bytes(payload)).unwrap();
        assert_eq!(out, MergeOutcome::SkippedMalformed);
    }

    /// page_yjs missing the update field is malformed.
    #[test]
    fn page_yjs_missing_update_is_malformed() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let payload = json!({
            "op": "yjs_update",
            "page_id": "p-yjs-3",
            "fields": {}
        });
        let out = apply(&conn, "page_yjs", &payload_bytes(payload)).unwrap();
        assert_eq!(out, MergeOutcome::SkippedMalformed);
    }

    /// page_yjs against a page that doesn't exist locally returns
    /// SkippedMalformed — the create_new_page op should have arrived
    /// first. We don't conjure a phantom row.
    #[test]
    fn page_yjs_for_unknown_page_is_skipped_malformed() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        use yrs::{ReadTxn, StateVector, Text, Transact};
        let db = test_db();
        let conn = db.lock().unwrap();
        let doc = yrs::Doc::new();
        let text = doc.get_or_insert_text("body");
        {
            let mut tx = doc.transact_mut();
            text.insert(&mut tx, 0, "orphan");
        }
        let update_bytes = doc
            .transact()
            .encode_state_as_update_v2(&StateVector::default());
        let payload = json!({
            "op": "yjs_update",
            "page_id": "p-yjs-orphan",
            "fields": {"update": B64.encode(&update_bytes)}
        });
        let out = apply(&conn, "page_yjs", &payload_bytes(payload)).unwrap();
        assert_eq!(out, MergeOutcome::SkippedMalformed);
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE id='p-yjs-orphan'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0, "no phantom row from an orphan yjs update");
    }

    /// Two sequential page_yjs updates on the same page fold into
    /// each other: the merged state contains the union of both edits.
    /// This is the storage-loop-closes property — without persisted
    /// yjs_state, the second update would only see an empty doc.
    #[test]
    fn page_yjs_second_update_folds_into_first() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        use yrs::{updates::decoder::Decode, Doc, GetString, ReadTxn, StateVector, Text,
                  Transact, Update};
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at)
             VALUES ('p-fold', '2026-05-20', 1, '0', '0')",
            [],
        )
        .unwrap();

        // Build two updates derived from a common base doc.
        let base = Doc::new();
        let t = base.get_or_insert_text("body");
        {
            let mut tx = base.transact_mut();
            t.insert(&mut tx, 0, "hello");
        }
        let base_state = base
            .transact()
            .encode_state_as_update_v2(&StateVector::default());

        // Update A inserts " world" at the end (built on top of base).
        let doc_a = Doc::new();
        {
            let mut tx = doc_a.transact_mut();
            tx.apply_update(Update::decode_v2(&base_state).unwrap());
        }
        let ta = doc_a.get_or_insert_text("body");
        {
            let mut tx = doc_a.transact_mut();
            ta.insert(&mut tx, 5, " world");
        }
        let update_a = doc_a
            .transact()
            .encode_state_as_update_v2(&StateVector::default());

        // Update B prepends "say: " (also built on base).
        let doc_b = Doc::new();
        {
            let mut tx = doc_b.transact_mut();
            tx.apply_update(Update::decode_v2(&base_state).unwrap());
        }
        let tb = doc_b.get_or_insert_text("body");
        {
            let mut tx = doc_b.transact_mut();
            tb.insert(&mut tx, 0, "say: ");
        }
        let update_b = doc_b
            .transact()
            .encode_state_as_update_v2(&StateVector::default());

        // Apply both through merge — the second one must fold into
        // the persisted state from the first.
        let payload_a = json!({
            "op": "yjs_update",
            "page_id": "p-fold",
            "fields": {"update": B64.encode(&update_a)}
        });
        let payload_b = json!({
            "op": "yjs_update",
            "page_id": "p-fold",
            "fields": {"update": B64.encode(&update_b)}
        });
        apply(&conn, "page_yjs", &payload_bytes(payload_a)).unwrap();
        apply(&conn, "page_yjs", &payload_bytes(payload_b)).unwrap();

        // Decode the persisted state and check both edits are present.
        let stored: Vec<u8> = conn
            .query_row("SELECT yjs_state FROM pages WHERE id='p-fold'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let merged = Doc::new();
        {
            let mut tx = merged.transact_mut();
            tx.apply_update(Update::decode_v2(&stored).unwrap());
        }
        let final_text = merged.get_or_insert_text("body");
        let s = final_text.get_string(&merged.transact());
        // The exact resulting string depends on yjs's deterministic
        // tie-breaker on insert position; we don't pin it. What we DO
        // pin: both "say: " and " world" must be present somewhere in
        // the merged state. Without the storage-loop close, "say: "
        // would have been lost when update_b started from an empty
        // doc instead of update_a's state.
        assert!(
            s.contains("say:") && s.contains("world"),
            "both edits must survive the fold, got: {s:?}"
        );
    }

    /// Two page_yjs updates arriving in opposite orders on two
    /// separate page rows converge to the same final state. This is
    /// the CRDT convergence property exercised through the merge
    /// pipeline, not just the yjs primitive (which has its own test
    /// in sync::yjs). Verification scenario from the design spec.
    #[test]
    fn page_yjs_converges_regardless_of_arrival_order() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        use yrs::{updates::decoder::Decode, Doc, ReadTxn, StateVector, Text, Transact, Update};
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at) VALUES
                ('p-ord-1', '2026-05-20', 1, '0', '0'),
                ('p-ord-2', '2026-05-20', 2, '0', '0')",
            [],
        )
        .unwrap();

        let base = Doc::new();
        let t = base.get_or_insert_text("body");
        {
            let mut tx = base.transact_mut();
            t.insert(&mut tx, 0, "hi");
        }
        let base_state = base
            .transact()
            .encode_state_as_update_v2(&StateVector::default());

        // Two divergent updates from the same base.
        let mk_update = |insert_at: u32, text: &str| -> Vec<u8> {
            let d = Doc::new();
            {
                let mut tx = d.transact_mut();
                tx.apply_update(Update::decode_v2(&base_state).unwrap());
            }
            let tt = d.get_or_insert_text("body");
            {
                let mut tx = d.transact_mut();
                tt.insert(&mut tx, insert_at, text);
            }
            let txn = d.transact();
            let bytes = txn.encode_state_as_update_v2(&StateVector::default());
            drop(txn);
            bytes
        };
        let update_a = mk_update(2, " there");
        let update_b = mk_update(0, "oh ");

        // Page 1: apply A then B. Page 2: apply B then A.
        let payload = |page_id: &str, update: &[u8]| -> serde_json::Value {
            json!({
                "op": "yjs_update",
                "page_id": page_id,
                "fields": {"update": B64.encode(update)}
            })
        };
        apply(&conn, "page_yjs", &payload_bytes(payload("p-ord-1", &update_a))).unwrap();
        apply(&conn, "page_yjs", &payload_bytes(payload("p-ord-1", &update_b))).unwrap();
        apply(&conn, "page_yjs", &payload_bytes(payload("p-ord-2", &update_b))).unwrap();
        apply(&conn, "page_yjs", &payload_bytes(payload("p-ord-2", &update_a))).unwrap();

        // Decode both and compare resulting text — must be identical.
        let load = |page_id: &str| -> String {
            use yrs::GetString;
            let bytes: Vec<u8> = conn
                .query_row(
                    "SELECT yjs_state FROM pages WHERE id=?",
                    params![page_id],
                    |r| r.get(0),
                )
                .unwrap();
            let d = Doc::new();
            {
                let mut tx = d.transact_mut();
                tx.apply_update(Update::decode_v2(&bytes).unwrap());
            }
            let t = d.get_or_insert_text("body");
            let txn = d.transact();
            let s = t.get_string(&txn);
            drop(txn);
            s
        };
        let s1 = load("p-ord-1");
        let s2 = load("p-ord-2");
        assert_eq!(s1, s2, "yjs CRDT must converge through merge pipeline");
    }

    /// When the sender includes a content_json snapshot alongside the
    /// yjs update (phase 14.19's contract for continuous-trail saves),
    /// the receiver updates BOTH columns. Without the snapshot, FTS
    /// would be stale until the editor opens the page and re-derives.
    #[test]
    fn page_yjs_with_content_snapshot_updates_both_columns() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        use yrs::{ReadTxn, StateVector, Text, Transact};
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, content_json, created_at, updated_at)
             VALUES ('p-snap', '2026-05-20', 1, '{\"old\":\"stale-fts\"}', '0', '0')",
            [],
        )
        .unwrap();
        let doc = yrs::Doc::new();
        let text = doc.get_or_insert_text("body");
        {
            let mut tx = doc.transact_mut();
            text.insert(&mut tx, 0, "fresh prose");
        }
        let update_bytes = doc
            .transact()
            .encode_state_as_update_v2(&StateVector::default());
        let snapshot = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"fresh prose"}]}]}"#;
        let payload = json!({
            "op": "yjs_update",
            "page_id": "p-snap",
            "fields": {
                "update": B64.encode(&update_bytes),
                "content_json": snapshot
            }
        });
        let out = apply(&conn, "page_yjs", &payload_bytes(payload)).unwrap();
        assert_eq!(out, MergeOutcome::Applied);
        // Both columns landed.
        let (yjs_bytes, content): (Option<Vec<u8>>, String) = conn
            .query_row(
                "SELECT yjs_state, content_json FROM pages WHERE id='p-snap'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(yjs_bytes.map(|v| !v.is_empty()).unwrap_or(false));
        assert_eq!(content, snapshot, "content_json snapshot must replace stale FTS source");
    }

    /// applied_hlc_ts on the page row uses MAX semantics for yjs ops
    /// (CRDT-merge, not LWW). A later op with a lower hlc_ts must
    /// still apply (yjs is order-independent) but must NOT decrement
    /// the row's stamp.
    #[test]
    fn page_yjs_stamp_uses_max_not_lww() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        use yrs::{ReadTxn, StateVector, Text, Transact};
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at)
             VALUES ('p-stamp', '2026-05-20', 1, '0', '0')",
            [],
        )
        .unwrap();
        let mk = |s: &str| -> Vec<u8> {
            let d = yrs::Doc::new();
            let t = d.get_or_insert_text("body");
            {
                let mut tx = d.transact_mut();
                t.insert(&mut tx, 0, s);
            }
            let txn = d.transact();
            let bytes = txn.encode_state_as_update_v2(&StateVector::default());
            drop(txn);
            bytes
        };
        let u_hi = mk("high-hlc");
        let u_lo = mk("low-hlc");

        // Apply high-HLC op first.
        let payload_hi = json!({
            "op": "yjs_update",
            "page_id": "p-stamp",
            "fields": {"update": B64.encode(&u_hi)},
            "hlc_ts": 1_000_i64
        });
        apply(&conn, "page_yjs", &serde_json::to_vec(&payload_hi).unwrap()).unwrap();
        let stamp_after_hi: i64 = conn
            .query_row(
                "SELECT applied_hlc_ts FROM pages WHERE id='p-stamp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stamp_after_hi, 1_000);

        // Apply low-HLC op — yjs still folds it in, but the row's
        // applied_hlc_ts must NOT regress.
        let payload_lo = json!({
            "op": "yjs_update",
            "page_id": "p-stamp",
            "fields": {"update": B64.encode(&u_lo)},
            "hlc_ts": 500_i64
        });
        let out = apply(&conn, "page_yjs", &serde_json::to_vec(&payload_lo).unwrap()).unwrap();
        assert_eq!(
            out,
            MergeOutcome::Applied,
            "yjs is NOT HLC-gated — out-of-order updates still merge"
        );
        let stamp_after_lo: i64 = conn
            .query_row(
                "SELECT applied_hlc_ts FROM pages WHERE id='p-stamp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stamp_after_lo, 1_000, "stamp must not regress to lower hlc");
    }

    #[test]
    fn tombstone_with_unknown_op_is_skipped() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let payload = json!({"op":"delete_galaxy","target":"andromeda"});
        let out = apply(&conn, "tombstone", &payload_bytes(payload)).unwrap();
        assert_eq!(out, MergeOutcome::SkippedUnknownOp);
    }

    #[test]
    fn update_pin_content_changes_content_only() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO shared_objects (id, source_page_id, object_type, content, status, position, created_at, updated_at)
             VALUES ('pin-2', NULL, 'note', 'old', 'open', 0, '0', '0')",
            [],
        )
        .unwrap();
        let payload = json!({
            "op": "update_pin_content",
            "pin_id": "pin-2",
            "fields": {"content":"new","title":null}
        });
        apply(&conn, "pin_op", &payload_bytes(payload)).unwrap();
        let c: String = conn
            .query_row("SELECT content FROM shared_objects WHERE id='pin-2'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(c, "new");
    }

    // ──────────────────────────────────────────────────────────────
    // HLC gate — phase 14.17 invariants
    // ──────────────────────────────────────────────────────────────

    /// Two ops to the same setting key: the newer HLC wins regardless
    /// of which one is applied first. This is the cardinal LWW-by-HLC
    /// property — convergence scenario 2 from the design spec.
    #[test]
    fn setting_newer_hlc_wins_regardless_of_arrival_order() {
        let db = test_db();
        let conn = db.lock().unwrap();
        // Apply the newer op first, then the older one. The older
        // must be skipped, leaving the newer value intact.
        let newer = json!({"op":"set", "key":"k", "value":"newer", "hlc_ts": 200_i64});
        let older = json!({"op":"set", "key":"k", "value":"older", "hlc_ts": 100_i64});
        let r1 = apply(&conn, "setting_op", &serde_json::to_vec(&newer).unwrap()).unwrap();
        assert_eq!(r1, MergeOutcome::Applied);
        let r2 = apply(&conn, "setting_op", &serde_json::to_vec(&older).unwrap()).unwrap();
        assert_eq!(r2, MergeOutcome::SkippedStaleHlc);
        let v: String = conn
            .query_row("SELECT value FROM settings WHERE key='k'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "newer");
    }

    /// Reverse arrival order — older first, newer second — also
    /// converges to newer. Symmetry property.
    #[test]
    fn setting_newer_hlc_wins_when_arriving_second() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let older = json!({"op":"set", "key":"k", "value":"older", "hlc_ts": 100_i64});
        let newer = json!({"op":"set", "key":"k", "value":"newer", "hlc_ts": 200_i64});
        apply(&conn, "setting_op", &serde_json::to_vec(&older).unwrap()).unwrap();
        apply(&conn, "setting_op", &serde_json::to_vec(&newer).unwrap()).unwrap();
        let v: String = conn
            .query_row("SELECT value FROM settings WHERE key='k'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "newer");
    }

    /// Same setting key applied twice at the SAME HLC — second one
    /// loses (the gate is strictly `<`, ties go to the existing row).
    /// Same-HLC writes shouldn't happen in production but we want a
    /// deterministic outcome if they do.
    #[test]
    fn setting_same_hlc_keeps_first() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let a = json!({"op":"set", "key":"k", "value":"first", "hlc_ts": 100_i64});
        let b = json!({"op":"set", "key":"k", "value":"second", "hlc_ts": 100_i64});
        apply(&conn, "setting_op", &serde_json::to_vec(&a).unwrap()).unwrap();
        let r2 = apply(&conn, "setting_op", &serde_json::to_vec(&b).unwrap()).unwrap();
        assert_eq!(r2, MergeOutcome::SkippedStaleHlc);
        let v: String = conn
            .query_row("SELECT value FROM settings WHERE key='k'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "first");
    }

    /// Page content: a stale save_page_content cannot overwrite newer
    /// content. The page row's applied_hlc_ts stamp from the first
    /// save gates out the second.
    #[test]
    fn page_save_content_newer_hlc_wins() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at)
             VALUES ('p-x', '2026-05-20', 1, '0', '0')",
            [],
        )
        .unwrap();
        let newer = json!({
            "op": "save_page_content",
            "page_id": "p-x",
            "fields": {"content_json": "{\"v\":\"newer\"}"},
            "hlc_ts": 200_i64
        });
        let older = json!({
            "op": "save_page_content",
            "page_id": "p-x",
            "fields": {"content_json": "{\"v\":\"older\"}"},
            "hlc_ts": 100_i64
        });
        apply(&conn, "page_blob", &serde_json::to_vec(&newer).unwrap()).unwrap();
        let r = apply(&conn, "page_blob", &serde_json::to_vec(&older).unwrap()).unwrap();
        assert_eq!(r, MergeOutcome::SkippedStaleHlc);
        let c: String = conn
            .query_row("SELECT content_json FROM pages WHERE id='p-x'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(c, "{\"v\":\"newer\"}");
    }

    /// A stale tombstone cannot delete a pin that's been touched by a
    /// newer op (resurrection blocker). Two-device flow: device A
    /// deletes at hlc=50, device B updates at hlc=100. B's update
    /// wins; A's delete arriving later must NOT erase B's update.
    #[test]
    fn tombstone_does_not_delete_pin_with_newer_hlc() {
        let db = test_db();
        let conn = db.lock().unwrap();
        // Seed via merge so applied_hlc_ts is stamped properly.
        let create = json!({
            "op": "create_pin",
            "pin_id": "pin-tomb",
            "fields": {"object_type":"note","content":"alive"},
            "hlc_ts": 100_i64
        });
        apply(&conn, "pin_op", &serde_json::to_vec(&create).unwrap()).unwrap();
        // Stale delete (hlc=50) arrives after.
        let del = json!({"op":"delete_pin","pin_id":"pin-tomb","hlc_ts": 50_i64});
        let r = apply(&conn, "tombstone", &serde_json::to_vec(&del).unwrap()).unwrap();
        assert_eq!(r, MergeOutcome::SkippedStaleHlc);
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shared_objects WHERE id='pin-tomb'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "pin must survive a stale delete");
    }

    /// A tombstone with newer HLC successfully deletes — the gate
    /// only blocks stale ops, not legitimate ones.
    #[test]
    fn tombstone_with_newer_hlc_deletes_pin() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let create = json!({
            "op": "create_pin",
            "pin_id": "pin-tomb-2",
            "fields": {"object_type":"note","content":"alive"},
            "hlc_ts": 100_i64
        });
        apply(&conn, "pin_op", &serde_json::to_vec(&create).unwrap()).unwrap();
        let del = json!({"op":"delete_pin","pin_id":"pin-tomb-2","hlc_ts": 200_i64});
        let r = apply(&conn, "tombstone", &serde_json::to_vec(&del).unwrap()).unwrap();
        assert_eq!(r, MergeOutcome::Applied);
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shared_objects WHERE id='pin-tomb-2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
    }

    /// Stale-skip on lineage rename. Three-way convergence: same row
    /// receives three renames out of order, ends at the highest HLC's
    /// name.
    #[test]
    fn lineage_rename_converges_to_highest_hlc() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let create = json!({
            "op": "create_lineage",
            "lineage_id": "lin-conv",
            "fields": {"name":"initial","mode":"discrete"},
            "hlc_ts": 50_i64
        });
        apply(&conn, "lineage_op", &serde_json::to_vec(&create).unwrap()).unwrap();
        // Apply three renames in random order.
        let r2 = json!({"op":"rename_lineage","lineage_id":"lin-conv","fields":{"name":"middle"},"hlc_ts":150_i64});
        let r3 = json!({"op":"rename_lineage","lineage_id":"lin-conv","fields":{"name":"highest"},"hlc_ts":200_i64});
        let r1 = json!({"op":"rename_lineage","lineage_id":"lin-conv","fields":{"name":"earliest"},"hlc_ts":100_i64});
        apply(&conn, "lineage_op", &serde_json::to_vec(&r3).unwrap()).unwrap();
        apply(&conn, "lineage_op", &serde_json::to_vec(&r1).unwrap()).unwrap();
        apply(&conn, "lineage_op", &serde_json::to_vec(&r2).unwrap()).unwrap();
        let name: String = conn
            .query_row("SELECT name FROM lineages WHERE id='lin-conv'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "highest");
    }

    /// Dispatch (local) symmetry — when a local op is applied through
    /// OpLogEngine::apply, the affected domain row's applied_hlc_ts
    /// gets stamped, so a later remote op with an older HLC for the
    /// same row gets gated out by merge.rs. This closes the local +
    /// remote unification gap (otherwise a stale remote could
    /// overwrite a recent local write).
    #[test]
    fn local_dispatch_stamps_applied_hlc_so_stale_remote_is_gated() {
        use crate::op_log::{stream, Op, OpKind, OpLogEngine};
        let db = test_db();
        let conn = db.lock().unwrap();
        // Seed a page row directly (commands.rs would normally do this).
        conn.execute(
            "INSERT INTO pages (id, date, page_number, content_json, created_at, updated_at)
             VALUES ('p-sym', '2026-05-20', 1, '{\"v\":\"local-old\"}', '0', '0')",
            [],
        )
        .unwrap();
        // Local write: emit a save_page_content op through the engine.
        // The engine generates a real HLC (current ms-since-epoch) and
        // stamps it onto the page row via stamp_applied_hlc.
        let engine = OpLogEngine::load(&conn).unwrap();
        let local_op = Op {
            kind: OpKind::page_blob(),
            doc_id: Some("p-sym".into()),
            stream_id: stream::DISCRETE_PAGES,
            payload: json!({
                "op": "save_page_content",
                "page_id": "p-sym",
                "fields": {"content_json": "{\"v\":\"local-new\"}"}
            }),
        };
        let applied = engine.apply(&conn, local_op).unwrap();
        // applied_hlc_ts on the row equals the HLC we just stamped.
        let stamped: i64 = conn
            .query_row(
                "SELECT applied_hlc_ts FROM pages WHERE id='p-sym'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stamped, applied.hlc.pack());
        // Now a stale remote op with hlc_ts well below applied.hlc must
        // be gated out (the merge handler sees the row's stamp > op's).
        let stale_remote = json!({
            "op": "save_page_content",
            "page_id": "p-sym",
            "fields": {"content_json": "{\"v\":\"remote-stale\"}"},
            "hlc_ts": 1_i64
        });
        let r = apply(
            &conn,
            "page_blob",
            &serde_json::to_vec(&stale_remote).unwrap(),
        )
        .unwrap();
        assert_eq!(r, MergeOutcome::SkippedStaleHlc);
        // Content stays at the local write — the stale remote did not
        // overwrite.
        let c: String = conn
            .query_row(
                "SELECT content_json FROM pages WHERE id='p-sym'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // commands.rs would have done the UPDATE; here we just verify
        // the gate held the line. The local write itself doesn't write
        // content_json — only the stamp landed — so the row still has
        // its seeded "local-old" payload, which is the assertion-of-
        // record that the stale remote did NOT replace it.
        assert_eq!(c, "{\"v\":\"local-old\"}");
    }

    // ──────────────────────────────────────────────────────────────
    // Multi-device convergence — phase 14.25b
    //
    // The HLC unit tests above pin per-handler behavior. These tests
    // exercise the SHAPE of merge under realistic multi-device
    // traffic: two or three databases that ferry op payloads to each
    // other and assert convergence to a single final state. The
    // ferry helper mimics what pull.rs::apply_remote_op does — it
    // takes a payload + op_kind and routes through merge::apply —
    // so what we're really testing is "the merge engine preserves
    // its invariants when called by multiple peers with overlapping
    // intent."
    // ──────────────────────────────────────────────────────────────

    /// Three writers touch three different fields on the same page
    /// row — content, what_matters_now, what_shifted. Pull delivers
    /// them in HLC-ascending order (relay returns ops ordered by
    /// user_seq, which clients emit in HLC order), so each subsequent
    /// op's HLC strictly exceeds the row's current applied_hlc_ts
    /// stamp and all three writes land.
    ///
    /// **Known design tradeoff (per-row vs per-field HLC):** the
    /// gate is `applied_hlc_ts < incoming.hlc_ts` at the row level.
    /// If three writers emit concurrently with overlapping HLCs and
    /// they happen to arrive at one device in non-ascending order
    /// (rare, but possible — e.g. if two relays' clocks diverge by
    /// more than the HLC's logical-counter range), the second-
    /// arrival's older HLC would be gated out even though it
    /// targets a DIFFERENT column. The design spec's per-field HLC
    /// would prevent that; we accepted per-row for v0.4 because
    /// yjs subsumes field-level granularity for the only field
    /// where it matters in practice (prose content). The other two
    /// fields (matters/shifted) are short LWW strings where the
    /// scenario is essentially impossible at normal HLC skew.
    #[test]
    fn three_fields_on_same_page_converge_in_hlc_order() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, content_json, created_at, updated_at)
             VALUES ('p-3f', '2026-05-20', 1, '{}', '0', '0')",
            [],
        )
        .unwrap();

        // Apply in HLC-ascending order — the realistic pull delivery.
        let writes = vec![
            json!({
                "op": "update_what_shifted",
                "page_id": "p-3f",
                "fields": {"text": "writer-c shifted"},
                "hlc_ts": 100_i64,
            }),
            json!({
                "op": "update_what_matters_now",
                "page_id": "p-3f",
                "fields": {"text": "writer-b matters"},
                "hlc_ts": 200_i64,
            }),
            json!({
                "op": "save_page_content",
                "page_id": "p-3f",
                "fields": {"content_json": "{\"v\":\"writer-a content\"}"},
                "hlc_ts": 300_i64,
            }),
        ];
        for p in writes {
            apply(&conn, "page_blob", &serde_json::to_vec(&p).unwrap()).unwrap();
        }

        let (content, matters, shifted): (String, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT content_json, what_matters_now, what_shifted
                 FROM pages WHERE id='p-3f'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(content, "{\"v\":\"writer-a content\"}");
        assert_eq!(matters.as_deref(), Some("writer-b matters"));
        assert_eq!(shifted.as_deref(), Some("writer-c shifted"));
    }

    /// Three devices each write a distinct lineage row. After we
    /// ferry every op to every device, all three databases agree on
    /// the full state. This is the "fan-in" convergence property —
    /// the design spec's verification scenario for a household with
    /// a desktop, a laptop, and a phone all editing simultaneously.
    ///
    /// Implementation note: we ferry by reading op_log rows out of
    /// each device's payload_blob column and calling merge::apply on
    /// the destination conn. That's the same code path
    /// pull.rs::apply_remote_op runs after decrypting, so this is a
    /// faithful integration shape without needing a live relay.
    #[test]
    fn three_device_fan_in_converges() {
        let db_a = test_db();
        let db_b = test_db();
        let db_c = test_db();

        // Each device creates one lineage with a distinct hlc range
        // (production HLCs are ms-since-epoch + counter — we use
        // hand-rolled values here to keep the test deterministic).
        let lineage_for = |device: &str, hlc: i64| {
            json!({
                "op": "create_lineage",
                "lineage_id": format!("lin-{device}"),
                "fields": {"name": format!("trail {device}"), "mode": "discrete"},
                "hlc_ts": hlc,
            })
        };
        let apply_local = |conn: &Connection, p: serde_json::Value| {
            // Local creates also need to land in op_log so the ferry
            // step below picks them up. Mirrors what
            // OpLogEngine::apply does without the HLC generator.
            conn.execute(
                "INSERT INTO op_log (op_id, op_kind, payload_blob, hlc_ts, state, applied_at, created_at)
                 VALUES (?, 'lineage_op', ?, ?, 'local_only', 0, 0)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    serde_json::to_vec(&p).unwrap(),
                    p["hlc_ts"].as_i64().unwrap(),
                ],
            )
            .unwrap();
            apply(conn, "lineage_op", &serde_json::to_vec(&p).unwrap()).unwrap();
        };

        {
            let conn = db_a.lock().unwrap();
            apply_local(&conn, lineage_for("a", 100));
        }
        {
            let conn = db_b.lock().unwrap();
            apply_local(&conn, lineage_for("b", 200));
        }
        {
            let conn = db_c.lock().unwrap();
            apply_local(&conn, lineage_for("c", 300));
        }

        // Ferry every op to every other device. The order doesn't
        // matter — that's the convergence claim.
        let ferry = |from: &Connection, to: &Connection| {
            let mut stmt = from
                .prepare(
                    "SELECT op_kind, payload_blob FROM op_log
                     ORDER BY hlc_ts ASC",
                )
                .unwrap();
            let rows: Vec<(String, Vec<u8>)> = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect();
            for (kind, payload) in rows {
                // Swallow errors — same as the real pull pipeline,
                // which logs but keeps advancing.
                let _ = apply(to, &kind, &payload);
            }
        };

        // 6 ferry directions for full fan-in.
        ferry(&db_a.lock().unwrap(), &db_b.lock().unwrap());
        ferry(&db_a.lock().unwrap(), &db_c.lock().unwrap());
        ferry(&db_b.lock().unwrap(), &db_a.lock().unwrap());
        ferry(&db_b.lock().unwrap(), &db_c.lock().unwrap());
        ferry(&db_c.lock().unwrap(), &db_a.lock().unwrap());
        ferry(&db_c.lock().unwrap(), &db_b.lock().unwrap());

        // Every device should see all three lineages.
        let count_in = |db: &std::sync::Arc<std::sync::Mutex<Connection>>| -> i64 {
            db.lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM lineages", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(count_in(&db_a), 3);
        assert_eq!(count_in(&db_b), 3);
        assert_eq!(count_in(&db_c), 3);

        // And on every device the three lineages should have the
        // names assigned at creation — no clobbering during the
        // multi-direction ferry.
        let name_of = |db: &std::sync::Arc<std::sync::Mutex<Connection>>, id: &str| -> String {
            db.lock()
                .unwrap()
                .query_row(
                    "SELECT name FROM lineages WHERE id = ?",
                    params![id],
                    |r| r.get(0),
                )
                .unwrap()
        };
        for db in [&db_a, &db_b, &db_c] {
            assert_eq!(name_of(db, "lin-a"), "trail a");
            assert_eq!(name_of(db, "lin-b"), "trail b");
            assert_eq!(name_of(db, "lin-c"), "trail c");
        }
    }

    /// A focus line is a singleton: the newest edit (higher HLC) replaces
    /// the older one rather than concatenating. Two different lines no longer
    /// produce "a · b" — the later change wins.
    #[test]
    fn what_matters_lww_newer_replaces() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at)
             VALUES ('p-concat', '2026-05-20', 1, '0', '0')",
            [],
        )
        .unwrap();
        // Device A writes hlc=100.
        let a = json!({
            "op": "update_what_matters_now",
            "page_id": "p-concat",
            "fields": {"text": "device-a line"},
            "hlc_ts": 100_i64,
        });
        apply(&conn, "page_blob", &serde_json::to_vec(&a).unwrap()).unwrap();
        // Device B writes hlc=200 with different text — newer, so it wins.
        let b = json!({
            "op": "update_what_matters_now",
            "page_id": "p-concat",
            "fields": {"text": "device-b line"},
            "hlc_ts": 200_i64,
        });
        apply(&conn, "page_blob", &serde_json::to_vec(&b).unwrap()).unwrap();
        let matters: String = conn
            .query_row(
                "SELECT what_matters_now FROM pages WHERE id='p-concat'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(matters, "device-b line");
    }

    /// Same edit echoed back via pull (e.g. device A receives its
    /// own upload) must NOT duplicate text. The substring-dedup
    /// branch handles this — current already contains the new text,
    /// so the column doesn't change; only applied_hlc_ts bumps.
    #[test]
    fn what_matters_concat_dedups_echoed_self_edits() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, what_matters_now, created_at, updated_at)
             VALUES ('p-echo', '2026-05-20', 1, 'already here', '0', '0')",
            [],
        )
        .unwrap();
        let echo = json!({
            "op": "update_what_matters_now",
            "page_id": "p-echo",
            "fields": {"text": "already here"},
            "hlc_ts": 500_i64,
        });
        apply(&conn, "page_blob", &serde_json::to_vec(&echo).unwrap()).unwrap();
        let matters: String = conn
            .query_row(
                "SELECT what_matters_now FROM pages WHERE id='p-echo'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(matters, "already here", "no duplicate via substring dedup");
    }

    /// LWW converges regardless of arrival order: the higher HLC wins even
    /// when it arrives first and a stale (lower-HLC) op follows.
    #[test]
    fn what_matters_lww_out_of_order_newer_wins() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at)
             VALUES ('p-oo', '2026-05-20', 1, '0', '0')",
            [],
        )
        .unwrap();
        // Newer HLC arrives first.
        let newer = json!({
            "op": "update_what_matters_now",
            "page_id": "p-oo",
            "fields": {"text": "newer first"},
            "hlc_ts": 200_i64,
        });
        apply(&conn, "page_blob", &serde_json::to_vec(&newer).unwrap()).unwrap();
        // Older HLC arrives second — gated out as stale.
        let older = json!({
            "op": "update_what_matters_now",
            "page_id": "p-oo",
            "fields": {"text": "older second"},
            "hlc_ts": 100_i64,
        });
        apply(&conn, "page_blob", &serde_json::to_vec(&older).unwrap()).unwrap();
        let matters: String = conn
            .query_row(
                "SELECT what_matters_now FROM pages WHERE id='p-oo'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // Newer wins; the stale older edit does not appear.
        assert_eq!(matters, "newer first");
    }

    /// A clear (text=null or empty) at a newer HLC wipes the column.
    /// A clear at an older HLC is gated out — otherwise echoing a
    /// stale clear could nuke real edits.
    #[test]
    fn what_matters_concat_clear_at_newer_hlc_wipes() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, what_matters_now, created_at, updated_at, applied_hlc_ts)
             VALUES ('p-clear', '2026-05-20', 1, 'something', '0', '0', 100)",
            [],
        )
        .unwrap();
        let clear = json!({
            "op": "update_what_matters_now",
            "page_id": "p-clear",
            "fields": {"text": ""},
            "hlc_ts": 200_i64,
        });
        apply(&conn, "page_blob", &serde_json::to_vec(&clear).unwrap()).unwrap();
        let matters: Option<String> = conn
            .query_row(
                "SELECT what_matters_now FROM pages WHERE id='p-clear'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(matters.is_none(), "newer-HLC clear wipes the column");
    }

    /// A stale tombstone arriving after a newer child write must NOT
    /// move the child's lineage. Concretely: device A deletes a
    /// lineage at hlc=50 (children get reparented to NULL). Device B
    /// — unaware of the delete — moves one child to a different
    /// lineage at hlc=100, then everyone fans in.
    ///
    /// The expected end state: the child that B moved stays on B's
    /// chosen lineage (hlc=100 > 50). Other children of the deleted
    /// lineage reparent per A's tombstone. The deleted lineage row
    /// itself is gone.
    #[test]
    fn stale_tombstone_does_not_move_newer_children() {
        let db = test_db();
        let conn = db.lock().unwrap();
        // Seed three lineages and two pages. Pages start out on
        // lin-old.
        conn.execute(
            "INSERT INTO lineages (id, name, created_at, mode, applied_hlc_ts) VALUES
                ('lin-old', 'old', '0', 'discrete', 10),
                ('lin-target', 'target', '0', 'discrete', 10),
                ('lin-newhome', 'newhome', '0', 'discrete', 10)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, lineage_id, created_at, updated_at, applied_hlc_ts) VALUES
                ('p-stale', '2026-05-20', 1, 'lin-old', '0', '0', 20),
                ('p-moved', '2026-05-20', 2, 'lin-old', '0', '0', 100)",
            [],
        )
        .unwrap();

        // Device B's move op: p-moved → lin-newhome at hlc=100.
        // Apply this first so the page row's applied_hlc_ts is at
        // 100 by the time the tombstone arrives.
        let move_op = json!({
            "op": "set_lineage_parent",
            // NOTE: set_lineage_parent targets a LINEAGE, not a page,
            // so for moving a page we'd need a different op. For
            // this test we directly UPDATE the page row's
            // applied_hlc_ts and lineage_id to simulate B's prior
            // emit landing.
            "lineage_id": "ignored",
            "fields": {},
            "hlc_ts": 100_i64,
        });
        let _ = move_op; // not used — direct update below
        conn.execute(
            "UPDATE pages SET lineage_id = 'lin-newhome', applied_hlc_ts = 100 WHERE id = 'p-moved'",
            [],
        )
        .unwrap();

        // Now device A's stale tombstone arrives at hlc=50.
        // - lin-old itself has applied_hlc_ts=10, so the gate passes
        //   (10 < 50) — the lineage gets deleted and children
        //   reparented per the tombstone target (NULL = top-level).
        // - p-stale has applied_hlc_ts=20, gate passes (20 < 50) →
        //   moves to NULL.
        // - p-moved has applied_hlc_ts=100, gate FAILS (100 ≥ 50) →
        //   stays on lin-newhome.
        let tombstone = json!({
            "op": "delete_lineage",
            "lineage_id": "lin-old",
            "target_lineage_id": null,
            "hlc_ts": 50_i64,
        });
        apply(&conn, "tombstone", &serde_json::to_vec(&tombstone).unwrap()).unwrap();

        // Assert.
        let p_stale_lineage: Option<String> = conn
            .query_row(
                "SELECT lineage_id FROM pages WHERE id = 'p-stale'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            p_stale_lineage, None,
            "p-stale should reparent to NULL per the tombstone"
        );

        let p_moved_lineage: Option<String> = conn
            .query_row(
                "SELECT lineage_id FROM pages WHERE id = 'p-moved'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            p_moved_lineage.as_deref(),
            Some("lin-newhome"),
            "p-moved had a newer write and must NOT be touched by the stale tombstone"
        );

        let lin_old_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lineages WHERE id = 'lin-old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lin_old_count, 0, "lin-old itself is deleted by the tombstone");
    }

    #[test]
    fn a_reference_op_without_its_object_does_not_corrupt_the_store() {
        // The object fetch is a network call the merge cannot make inline.
        // A reference op must record what it needs and leave the local store
        // untouched, rather than writing a zero-byte blob.
        let db = crate::test_helpers::test_db();
        let payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": "f".repeat(64),
            "mime_type": "image/png",
            "size_bytes": 1234,
            "chunks_b64": [],
            "hlc_ts": 1
        });
        let conn = db.lock().unwrap();
        let out = merge_attachment_blob(&conn, &payload, 1).unwrap();
        assert!(matches!(out, MergeOutcome::Applied | MergeOutcome::SkippedMalformed));
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments WHERE has_local = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "no bytes arrived, so nothing may claim to be local");
    }

    #[test]
    fn a_reference_op_records_the_object_key_it_must_be_fetched_by() {
        // Without this the row is unfetchable: blob_hash is sha256 of the
        // plaintext and the relay has never seen the plaintext, so there
        // is no address to GET from.
        let db = crate::test_helpers::test_db();
        let hash = "b".repeat(64);
        let object_key = "5".repeat(64);
        let payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": hash,
            "mime_type": "image/png",
            "size_bytes": 4096,
            "chunks_b64": [],
            "object_key": object_key,
            "hlc_ts": 1
        });
        let conn = db.lock().unwrap();
        assert_eq!(
            merge_attachment_blob(&conn, &payload, 1).unwrap(),
            MergeOutcome::Applied
        );
        let stored: Option<String> = conn
            .query_row(
                "SELECT object_key FROM attachments WHERE blob_hash = ?1",
                rusqlite::params![hash],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored.as_deref(), Some(object_key.as_str()));
    }

    #[test]
    fn a_peers_object_key_never_overwrites_the_one_this_device_uploaded() {
        // The same file sealed on two devices yields two different object
        // keys (fresh nonce per upload), both valid. This device's own key
        // is the one its un-sync must DELETE — overwriting it with a
        // peer's would strand this device's object on the relay forever,
        // still billing the account for it.
        let db = crate::test_helpers::test_db();
        let hash = "c".repeat(64);
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at, object_key) \
             VALUES (?1, 'mine.png', 'image/png', 4096, 1, 1, 't', 't', 'mine')",
            rusqlite::params![hash],
        )
        .unwrap();

        let payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": hash,
            "mime_type": "image/png",
            "size_bytes": 4096,
            "chunks_b64": [],
            "object_key": "theirs",
            "hlc_ts": 2
        });
        merge_attachment_blob(&conn, &payload, 2).unwrap();

        let stored: Option<String> = conn
            .query_row(
                "SELECT object_key FROM attachments WHERE blob_hash = ?1",
                rusqlite::params![hash],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored.as_deref(), Some("mine"));
    }

    fn object_key_and_epoch(conn: &Connection, hash: &str) -> (Option<String>, Option<i64>) {
        conn.query_row(
            "SELECT object_key, object_epoch FROM attachments WHERE blob_hash = ?1",
            rusqlite::params![hash],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    /// The epoch has to survive the merge or the receiving device cannot
    /// open the object: it holds several epoch keys and the ciphertext
    /// says nothing about which one sealed it.
    #[test]
    fn a_reference_op_records_the_epoch_its_object_was_sealed_under() {
        let db = crate::test_helpers::test_db();
        let hash = "b".repeat(64);
        let payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": hash,
            "mime_type": "image/png",
            "size_bytes": 4096,
            "chunks_b64": [],
            "object_key": "8".repeat(64),
            "object_epoch": 6,
            "hlc_ts": 1
        });
        let conn = db.lock().unwrap();
        merge_attachment_blob(&conn, &payload, 1).unwrap();
        assert_eq!(object_key_and_epoch(&conn, &hash).1, Some(6));
    }

    /// A reference from a build that predates `object_epoch` records 0.
    /// Not a fallback: that build sealed every object with
    /// `user_keys.content_master_key`, which IS the epoch-0 key, so 0 is
    /// the epoch those bytes were genuinely sealed under.
    #[test]
    fn a_reference_op_with_no_epoch_records_zero_because_zero_is_what_sealed_it() {
        let db = crate::test_helpers::test_db();
        let hash = "d".repeat(64);
        let payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": hash,
            "mime_type": "image/png",
            "size_bytes": 4096,
            "chunks_b64": [],
            "object_key": "9".repeat(64),
            "hlc_ts": 1
        });
        let conn = db.lock().unwrap();
        merge_attachment_blob(&conn, &payload, 1).unwrap();
        assert_eq!(object_key_and_epoch(&conn, &hash).1, Some(0));
    }

    /// A reference carrying no `object_key` records no epoch either.
    /// An epoch with nothing to open is noise, and it would later be
    /// paired with whatever key this device's own upload records.
    #[test]
    fn a_reference_with_no_object_key_records_no_epoch() {
        let db = crate::test_helpers::test_db();
        let hash = "e".repeat(64);
        let payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": hash,
            "mime_type": "image/png",
            "size_bytes": 4096,
            "chunks_b64": [],
            "hlc_ts": 1
        });
        let conn = db.lock().unwrap();
        merge_attachment_blob(&conn, &payload, 1).unwrap();
        assert_eq!(object_key_and_epoch(&conn, &hash), (None, None));
    }

    /// The key and the epoch are one fact and move together. When this
    /// device's own key wins the COALESCE, its epoch must win too —
    /// this device's object sealed at epoch 1 paired with a peer's
    /// claim of epoch 2 is an address that can never be opened.
    #[test]
    fn a_peers_epoch_never_lands_on_this_devices_object_key() {
        let db = crate::test_helpers::test_db();
        let hash = "c".repeat(64);
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at, object_key, object_epoch) \
             VALUES (?1, 'mine.png', 'image/png', 4096, 1, 1, 't', 't', 'mine', 1)",
            rusqlite::params![hash],
        )
        .unwrap();

        let payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": hash,
            "mime_type": "image/png",
            "size_bytes": 4096,
            "chunks_b64": [],
            "object_key": "theirs",
            "object_epoch": 2,
            "hlc_ts": 2
        });
        merge_attachment_blob(&conn, &payload, 2).unwrap();
        assert_eq!(
            object_key_and_epoch(&conn, &hash),
            (Some("mine".to_string()), Some(1)),
            "the pair moved together, or neither did"
        );
    }

    // ── C1: retractions (a peer un-synced the attachment) ─────────────

    fn revocation_payload(hash: &str, object_key: &str) -> serde_json::Value {
        serde_json::to_value(crate::sync::wire::attachment_blob::build_revocation_payload(
            hash,
            Some("image/png"),
            4096,
            object_key,
            1,
        ))
        .unwrap()
    }

    fn row_sync_key_local(conn: &Connection, hash: &str) -> (bool, Option<String>, bool) {
        conn.query_row(
            "SELECT sync, object_key, has_local FROM attachments WHERE blob_hash = ?1",
            rusqlite::params![hash],
            |r| Ok((r.get::<_, i64>(0)? != 0, r.get(1)?, r.get::<_, i64>(2)? != 0)),
        )
        .unwrap()
    }

    /// THE 404 LOOP, ENDED. A peer holding
    /// `(sync = 1, has_local = 0, object_key = K)` is exactly what
    /// `pending_object_fetch` selects, so it re-GETs a deleted K on
    /// every 30s tick for the life of the account. The op log is
    /// append-only — the reference that told it to cannot be withdrawn,
    /// only superseded.
    #[test]
    fn a_retraction_stops_a_peer_asking_for_an_object_that_was_deleted() {
        let db = crate::test_helpers::test_db();
        let hash = "a".repeat(64);
        let conn = db.lock().unwrap();
        merge_attachment_blob(&conn, &payload_value(&hash, "obj-gone"), 1).unwrap();
        assert_eq!(row_sync_key_local(&conn, &hash), (true, Some("obj-gone".into()), false));

        merge_attachment_blob(&conn, &revocation_payload(&hash, "obj-gone"), 2).unwrap();

        assert_eq!(
            row_sync_key_local(&conn, &hash),
            (false, None, false),
            "no key means nothing to fetch, and sync = 0 means the user's revocation \
             reached this device too"
        );
    }

    /// A revocation must not touch bytes this device already holds.
    /// Un-syncing takes the copy off the RELAY; sinking is not
    /// shredding, and a peer that already fetched the file keeps it.
    #[test]
    fn a_retraction_leaves_a_peers_already_fetched_bytes_alone() {
        let db = crate::test_helpers::test_db();
        let hash = "b".repeat(64);
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at, object_key, object_epoch) \
             VALUES (?1, 'kept.png', 'image/png', 4096, 1, 1, 't', 't', 'obj-gone', 0)",
            rusqlite::params![hash],
        )
        .unwrap();

        merge_attachment_blob(&conn, &revocation_payload(&hash, "obj-gone"), 2).unwrap();

        let (sync, key, has_local) = row_sync_key_local(&conn, &hash);
        assert!(!sync);
        assert!(key.is_none());
        assert!(has_local, "the file on this device is not the relay's copy");
    }

    /// The retraction is about ONE OBJECT, not about the content. The
    /// same file sealed on two devices lands under two different,
    /// equally valid keys, and each device keeps its own through
    /// `merge_attachment_reference`'s COALESCE. Device A deleting A's
    /// object says nothing about B's, which is still on the relay and
    /// still fetchable — matching on `blob_hash` alone would strand it.
    ///
    /// The same match is what makes the op order-tolerant: a retraction
    /// that arrives after the file was re-synced names the OLD key and
    /// is a no-op against the new one.
    #[test]
    fn a_retraction_of_another_devices_object_leaves_this_ones_alone() {
        let db = crate::test_helpers::test_db();
        let hash = "c".repeat(64);
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at, object_key, object_epoch) \
             VALUES (?1, 'mine.png', 'image/png', 4096, 1, 0, 't', 't', 'obj-mine', 0)",
            rusqlite::params![hash],
        )
        .unwrap();

        merge_attachment_blob(&conn, &revocation_payload(&hash, "obj-theirs"), 2).unwrap();

        assert_eq!(
            row_sync_key_local(&conn, &hash),
            (true, Some("obj-mine".into()), false),
            "this device's own object is alive on the relay and must stay fetchable"
        );
    }

    /// A retraction for content this device has never heard of updates
    /// nothing. The empty result is right: the only op this device has
    /// seen about that hash says the object is gone, so inserting a row
    /// would put a pointer to nothing in the storage panel.
    #[test]
    fn a_retraction_for_an_unknown_attachment_creates_no_row() {
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        merge_attachment_blob(&conn, &revocation_payload(&"f".repeat(64), "obj-x"), 1).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    fn payload_value(hash: &str, object_key: &str) -> serde_json::Value {
        serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": hash,
            "mime_type": "image/png",
            "size_bytes": 4096,
            "chunks_b64": [],
            "object_key": object_key,
            "object_epoch": 0,
            "hlc_ts": 1
        })
    }

    /// …and the other direction: a row that has no key of its own takes
    /// BOTH halves from the peer.
    #[test]
    fn a_row_with_no_key_of_its_own_takes_the_peers_key_and_epoch_together() {
        let db = crate::test_helpers::test_db();
        let hash = "f".repeat(64);
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at) \
             VALUES (?1, 'keyless.png', 'image/png', 4096, 1, 0, 't', 't')",
            rusqlite::params![hash],
        )
        .unwrap();

        let payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": hash,
            "mime_type": "image/png",
            "size_bytes": 4096,
            "chunks_b64": [],
            "object_key": "theirs",
            "object_epoch": 2,
            "hlc_ts": 2
        });
        merge_attachment_blob(&conn, &payload, 2).unwrap();
        assert_eq!(
            object_key_and_epoch(&conn, &hash),
            (Some("theirs".to_string()), Some(2))
        );
    }

    #[test]
    fn a_reference_op_records_the_row_pending_bytes() {
        // A well-formed reference (size_bytes > 0, no chunks) must be
        // recorded so the sync worker (Task 6) can find it and fetch the
        // bytes — it must not be dropped just because it carries none.
        let db = crate::test_helpers::test_db();
        let hash = "a".repeat(64);
        let payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": hash,
            "mime_type": "image/png",
            "size_bytes": 1234,
            "chunks_b64": [],
            "hlc_ts": 1
        });
        let conn = db.lock().unwrap();
        let out = merge_attachment_blob(&conn, &payload, 1).unwrap();
        assert_eq!(out, MergeOutcome::Applied);
        let row: (i64, i64, i64) = conn
            .query_row(
                "SELECT has_local, sync, size_bytes FROM attachments WHERE blob_hash = ?1",
                rusqlite::params![hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(row, (0, 1, 1234), "reference row waits for bytes: has_local = 0, sync = 1, size recorded");
        // And the blob store was never touched.
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments WHERE has_local = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "reference op must not write a blob or flip has_local");
    }

    #[test]
    fn a_zero_byte_reference_is_rejected_not_recorded_as_pending() {
        // chunks_b64 == [] with size_bytes == 0 is the exact shape a
        // zero-byte legacy inline payload would also produce (chunking
        // an empty slice yields no chunks). No real client emits this —
        // insert_attachment rejects empty files before any op is built,
        // on both the inline and reference paths. Treat it as malformed
        // rather than quietly recording a reference that can never be
        // satisfied, or worse, treating it as an already-local
        // zero-byte blob.
        //
        // Uses the REAL sha256 of the empty byte string as blob_hash —
        // an arbitrary hash would coincidentally get caught by the
        // legacy branch's hash-mismatch check for the wrong reason and
        // mask whether the size_bytes == 0 guard itself is doing
        // anything.
        let db = crate::test_helpers::test_db();
        let empty_hash = {
            use sha2::{Digest, Sha256};
            hex::encode(Sha256::new().finalize())
        };
        let payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": empty_hash,
            "mime_type": null,
            "size_bytes": 0,
            "chunks_b64": [],
            "hlc_ts": 1
        });
        let conn = db.lock().unwrap();
        let out = merge_attachment_blob(&conn, &payload, 1).unwrap();
        assert_eq!(out, MergeOutcome::SkippedMalformed);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "a zero-byte reference must not create any attachments row");
    }

    #[test]
    fn legacy_inline_payload_still_reassembles_verifies_and_marks_local() {
        // The legacy branch (chunks_b64 non-empty) must keep working
        // exactly as before: reassemble, verify sha256, upsert with
        // has_local = 1. One of these is already committed on the live
        // relay (user_seq 524); this is the regression guard for it.
        use crate::sync::wire::attachment_blob::build_payload;
        let db = crate::test_helpers::test_db();
        let bytes = vec![9u8; 10];
        let hash = {
            use sha2::{Digest, Sha256};
            let mut h = Sha256::new();
            h.update(&bytes);
            hex::encode(h.finalize())
        };
        let payload_dto = build_payload(&hash, Some("text/plain"), &bytes, 1);
        let payload = serde_json::to_value(&payload_dto).unwrap();
        let conn = db.lock().unwrap();
        let out = merge_attachment_blob(&conn, &payload, 1).unwrap();
        assert_eq!(out, MergeOutcome::Applied);
        let row: (i64, i64, i64) = conn
            .query_row(
                "SELECT has_local, sync, size_bytes FROM attachments WHERE blob_hash = ?1",
                rusqlite::params![hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(row, (1, 1, 10), "legacy inline op writes bytes locally: has_local = 1");
    }

    #[test]
    fn a_reference_arriving_after_local_bytes_does_not_unmark_has_local() {
        // Same content hash, legacy inline op landed first (has_local = 1).
        // A reference op for that same hash arriving afterwards (e.g. from
        // a peer that uploaded identical content the reference way) must
        // not downgrade has_local back to 0 and orphan a file the user can
        // already open.
        use crate::sync::wire::attachment_blob::build_payload;
        let db = crate::test_helpers::test_db();
        let bytes = vec![3u8; 5];
        let hash = {
            use sha2::{Digest, Sha256};
            let mut h = Sha256::new();
            h.update(&bytes);
            hex::encode(h.finalize())
        };
        let inline_dto = build_payload(&hash, Some("text/plain"), &bytes, 1);
        let inline_payload = serde_json::to_value(&inline_dto).unwrap();
        let conn = db.lock().unwrap();
        merge_attachment_blob(&conn, &inline_payload, 1).unwrap();

        let reference_payload = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": hash,
            "mime_type": "text/plain",
            "size_bytes": 5,
            "chunks_b64": [],
            "hlc_ts": 2
        });
        let out = merge_attachment_blob(&conn, &reference_payload, 2).unwrap();
        assert_eq!(out, MergeOutcome::Applied);

        let has_local: i64 = conn
            .query_row(
                "SELECT has_local FROM attachments WHERE blob_hash = ?1",
                rusqlite::params![hash],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_local, 1, "a later reference for an already-local hash must not unmark it");
    }

    /// FINDING 4 — A KEYLESS REFERENCE IS NOT CONSENT TO UPLOAD.
    ///
    /// The `sync = 1` restore guard asked only whether THIS row had no
    /// object key, not whether the incoming op carried one. For the
    /// early-build keyless shape (which
    /// `attachments::backfill::pending_object_fetch`'s own doc comment
    /// records as existing on real devices) the upsert set `sync = 1`
    /// while `COALESCE(NULL, NULL)` left `object_key` NULL — which is
    /// exactly `pending_object_upload`'s predicate. A device where the
    /// user had switched sync OFF would then upload the bytes and
    /// publish a reference, re-arming the upload they revoked.
    ///
    /// Driven through the real upload sweep rather than by reading the
    /// column, because the two agreeing on a row shape and disagreeing
    /// on what it means is the whole defect.
    #[test]
    fn a_keyless_reference_does_not_re_arm_an_upload_the_user_revoked() {
        let db = test_db();
        let hash = "d".repeat(64);
        {
            let conn = db.lock().unwrap();
            // The user's revocation: sync off, bytes still here.
            conn.execute(
                "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at) \
                 VALUES (?1, 'revoked.png', 'image/png', 4096, 0, 1, 't', 't')",
                params![hash],
            )
            .unwrap();

            merge_attachment_blob(
                &conn,
                &json!({
                    "op": "attachment_blob",
                    "blob_hash": hash,
                    "mime_type": "image/png",
                    "size_bytes": 4096,
                    "chunks_b64": [],
                    "hlc_ts": 2
                }),
                2,
            )
            .unwrap();
        }

        assert!(
            crate::attachments::backfill::pending_object_upload(&db).unwrap().is_empty(),
            "a reference with no address says nothing about whether the file is on the \
             relay, so it cannot restore consent the user withdrew"
        );
    }

    /// The accept side of the same guard: a reference that DOES carry a
    /// key still restores `sync` on a keyless row. That is the case the
    /// guard exists for — the file was re-synced from another device
    /// after a retraction cleared this row's key and flag, and leaving
    /// it at 0 would record the new address and then never fetch it.
    #[test]
    fn a_keyed_reference_still_restores_sync_on_a_keyless_row() {
        let db = test_db();
        let hash = "e".repeat(64);
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at) \
             VALUES (?1, 'resynced.png', 'image/png', 4096, 0, 0, 't', 't')",
            params![hash],
        )
        .unwrap();

        merge_attachment_blob(
            &conn,
            &json!({
                "op": "attachment_blob",
                "blob_hash": hash,
                "mime_type": "image/png",
                "size_bytes": 4096,
                "chunks_b64": [],
                "object_key": "obj-new",
                "object_epoch": 1,
                "hlc_ts": 2
            }),
            2,
        )
        .unwrap();

        assert_eq!(
            row_sync_key_local(&conn, &hash),
            (true, Some("obj-new".into()), false),
            "a keyed reference IS the account saying the bytes are on the relay again"
        );
    }

    // ── FINDING 3, receive side: a reference re-arms a swept blob ──

    /// A file block, as a page's or a pin's content carries it.
    fn file_block_json(blob_hash: &str) -> String {
        json!({
            "type": "doc",
            "content": [{
                "type": "attachment",
                "attrs": { "blob_hash": blob_hash, "filename": "contract.pdf",
                           "mime_type": "application/pdf", "size_bytes": 37 }
            }]
        })
        .to_string()
    }

    /// The bad state an existing install is already in: bytes gone,
    /// `gc_swept = 1`, relay object alive.
    fn insert_swept_attachment(conn: &Connection, hash: &str) {
        conn.execute(
            "INSERT INTO attachments (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at, object_key, object_epoch, gc_swept) \
             VALUES (?1, 'contract.pdf', 'application/pdf', 37, 1, 0, 't', 't', 'obj-alive', 0, 1)",
            params![hash],
        )
        .unwrap();
    }

    fn gc_swept_of(conn: &Connection, hash: &str) -> i64 {
        conn.query_row(
            "SELECT gc_swept FROM attachments WHERE blob_hash = ?1",
            params![hash],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// FINDING 3, the half that needs nothing from the user. A peer
    /// publishes the pin that references a file this device swept while
    /// the GC scan still read pages only. `gc_swept = 1` shuts every
    /// path back to the bytes, so the pin renders a file the device can
    /// never open — while the relay object is sitting there, alive.
    #[test]
    fn a_merged_pin_re_arms_the_attachment_it_references() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let hash = "swept-by-the-old-scan";
        insert_swept_attachment(&conn, hash);

        apply(
            &conn,
            "pin_op",
            &payload_bytes(json!({
                "op": "create_pin",
                "pin_id": "pin-1",
                "fields": {
                    "object_type": "note",
                    "content": file_block_json(hash),
                    "source_page_id": null
                }
            })),
        )
        .unwrap();

        assert_eq!(
            gc_swept_of(&conn, hash),
            0,
            "something references the file again, so the sweep's claim that it was an \
             orphan the user dropped is no longer true"
        );
    }

    /// Same rule on the page path — an incoming `save_page_content`
    /// naming the hash is equally a reference.
    #[test]
    fn a_merged_page_re_arms_the_attachment_it_references() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let hash = "swept-but-still-in-a-page";
        insert_swept_attachment(&conn, hash);
        apply(
            &conn,
            "page_blob",
            &payload_bytes(json!({
                "op": "create_new_page",
                "page_id": "p-1",
                "fields": { "date": "2026-08-09", "page_number": 1 }
            })),
        )
        .unwrap();

        apply(
            &conn,
            "page_blob",
            &payload_bytes(json!({
                "op": "save_page_content",
                "page_id": "p-1",
                "fields": { "content_json": file_block_json(hash) }
            })),
        )
        .unwrap();

        assert_eq!(gc_swept_of(&conn, hash), 0);
    }

    /// The re-arm is scoped to what the op actually names. A pin
    /// carrying a different file must leave this row swept — otherwise
    /// any incoming op un-does every explicit GC on the device (the I5
    /// defect, restated). Asserting the unchanged flag because that is
    /// the invariant, not an absence of behaviour.
    #[test]
    fn a_merged_pin_naming_another_file_leaves_this_one_swept() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let hash = "the-orphan-the-user-dropped";
        insert_swept_attachment(&conn, hash);

        apply(
            &conn,
            "pin_op",
            &payload_bytes(json!({
                "op": "create_pin",
                "pin_id": "pin-2",
                "fields": {
                    "object_type": "note",
                    "content": file_block_json("some-other-file"),
                    "source_page_id": null
                }
            })),
        )
        .unwrap();

        assert_eq!(gc_swept_of(&conn, hash), 1);
    }

    /// The re-arm must follow the WRITE, not the payload.
    /// `backfill_page_initial_state` for a page id this device already
    /// has is a no-op (`insert_page_with_collision_resolution` returns
    /// early) — which is the ordinary case, because two devices each
    /// backfill the same pre-op-log page. The peer's copy still carries
    /// the file block; this device removed it and then explicitly swept
    /// the blob. Asserting the flag is UNCHANGED because that is the
    /// invariant under test: an explicit GC stays done unless current
    /// content says otherwise, and here it does not.
    #[test]
    fn a_skipped_page_backfill_does_not_re_arm_on_its_stale_snapshot() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let hash = "the-file-the-user-freed";
        insert_swept_attachment(&conn, hash);

        // This device's page: the block is gone from it.
        apply(
            &conn,
            "page_blob",
            &payload_bytes(json!({
                "op": "backfill_page_initial_state",
                "page_id": "p-shared",
                "fields": {
                    "date": "2026-08-09", "page_number": 1,
                    "content_json": file_block_json("an-unrelated-file")
                }
            })),
        )
        .unwrap();

        // The peer's backfill of the same page, still naming the file.
        apply(
            &conn,
            "page_blob",
            &payload_bytes(json!({
                "op": "backfill_page_initial_state",
                "page_id": "p-shared",
                "fields": {
                    "date": "2026-08-09", "page_number": 1,
                    "content_json": file_block_json(hash)
                }
            })),
        )
        .unwrap();

        assert_eq!(
            gc_swept_of(&conn, hash),
            1,
            "the insert was skipped, so nothing on this device references the \
             file — re-arming here would re-download a blob the user freed"
        );
    }

    /// Same rule on the pin path: `create_pin` is `INSERT OR IGNORE`, so
    /// a second backfill of a pin this device already has leaves the row
    /// untouched. Unchanged flag asserted for the same reason as above —
    /// the stale payload is not a reference.
    #[test]
    fn a_skipped_pin_create_does_not_re_arm_on_its_stale_snapshot() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let hash = "the-pin-file-the-user-freed";
        insert_swept_attachment(&conn, hash);

        apply(
            &conn,
            "pin_op",
            &payload_bytes(json!({
                "op": "backfill_create_pin",
                "pin_id": "pin-shared",
                "fields": {
                    "object_type": "note",
                    "content": file_block_json("an-unrelated-file"),
                    "source_page_id": null
                }
            })),
        )
        .unwrap();

        apply(
            &conn,
            "pin_op",
            &payload_bytes(json!({
                "op": "backfill_create_pin",
                "pin_id": "pin-shared",
                "fields": {
                    "object_type": "note",
                    "content": file_block_json(hash),
                    "source_page_id": null
                }
            })),
        )
        .unwrap();

        assert_eq!(
            gc_swept_of(&conn, hash),
            1,
            "INSERT OR IGNORE kept this device's pin content, which does not \
             name the file — the payload that does was never adopted"
        );
    }

    /// The continuous-trail path had no re-arm at all. A peer re-adds a
    /// file to a continuous doc; the op is a `page_yjs` carrying the
    /// merged update plus the content_json snapshot. The snapshot lands
    /// in the column the GC scan reads — so the page visibly names the
    /// file — while `gc_swept = 1` keeps `pending_object_fetch` from
    /// ever pulling the bytes back. A block that renders as a file the
    /// device can never open, with the relay object alive the whole time.
    #[test]
    fn a_merged_yjs_page_re_arms_the_attachment_its_snapshot_names() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        use yrs::{ReadTxn, StateVector, Text, Transact};
        let db = test_db();
        let conn = db.lock().unwrap();
        let hash = "swept-then-re-added-on-a-continuous-trail";
        insert_swept_attachment(&conn, hash);
        // The continuous page as this device has it: no file block, which
        // is why the sweep was legitimate when it ran.
        conn.execute(
            "INSERT INTO pages (id, date, page_number, content_json, created_at, updated_at)
             VALUES ('p-yjs-att', '2026-08-09', 1, '{\"type\":\"doc\",\"content\":[]}', '0', '0')",
            [],
        )
        .unwrap();

        let doc = yrs::Doc::new();
        let text = doc.get_or_insert_text("body");
        {
            let mut tx = doc.transact_mut();
            text.insert(&mut tx, 0, "here is the contract again");
        }
        let update_bytes = doc
            .transact()
            .encode_state_as_update_v2(&StateVector::default());
        let out = apply(
            &conn,
            "page_yjs",
            &payload_bytes(json!({
                "op": "yjs_update",
                "page_id": "p-yjs-att",
                "fields": {
                    "update": B64.encode(&update_bytes),
                    "content_json": file_block_json(hash)
                }
            })),
        )
        .unwrap();
        assert_eq!(out, MergeOutcome::Applied);

        assert_eq!(
            gc_swept_of(&conn, hash),
            0,
            "the page this device now holds names the file, so the sweep's claim \
             that it was an orphan is no longer true"
        );
    }

    /// The same rule the page and pin paths were fixed for: re-arm on
    /// the WRITE, not the payload. A `page_yjs` op for a page id this
    /// device does not have returns early — no row, nothing written —
    /// and its snapshot describes a state this device never adopted.
    /// Asserting the flag is UNCHANGED because that is the invariant:
    /// an explicit GC stays done until this device's own content says
    /// otherwise, and here this device has no content at all.
    #[test]
    fn a_yjs_op_for_an_unknown_page_does_not_re_arm_on_its_snapshot() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        use yrs::{ReadTxn, StateVector, Text, Transact};
        let db = test_db();
        let conn = db.lock().unwrap();
        let hash = "the-continuous-file-the-user-freed";
        insert_swept_attachment(&conn, hash);

        let doc = yrs::Doc::new();
        let text = doc.get_or_insert_text("body");
        {
            let mut tx = doc.transact_mut();
            text.insert(&mut tx, 0, "orphaned op");
        }
        let update_bytes = doc
            .transact()
            .encode_state_as_update_v2(&StateVector::default());
        let out = apply(
            &conn,
            "page_yjs",
            &payload_bytes(json!({
                "op": "yjs_update",
                "page_id": "p-never-created",
                "fields": {
                    "update": B64.encode(&update_bytes),
                    "content_json": file_block_json(hash)
                }
            })),
        )
        .unwrap();
        assert_eq!(out, MergeOutcome::SkippedMalformed);

        assert_eq!(
            gc_swept_of(&conn, hash),
            1,
            "nothing was written, so nothing on this device references the file — \
             re-arming here would re-download a blob the user freed"
        );
    }

    /// The applied half of the same page path, so the fix above is a
    /// gate and not a removal: a backfill that really does insert its
    /// content re-arms what that content names.
    #[test]
    fn an_applied_page_backfill_re_arms_the_attachment_it_carries() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let hash = "swept-then-backfilled";
        insert_swept_attachment(&conn, hash);

        apply(
            &conn,
            "page_blob",
            &payload_bytes(json!({
                "op": "backfill_page_initial_state",
                "page_id": "p-new",
                "fields": {
                    "date": "2026-08-09", "page_number": 1,
                    "content_json": file_block_json(hash)
                }
            })),
        )
        .unwrap();

        assert_eq!(gc_swept_of(&conn, hash), 0);
    }
}
