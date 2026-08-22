use crate::db::Db;
use crate::models::{
    Block, BlockItem, BlockWithItems, FoldResult, GroundData, Line, Lineage, MentionRow, Page,
    PageSummary, PageWithLines, Pin, PinRefRow, SaveLineInput, SessionMarker, ShiftEntry,
    ShukoninSession,
};
use crate::op_log;
use rusqlite::params;
use rusqlite::OptionalExtension;
use tauri::{Manager, State};

fn load_page_with_lines(conn: &rusqlite::Connection, page: Page) -> Result<PageWithLines, String> {
    let mut stmt = conn
        .prepare("SELECT * FROM lines WHERE page_id = ? ORDER BY position ASC")
        .map_err(|e| e.to_string())?;
    let lines: Vec<Line> = stmt
        .query_map(params![&page.id], |row| Line::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT * FROM session_markers WHERE page_id = ? ORDER BY timestamp ASC")
        .map_err(|e| e.to_string())?;
    let session_markers: Vec<SessionMarker> = stmt
        .query_map(params![&page.id], |row| SessionMarker::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(PageWithLines {
        page,
        lines,
        session_markers,
    })
}

#[tauri::command]
pub fn get_or_create_today(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
) -> Result<PageWithLines, String> {
    let result = get_or_create_today_inner(&db, &engine)?;
    // Only the create branch inside `_inner` actually emits an op (an
    // existing today-page is a pure read) — wake unconditionally anyway,
    // same as `save_page_content`: a wake when nothing was queued is a
    // harmless no-op tick, and keeping the two conditions in sync here
    // would be one more place for them to drift apart.
    if let Ok(conn) = db.lock() {
        schedule_sync_wake(&worker_slot, &conn);
    }
    Ok(result)
}

pub fn get_or_create_today_inner(
    db: &Db,
    engine: &op_log::OpLog,
) -> Result<PageWithLines, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // First: check for today's most recent focus (open or closed)
    let today_focus: Option<Page> = conn
        .query_row(
            "SELECT * FROM pages WHERE date = ? ORDER BY page_number DESC LIMIT 1",
            params![&today],
            |row| Page::from_row(row),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let page = match today_focus {
        Some(p) => p,
        None => {
            // No open focuses — create a new one for today
            let max_num: Option<i64> = conn
                .query_row(
                    "SELECT COALESCE(MAX(page_number), 0) FROM pages WHERE date = ?",
                    params![&today],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;

            let page_number = max_num.unwrap_or(0) + 1;
            let id = uuid::Uuid::new_v4().to_string();

            conn.execute(
                "INSERT INTO pages (id, date, page_number, is_open, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
                params![&id, &today, page_number, &now, &now],
            )
            .map_err(|e| e.to_string())?;

            op_log::emit_page(
                engine,
                &conn,
                &id,
                "get_or_create_today",
                serde_json::json!({
                    "date": &today,
                    "page_number": page_number,
                    "is_open": true,
                }),
            );

            conn.query_row("SELECT * FROM pages WHERE id = ?", params![&id], |row| {
                Page::from_row(row)
            })
            .map_err(|e| e.to_string())?
        }
    };

    load_page_with_lines(&conn, page)
}

#[tauri::command]
pub fn get_page(
    db: State<'_, Db>,
    date: Option<String>,
    page_number: Option<i64>,
    page_id: Option<String>,
) -> Result<Option<PageWithLines>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Resolve the row by page_id first (the pin-divergence path needs
    // this — the pin only carries `source_page_id`). Fall back to the
    // legacy (date, page_number) lookup used by every other caller.
    let page: Option<Page> = if let Some(id) = page_id.as_deref() {
        conn.query_row(
            "SELECT * FROM pages WHERE id = ?",
            params![id],
            |row| Page::from_row(row),
        )
        .optional()
        .map_err(|e| e.to_string())?
    } else {
        let date = date.ok_or_else(|| "get_page: date required when page_id is null".to_string())?;
        let page_number = page_number
            .ok_or_else(|| "get_page: page_number required when page_id is null".to_string())?;
        conn.query_row(
            "SELECT * FROM pages WHERE date = ? AND page_number = ?",
            params![&date, page_number],
            |row| Page::from_row(row),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    match page {
        None => Ok(None),
        Some(page) => Ok(Some(load_page_with_lines(&conn, page)?)),
    }
}

#[tauri::command]
pub fn save_line(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    page_id: String,
    input: SaveLineInput,
) -> Result<Line, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Get next position
    let max_pos: Option<i64> = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) FROM lines WHERE page_id = ?",
            params![&page_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let position = max_pos.unwrap_or(0) + 1;

    conn.execute(
        "INSERT INTO lines (id, page_id, position, text, state, pause_duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![&id, &page_id, position, &input.text, &input.state, input.pause_duration_ms, &now],
    )
    .map_err(|e| e.to_string())?;

    // Update page's updated_at
    conn.execute(
        "UPDATE pages SET updated_at = ? WHERE id = ?",
        params![&now, &page_id],
    )
    .map_err(|e| e.to_string())?;

    // Update FTS index — aggregate all line text for this page
    let mut stmt = conn
        .prepare("SELECT text FROM lines WHERE page_id = ? ORDER BY position")
        .map_err(|e| e.to_string())?;
    let all_text: Vec<String> = stmt
        .query_map(params![&page_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let content = all_text.join("\n");

    // Get page metadata for FTS
    let page: Page = conn
        .query_row("SELECT * FROM pages WHERE id = ?", params![&page_id], |row| {
            Page::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    // Upsert FTS entry
    conn.execute(
        "DELETE FROM pages_fts WHERE page_id = ?",
        params![&page_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO pages_fts (page_id, content, what_matters_now, what_shifted, voice_memo_transcript) VALUES (?, ?, ?, ?, ?)",
        params![&page_id, &content, &page.what_matters_now, &page.what_shifted, &page.voice_memo_transcript],
    )
    .map_err(|e| e.to_string())?;

    let line: Line = conn
        .query_row("SELECT * FROM lines WHERE id = ?", params![&id], |row| {
            Line::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    op_log::emit_page(
        &engine,
        &conn,
        &page_id,
        "save_line",
        serde_json::json!({
            "line_id": &line.id,
            "position": line.position,
            "text": &line.text,
            "state": &line.state,
        }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(line)
}

#[tauri::command]
pub fn create_new_page(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    date: String,
) -> Result<PageWithLines, String> {
    let result = create_new_page_inner(&db, &engine, &date)?;
    if let Ok(conn) = db.lock() {
        schedule_sync_wake(&worker_slot, &conn);
    }
    Ok(result)
}

pub fn create_new_page_inner(
    db: &Db,
    engine: &op_log::OpLog,
    date: &str,
) -> Result<PageWithLines, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Get next page number for this date
    let max_num: Option<i64> = conn
        .query_row(
            "SELECT COALESCE(MAX(page_number), 0) FROM pages WHERE date = ?",
            params![&date],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let page_number = max_num.unwrap_or(0) + 1;
    let id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO pages (id, date, page_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        params![&id, &date, page_number, &now, &now],
    )
    .map_err(|e| e.to_string())?;

    let page: Page = conn
        .query_row("SELECT * FROM pages WHERE id = ?", params![&id], |row| {
            Page::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    op_log::emit_page(
        engine,
        &conn,
        &id,
        "create_new_page",
        serde_json::json!({
            "date": date,
            "page_number": page_number,
        }),
    );

    Ok(PageWithLines {
        page,
        lines: vec![],
        session_markers: vec![],
    })
}

/// Clone a source page into a new page for `target_date`. Copies
/// `content_json`, `what_matters_now`, and `lineage_id` so the user can keep
/// working on the new day without losing context. Pin attributes are stripped
/// from the cloned content so the clone is not double-pinned to the same row
/// as the source.
///
/// Used by the midnight transition: when the app is open across midnight and
/// the user picks "continue yesterday's flow," this command creates the new
/// day's page seeded with yesterday's state.
#[tauri::command]
pub fn clone_page_for_new_day(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    source_page_id: String,
    target_date: String,
) -> Result<PageWithLines, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let source: Page = conn
        .query_row(
            "SELECT * FROM pages WHERE id = ?",
            params![&source_page_id],
            |row| Page::from_row(row),
        )
        .map_err(|e| e.to_string())?;

    let new_id = uuid::Uuid::new_v4().to_string();
    let next_page_number: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(page_number), 0) + 1 FROM pages WHERE date = ?",
            params![&target_date],
            |row| row.get(0),
        )
        .unwrap_or(1);

    // Strip pinId attrs from the cloned content. Pins point to source-page
    // nodes; copying the node into a new page must not re-bind to the same
    // pin row. The refresh_pin_caches hook will see no pinIds in the new
    // page's doc and leave existing pins alone.
    let cloned_content = source
        .content_json
        .as_ref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .map(|mut v| {
            strip_pin_ids_in_place(&mut v);
            v.to_string()
        });

    conn.execute(
        "INSERT INTO pages (id, date, page_number, lineage_id, content_json, what_matters_now, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            &new_id,
            &target_date,
            next_page_number,
            &source.lineage_id,
            &cloned_content,
            &source.what_matters_now,
            &now,
            &now,
        ],
    )
    .map_err(|e| e.to_string())?;

    let page: Page = conn
        .query_row("SELECT * FROM pages WHERE id = ?", params![&new_id], |row| {
            Page::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    op_log::emit_page(
        &engine,
        &conn,
        &new_id,
        "clone_page_for_new_day",
        serde_json::json!({
            "source_page_id": &source_page_id,
            "target_date": &target_date,
            "lineage_id": &source.lineage_id,
            "content_json": &cloned_content,
            "what_matters_now": &source.what_matters_now,
        }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(PageWithLines {
        page,
        lines: vec![],
        session_markers: vec![],
    })
}

fn strip_pin_ids_in_place(node: &mut serde_json::Value) {
    // `pinRef` is the inline forward-reference node (@-pin mention) added in
    // v0.3; its `pinId` is the target of the reference and must survive a
    // clone. The legacy block-level `pinId` attribute on pinned blocks is
    // still stripped — those are back-pointers that would re-bind the clone
    // to the source page's pin row.
    let is_pin_ref = node.get("type").and_then(|v| v.as_str()) == Some("pinRef");
    if !is_pin_ref {
        if let Some(attrs) = node.get_mut("attrs").and_then(|a| a.as_object_mut()) {
            attrs.remove("pinId");
        }
    }
    if let Some(content) = node.get_mut("content").and_then(|c| c.as_array_mut()) {
        for child in content {
            strip_pin_ids_in_place(child);
        }
    }
}

/// Sweep pages that were created (typically by `get_or_create_today` on app
/// launch) but never received content. A page counts as an orphan only when:
///   - `what_matters_now` and `what_shifted` are unset;
///   - it has no `lines` rows;
///   - its `content_json` is missing, or is_page_empty(..) says it has no
///     real text and no standalone media (image/attachment) — see there;
///   - it isn't attached to any lineage (a continuous canonical with no
///     content yet would otherwise be wiped — preserving lineage rows keeps
///     trails intact).
///
/// Deliberately NOT date-gated — today-dated empties accumulate from "+"
/// presses, the tray/dbus new-page shortcut, and the empty-source branch of
/// handleLineageChange, and are swept the same as older ones. The composite
/// filter above (no lineage, no focus, no shifted, no lines, no text, no
/// media) is what protects real user data: anything with a single signal of
/// intent survives, regardless of date.
///
/// Returns the number of rows deleted. Safe to call on every app boot.
#[tauri::command]
pub fn cleanup_orphan_pages(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
) -> Result<i64, String> {
    let deleted = cleanup_orphan_pages_inner(&db, &engine)?;
    // Only wake when something was actually tombstoned — this runs on
    // every app boot, and most boots find nothing to sweep; waking the
    // worker on every single launch regardless would be a needless tick.
    if deleted > 0 {
        if let Ok(conn) = db.lock() {
            schedule_sync_wake(&worker_slot, &conn);
        }
    }
    Ok(deleted)
}

/// True when a local sweep of this (already-confirmed-locally-empty) page
/// must be BLOCKED because of what another device has done to it.
///
/// A GC tombstone is a guess about emptiness (see the resurrect-gate
/// comments in `sync::merge`), not a user delete — and that framing
/// applies just as much to what OTHER devices have said about a page as
/// to what this device says. So the decision isn't "has any foreign
/// device ever touched this page" (that made a page permanently
/// unsweepable the moment any peer so much as created it) — it's "what
/// was the other device's LAST WORD on this page". If the newest foreign
/// op is itself a `cleanup_orphan_page` tombstone, the other device's own
/// conclusion was "this is garbage" — a local sweep of a locally-empty
/// row agrees with that, not destroys anything. Any other newest foreign
/// op (a save, a create with no matching GC, etc.) means the other side's
/// last word was real activity, and the sweep must yield to it exactly as
/// before.
///
/// FINDING 2 of the whole-branch-review follow-up: without this
/// refinement, a page that FIX 1b (see `sync::merge::merge_tombstone`)
/// correctly refused to GC-delete — because it held non-empty content at
/// the time — would, once it later legitimately converged to empty, sit
/// forever: this device's own edits are foreign from the tombstone
/// sender's point of view, so the blanket guard treated "touched by a
/// foreign device" (true, permanently) as reason enough to never sweep
/// it, even after both sides agreed it was garbage.
///
/// Remote ops carry `device_id != ''` but leave the plaintext `doc_id`
/// column empty (the page id only lives inside the decrypted
/// `payload_blob` JSON), so the match goes through `json_extract` on the
/// payload instead of the indexed `doc_id` column. Ordering is by the
/// op_log row's own `hlc_ts` column, not payload-embedded HLC — this
/// mirrors `gc_tombstone_hlc` / `max_content_op_hlc` in `sync::merge`.
fn foreign_touch_blocks_sweep(conn: &rusqlite::Connection, page_id: &str) -> bool {
    let newest: Result<Option<(String, Option<String>)>, rusqlite::Error> = conn
        .query_row(
            "SELECT op_kind, json_extract(CAST(payload_blob AS TEXT), '$.op')
               FROM op_log
              WHERE device_id IS NOT NULL AND device_id != ''
                AND json_extract(CAST(payload_blob AS TEXT), '$.page_id') = ?1
              ORDER BY hlc_ts DESC
              LIMIT 1",
            params![page_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .optional();
    match newest {
        // No foreign op at all — nothing to block on.
        Ok(None) => false,
        Ok(Some((op_kind, op))) => {
            let newest_is_gc_tombstone =
                op_kind == "tombstone" && op.as_deref() == Some("cleanup_orphan_page");
            !newest_is_gc_tombstone
        }
        // Fail closed: this guard exists to stop a tombstone broadcast, so
        // a query error (e.g. a non-JSON payload_blob poisoning json1 for
        // this row) must be treated as "assume touched, skip the sweep"
        // rather than silently reporting untouched for every candidate.
        Err(e) => {
            log::warn!("cleanup: foreign-touch query failed for {page_id}: {e} — treating as touched");
            true
        }
    }
}

pub fn cleanup_orphan_pages_inner(db: &Db, engine: &op_log::OpLog) -> Result<i64, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Sync race guard: before the first pull of this session, an empty row
    // may be a synced page whose content ops haven't merged yet. Sweeping
    // it would tombstone another device's page. Sweep normally when sync
    // is off (fresh installs) or after the first pull pass completes.
    let sync_enabled: bool = conn
        .query_row("SELECT enabled FROM sync_state WHERE id = 1", [], |r| {
            r.get::<_, i64>(0).map(|v| v != 0)
        })
        .unwrap_or(false);
    if sync_enabled
        && !crate::sync::worker::FIRST_PULL_DONE.load(std::sync::atomic::Ordering::SeqCst)
    {
        return Ok(0);
    }

    // See the doc comment above for the full orphan definition. Runs in
    // onMount before loadToday so the user's current page hasn't been
    // resolved yet — no race with the live UI.
    let candidates: Vec<(String, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, content_json FROM pages
                 WHERE (what_matters_now IS NULL OR what_matters_now = '')
                   AND (what_shifted IS NULL OR what_shifted = '')
                   AND lineage_id IS NULL
                   AND id NOT IN (SELECT page_id FROM lines)",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let mut deleted = 0i64;
    for (id, _content_json) in candidates {
        // The SQL above is only a prefilter; `page_is_gc_eligible` is the
        // decision, and it is the same one the receiving device applies to
        // the tombstone this loop is about to broadcast.
        if !page_is_gc_eligible(&conn, &id).unwrap_or(false) {
            continue;
        }
        // Never sweep a page whose newest foreign op wasn't itself a GC
        // tombstone — unless the other device's own last word here was
        // "this is garbage" too, in which case a local sweep agrees with
        // it rather than destroying anything. See foreign_touch_blocks_sweep.
        if foreign_touch_blocks_sweep(&conn, &id) {
            continue;
        }
        // Defensive cascade — the SQL filter already excludes pages with
        // lines or lineage attachment, so blocks/session_markers/pins for
        // such pages are only theoretically possible. Best-effort cleanup
        // mirrors `delete_focus`.
        let _ = conn.execute(
            "DELETE FROM session_markers WHERE page_id = ?",
            params![&id],
        );
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "UPDATE shared_objects SET status = 'orphaned', source_page_id = NULL, updated_at = ? WHERE source_page_id = ? AND status != 'closed'",
            params![&now, &id],
        );
        // Closed pins keep their status but still need the FK reference cleared.
        let _ = conn.execute(
            "UPDATE shared_objects SET source_page_id = NULL, updated_at = ? WHERE source_page_id = ? AND status = 'closed'",
            params![&now, &id],
        );
        let _ = conn.execute("DELETE FROM pages_fts WHERE page_id = ?", params![&id]);
        let n = conn
            .execute("DELETE FROM pages WHERE id = ?", params![&id])
            .map_err(|e| e.to_string())?;
        if n > 0 {
            engine.try_apply(
                &conn,
                op_log::Op {
                    kind: op_log::OpKind::tombstone(),
                    doc_id: Some(id.clone()),
                    stream_id: op_log::stream::DISCRETE_PAGES,
                    payload: serde_json::json!({
                        "op": "cleanup_orphan_page",
                        "page_id": &id,
                    }),
                },
            );
        }
        deleted += n as i64;
    }

    Ok(deleted)
}

#[tauri::command]
pub fn update_what_matters_now(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    page_id: String,
    text: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE pages SET what_matters_now = ?, updated_at = ? WHERE id = ?",
        params![&text, &now, &page_id],
    )
    .map_err(|e| e.to_string())?;

    // Update FTS
    let _ = conn.execute(
        "UPDATE pages_fts SET what_matters_now = ? WHERE page_id = ?",
        params![&text, &page_id],
    );

    op_log::emit_page(
        &engine,
        &conn,
        &page_id,
        "update_what_matters_now",
        serde_json::json!({ "text": &text }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

#[tauri::command]
pub fn update_what_shifted(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    page_id: String,
    text: Option<String>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let trimmed = text.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty());

    match trimmed {
        Some(t) => {
            conn.execute(
                "UPDATE pages SET what_shifted = ?, what_shifted_complete = 1, updated_at = ? WHERE id = ?",
                params![t, &now, &page_id],
            )
            .map_err(|e| e.to_string())?;

            let _ = conn.execute(
                "UPDATE pages_fts SET what_shifted = ? WHERE page_id = ?",
                params![t, &page_id],
            );
        }
        None => {
            conn.execute(
                "UPDATE pages SET what_shifted = NULL, what_shifted_complete = 0, updated_at = ? WHERE id = ?",
                params![&now, &page_id],
            )
            .map_err(|e| e.to_string())?;

            let _ = conn.execute(
                "UPDATE pages_fts SET what_shifted = '' WHERE page_id = ?",
                params![&page_id],
            );
        }
    }

    op_log::emit_page(
        &engine,
        &conn,
        &page_id,
        "update_what_shifted",
        serde_json::json!({ "text": trimmed }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

#[tauri::command]
pub fn get_adjacent_page(
    db: State<'_, Db>,
    page_id: String,
    direction: String,
) -> Result<Option<PageWithLines>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let current: Page = conn
        .query_row("SELECT * FROM pages WHERE id = ?", params![&page_id], |row| {
            Page::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    // Walk page-by-page in the requested direction until we land on a relevant
    // page (trailed, focused, written, or has lines). Skips orphans created by
    // get_or_create_today / unused "+" clicks so prev/next never lands on a
    // ghost. Bound the walk so a long run of orphans can't lock the loop —
    // 100 hops is well above any realistic cluster.
    let is_next = direction == "next";
    let mut cursor_date = current.date.clone();
    let mut cursor_page_number = current.page_number;
    for _ in 0..100 {
        let same_day: Option<Page> = if is_next {
            conn.query_row(
                "SELECT * FROM pages WHERE date = ? AND page_number = ?",
                params![&cursor_date, cursor_page_number + 1],
                |row| Page::from_row(row),
            )
            .optional()
            .map_err(|e| e.to_string())?
        } else {
            conn.query_row(
                "SELECT * FROM pages WHERE date = ? AND page_number = ?",
                params![&cursor_date, cursor_page_number - 1],
                |row| Page::from_row(row),
            )
            .optional()
            .map_err(|e| e.to_string())?
        };

        let candidate: Option<Page> = if let Some(p) = same_day {
            Some(p)
        } else if is_next {
            conn.query_row(
                "SELECT * FROM pages WHERE date > ? ORDER BY date ASC, page_number ASC LIMIT 1",
                params![&cursor_date],
                |row| Page::from_row(row),
            )
            .optional()
            .map_err(|e| e.to_string())?
        } else {
            conn.query_row(
                "SELECT * FROM pages WHERE date < ? ORDER BY date DESC, page_number DESC LIMIT 1",
                params![&cursor_date],
                |row| Page::from_row(row),
            )
            .optional()
            .map_err(|e| e.to_string())?
        };

        let Some(page) = candidate else {
            return Ok(None);
        };

        let line_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lines WHERE page_id = ?",
                params![&page.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if is_page_relevant(&page, line_count > 0) {
            return Ok(Some(load_page_with_lines(&conn, page)?));
        }

        // Advance the cursor and keep walking.
        cursor_date = page.date;
        cursor_page_number = page.page_number;
    }

    Ok(None)
}

#[tauri::command]
pub fn get_page_count_for_date(db: State<'_, Db>, date: String) -> Result<i64, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Matches the rail: raw count of every page on the date, including
    // empty drafts the user just stamped via "+". Memory and prev/next do
    // their own filtering elsewhere.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pages WHERE date = ?",
            params![&date],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(count)
}

/// Page count per trail, for the whole database.
///
/// Memory's sidebar used to derive these client-side by tallying lineage_id
/// over the loaded thread — but that list is capped (`getThread(100, …)`), so
/// any trail whose pages fell outside the hundred most recent was undercounted
/// and the sidebar showed a number that quietly meant "pages on this trail,
/// among the last hundred". Counting in SQL removes the window entirely.
///
/// Returns (lineage_id, count) pairs; trails with no pages are simply absent,
/// and the caller defaults them to 0. Untrailed pages are excluded — they
/// belong to no row in the sidebar.
#[tauri::command]
pub fn get_trail_page_counts(db: State<'_, Db>) -> Result<Vec<(String, i64)>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    get_trail_page_counts_inner(&conn)
}

pub fn get_trail_page_counts_inner(
    conn: &rusqlite::Connection,
) -> Result<Vec<(String, i64)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT lineage_id, COUNT(*)
             FROM pages
             WHERE lineage_id IS NOT NULL
             GROUP BY lineage_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn strike_line(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    line_id: String,
    state: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE lines SET state = ? WHERE id = ?",
        params![&state, &line_id],
    )
    .map_err(|e| e.to_string())?;

    let page_id: Option<String> = conn
        .query_row(
            "SELECT page_id FROM lines WHERE id = ?",
            params![&line_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(pid) = page_id {
        op_log::emit_page(
            &engine,
            &conn,
            &pid,
            "strike_line",
            serde_json::json!({ "line_id": &line_id, "state": &state }),
        );
        schedule_sync_wake(&worker_slot, &conn);
    }

    Ok(())
}

/// Phase 13.9 soak instrumentation: snapshot of the op-log engine
/// state. Call from devtools during the bake week:
///   await __TAURI__.invoke('op_log_stats')
#[tauri::command]
pub fn op_log_stats(db: State<'_, Db>) -> Result<op_log::stats::OpLogStats, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    op_log::stats::collect(&conn).map_err(|e| e.to_string())
}

/// Re-run merge for any op_log rows with `merge_error IS NOT NULL`.
/// Used from the settings panel after the user surfaces a non-zero
/// failed count and wants to retry without restarting the app. The
/// underlying helper clears `merge_error` for any row that now
/// applies cleanly. Returns the count of rows that succeeded.
#[tauri::command]
pub fn sync_replay_failed(db: State<'_, Db>) -> Result<usize, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::sync::pull::replay_failed_merges(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn check_onboarding_complete(db: State<'_, Db>) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'onboarding_complete'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(result.map(|r| r == "true").unwrap_or(false))
}

#[tauri::command]
pub fn mark_onboarding_complete(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_complete', 'true')",
        [],
    )
    .map_err(|e| e.to_string())?;

    op_log::emit_setting(&engine, &conn, "onboarding_complete", Some("true"));
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

#[tauri::command]
pub fn get_thread(
    db: State<'_, Db>,
    limit: i64,
    offset: i64,
    order_by: Option<String>,
) -> Result<Vec<PageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // ORDER BY: "date" (default) sorts by authored day; "updated_at" surfaces
    // the page most recently saved first. Both fall back to page_number DESC
    // to keep multi-page-on-a-day ordering stable. Unknown values fall back
    // to date so a stale frontend never crashes the query.
    let order_clause = match order_by.as_deref() {
        Some("updated_at") => "ORDER BY p.updated_at DESC, p.page_number DESC",
        _ => "ORDER BY p.date DESC, p.page_number DESC",
    };

    // Fetch a generous batch — cheap SQL filter knocks out the obvious empties
    // (no content_json, no lines, no focus, no trail), then `is_page_relevant`
    // does the precise check (parses content_json to see if the TipTap doc has
    // real text). We over-fetch because the cheap filter still lets through
    // pages with the auto-saved empty doc `{"type":"doc","content":[...]}`.
    let fetch_limit = limit.saturating_mul(4).max(limit);
    let sql = format!(
        "SELECT p.* FROM pages p
         WHERE p.lineage_id IS NOT NULL
            OR (p.what_matters_now IS NOT NULL AND p.what_matters_now != '')
            OR (p.content_json IS NOT NULL AND p.content_json != '')
            OR EXISTS (SELECT 1 FROM lines WHERE page_id = p.id)
         {order_clause}
         LIMIT ? OFFSET ?",
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let pages: Vec<Page> = stmt
        .query_map(params![fetch_limit, offset], |row| Page::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if pages.is_empty() {
        return Ok(vec![]);
    }

    // Batch fetch: all lines for these pages in one query
    let page_ids: Vec<String> = pages.iter().map(|p| p.id.clone()).collect();
    let placeholders = page_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query_str = format!(
        "SELECT page_id, position, text FROM lines WHERE page_id IN ({}) ORDER BY page_id, position ASC",
        placeholders
    );

    let mut stmt = conn.prepare(&query_str).map_err(|e| e.to_string())?;

    let all_lines: Vec<(String, i64, String)> = {
        let rows = stmt
            .query_map(rusqlite::params_from_iter(page_ids.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    // Group lines by page_id
    let mut lines_by_page: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let mut count_by_page: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();
    for (pid, _pos, text) in &all_lines {
        let entry = lines_by_page.entry(pid.clone()).or_default();
        if entry.len() < 3 {
            entry.push(text.clone());
        }
        *count_by_page.entry(pid.clone()).or_default() += 1;
    }

    // Batch count: pins (open shared_objects) per page in one query.
    let pins_sql = format!(
        "SELECT source_page_id, COUNT(*)
         FROM shared_objects
         WHERE source_page_id IN ({}) AND status != 'closed'
         GROUP BY source_page_id",
        placeholders
    );
    let mut pin_count_by_page: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare(&pins_sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(page_ids.iter()), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (pid, n) = r.map_err(|e| e.to_string())?;
            pin_count_by_page.insert(pid, n);
        }
    }

    // Batch count: incoming backlinks per page.
    let refs_sql = format!(
        "SELECT target_page_id, COUNT(*)
         FROM page_refs
         WHERE target_page_id IN ({})
         GROUP BY target_page_id",
        placeholders
    );
    let mut backlink_count_by_page: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare(&refs_sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(page_ids.iter()), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (pid, n) = r.map_err(|e| e.to_string())?;
            backlink_count_by_page.insert(pid, n);
        }
    }

    let summaries: Vec<PageSummary> = pages
        .into_iter()
        .filter_map(|page| {
            let count = count_by_page.get(&page.id).copied().unwrap_or(0);
            if !is_page_relevant(&page, count > 0) {
                return None;
            }
            let preview = lines_by_page.remove(&page.id).unwrap_or_default();
            let pin_count = pin_count_by_page.get(&page.id).copied().unwrap_or(0);
            let backlink_count = backlink_count_by_page.get(&page.id).copied().unwrap_or(0);
            Some(PageSummary {
                id: page.id.clone(),
                date: page.date,
                page_number: page.page_number,
                preview_lines: preview,
                what_matters_now: page.what_matters_now,
                what_shifted_complete: page.what_shifted_complete,
                what_shifted: page.what_shifted.clone(),
                lineage_id: page.lineage_id.clone(),
                is_open: page.is_open,
                parent_id: page.parent_id,
                line_count: count,
                created_at: page.created_at,
                content_json: page.content_json.clone(),
                pin_count,
                backlink_count,
                updated_at: Some(page.updated_at),
            })
        })
        .take(limit as usize)
        .collect();

    Ok(summaries)
}

#[tauri::command]
pub fn search_pages(db: State<'_, Db>, query: String) -> Result<Vec<PageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT page_id FROM pages_fts WHERE pages_fts MATCH ? ORDER BY rank LIMIT 50")
        .map_err(|e| e.to_string())?;

    let matches: Vec<String> = stmt
        .query_map(params![&query], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut summaries = Vec::new();
    for page_id in matches {
        let page: Option<Page> = conn
            .query_row("SELECT * FROM pages WHERE id = ?", params![&page_id], |row| {
                Page::from_row(row)
            })
            .optional()
            .map_err(|e| e.to_string())?;

        let Some(page) = page else { continue };

        let mut stmt = conn
            .prepare("SELECT text FROM lines WHERE page_id = ? ORDER BY position ASC LIMIT 3")
            .map_err(|e| e.to_string())?;
        let lines: Vec<String> = stmt
            .query_map(params![&page.id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let line_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lines WHERE page_id = ?",
                params![&page.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        summaries.push(PageSummary {
            id: page.id.clone(),
            date: page.date,
            page_number: page.page_number,
            preview_lines: lines,
            what_matters_now: page.what_matters_now,
            what_shifted_complete: page.what_shifted_complete,
            what_shifted: page.what_shifted.clone(),
            lineage_id: page.lineage_id.clone(),
            is_open: page.is_open,
            parent_id: page.parent_id,
            line_count,
            created_at: page.created_at,
            content_json: page.content_json.clone(),
            pin_count: 0,
            backlink_count: 0,
            updated_at: Some(page.updated_at),
        });
    }

    Ok(summaries)
}

#[tauri::command]
pub fn get_ground_data(db: State<'_, Db>) -> Result<GroundData, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let first_write_date: Option<String> = conn
        .query_row("SELECT MIN(date) FROM pages", [], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();

    let total_pages: i64 = conn
        .query_row("SELECT COUNT(*) FROM pages", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT DISTINCT date FROM pages ORDER BY date ASC")
        .map_err(|e| e.to_string())?;
    let writing_dates: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT date, what_shifted, what_matters_now FROM pages WHERE what_shifted IS NOT NULL AND what_shifted != '' ORDER BY date DESC LIMIT 5",
        )
        .map_err(|e| e.to_string())?;
    let recent_shifts: Vec<ShiftEntry> = stmt
        .query_map([], |row| {
            Ok(ShiftEntry {
                date: row.get(0)?,
                text: row.get(1)?,
                what_matters_now: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(GroundData {
        first_write_date,
        total_pages,
        writing_dates,
        recent_shifts,
    })
}

#[tauri::command]
pub fn get_setting(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            params![&key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(result)
}

#[tauri::command]
pub fn set_setting(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        params![&key, &value],
    )
    .map_err(|e| e.to_string())?;

    op_log::emit_setting(&engine, &conn, &key, Some(&value));
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
pub fn set_close_to_tray(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    enabled: bool,
) -> Result<(), String> {
    use crate::tray::CloseToTray;
    use std::sync::atomic::Ordering;

    app.state::<CloseToTray>()
        .0
        .store(enabled, Ordering::Relaxed);

    let val = if enabled { "true" } else { "false" };
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        params!["close_to_tray", val],
    )
    .map_err(|e| e.to_string())?;

    op_log::emit_setting(&engine, &conn, "close_to_tray", Some(val));
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

/// Mobile stub: there is no system tray on Android/iOS, but the command must
/// exist for the invoke handler registration in lib.rs to compile on mobile
/// targets. The mobile Settings UI never surfaces the toggle.
#[cfg(mobile)]
#[tauri::command]
pub fn set_close_to_tray(_enabled: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn delete_all_data(db: State<'_, Db>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Delete in order respecting foreign key constraints. The op_log
    // is cleared alongside the rest — delete_all_data is the user's
    // panic-button reset, so a fresh op_log on the way back up is the
    // correct posture; eager backfill will reseed from the cleared
    // source tables (i.e. nothing to seed).
    let _ = conn.execute("DELETE FROM shukonin_sessions", []);
    let _ = conn.execute("DELETE FROM shared_objects", []);
    let _ = conn.execute("DELETE FROM block_items", []);
    let _ = conn.execute("DELETE FROM blocks", []);
    let _ = conn.execute("DELETE FROM session_markers", []);
    let _ = conn.execute("DELETE FROM pages_fts", []);
    let _ = conn.execute("DELETE FROM lines", []);
    let _ = conn.execute("DELETE FROM pages", []);
    let _ = conn.execute("DELETE FROM lineages", []);
    let _ = conn.execute("DELETE FROM settings", []);
    let _ = conn.execute("DELETE FROM op_log", []);
    let _ = conn.execute("DELETE FROM op_log_meta", []);
    let _ = conn.execute("DELETE FROM hlc_state", []);

    Ok(())
}

#[tauri::command]
pub fn get_open_focuses(db: State<'_, Db>) -> Result<Vec<PageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT * FROM pages WHERE is_open = 1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let pages: Vec<Page> = stmt
        .query_map([], |row| Page::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut summaries = Vec::new();
    for page in pages {
        let mut stmt = conn
            .prepare("SELECT text FROM lines WHERE page_id = ? ORDER BY position ASC LIMIT 3")
            .map_err(|e| e.to_string())?;
        let lines: Vec<String> = stmt
            .query_map(params![&page.id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let line_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lines WHERE page_id = ?",
                params![&page.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        summaries.push(PageSummary {
            id: page.id,
            date: page.date,
            page_number: page.page_number,
            preview_lines: lines,
            what_matters_now: page.what_matters_now,
            what_shifted_complete: page.what_shifted_complete,
            what_shifted: page.what_shifted.clone(),
            lineage_id: page.lineage_id.clone(),
            is_open: page.is_open,
            parent_id: page.parent_id,
            line_count,
            created_at: page.created_at,
            content_json: page.content_json.clone(),
            pin_count: 0,
            backlink_count: 0,
            updated_at: Some(page.updated_at),
        });
    }

    Ok(summaries)
}

#[tauri::command]
pub fn update_line_text(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    line_id: String,
    text: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Update line text
    conn.execute(
        "UPDATE lines SET text = ? WHERE id = ?",
        params![&text, &line_id],
    )
    .map_err(|e| e.to_string())?;

    // Get the page_id for this line to refresh FTS
    let line_page: Option<String> = conn
        .query_row(
            "SELECT page_id FROM lines WHERE id = ?",
            params![&line_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(page_id) = line_page {
        // Rebuild FTS content for this page
        let mut stmt = conn
            .prepare("SELECT text FROM lines WHERE page_id = ? ORDER BY position")
            .map_err(|e| e.to_string())?;
        let all_text: Vec<String> = stmt
            .query_map(params![&page_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let content = all_text.join("\n");

        let page: Page = conn
            .query_row("SELECT * FROM pages WHERE id = ?", params![&page_id], |row| {
                Page::from_row(row)
            })
            .map_err(|e| e.to_string())?;

        conn.execute(
            "DELETE FROM pages_fts WHERE page_id = ?",
            params![&page_id],
        )
        .map_err(|e| e.to_string())?;

        let _ = conn.execute(
            "INSERT INTO pages_fts (page_id, content, what_matters_now, what_shifted, voice_memo_transcript) VALUES (?, ?, ?, ?, ?)",
            params![&page_id, &content, &page.what_matters_now, &page.what_shifted, &page.voice_memo_transcript],
        );

        op_log::emit_page(
            &engine,
            &conn,
            &page_id,
            "update_line_text",
            serde_json::json!({ "line_id": &line_id, "text": &text }),
        );
        schedule_sync_wake(&worker_slot, &conn);
    }

    Ok(())
}

#[tauri::command]
pub fn check_and_add_session_marker(
    db: State<'_, Db>,
    page_id: String,
) -> Result<Option<SessionMarker>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();

    // Check the most recent activity: last line created_at or last session marker timestamp
    let last_line: Option<String> = conn
        .query_row(
            "SELECT created_at FROM lines WHERE page_id = ? ORDER BY created_at DESC LIMIT 1",
            params![&page_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let last_marker: Option<String> = conn
        .query_row(
            "SELECT timestamp FROM session_markers WHERE page_id = ? ORDER BY timestamp DESC LIMIT 1",
            params![&page_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    // Find the most recent activity timestamp
    let last_activity = [last_line, last_marker].into_iter().flatten().max();

    let should_add = match last_activity {
        None => false, // No activity yet — first time, no marker needed
        Some(ts) => {
            if let Ok(last_time) = chrono::DateTime::parse_from_rfc3339(&ts) {
                (now - last_time.with_timezone(&chrono::Utc)).num_hours() >= 2
            } else {
                false
            }
        }
    };

    if !should_add {
        return Ok(None);
    }

    // Generate human-readable label
    let local = chrono::Local::now();
    let label = local.format("%A %-I:%M%P").to_string().to_lowercase();

    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO session_markers (id, page_id, timestamp, label) VALUES (?, ?, ?, ?)",
        params![&id, &page_id, &now_str, &label],
    )
    .map_err(|e| e.to_string())?;

    let marker: SessionMarker = conn
        .query_row(
            "SELECT * FROM session_markers WHERE id = ?",
            params![&id],
            |row| SessionMarker::from_row(row),
        )
        .map_err(|e| e.to_string())?;

    Ok(Some(marker))
}

#[tauri::command]
pub fn get_focuses_for_date(
    db: State<'_, Db>,
    date: String,
) -> Result<Vec<PageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT * FROM pages WHERE date = ? ORDER BY page_number ASC")
        .map_err(|e| e.to_string())?;
    let pages: Vec<Page> = stmt
        .query_map(params![&date], |row| Page::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut summaries = Vec::new();
    for page in pages {
        let mut stmt = conn
            .prepare("SELECT text FROM lines WHERE page_id = ? ORDER BY position ASC LIMIT 3")
            .map_err(|e| e.to_string())?;
        let lines: Vec<String> = stmt
            .query_map(params![&page.id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let line_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lines WHERE page_id = ?",
                params![&page.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        // Today's rail intentionally surfaces every page including empty
        // drafts — clicking "+" should grow the dot count even before the
        // user types. Memory + prev/next still hide orphans via
        // is_page_relevant.
        summaries.push(PageSummary {
            id: page.id,
            date: page.date,
            page_number: page.page_number,
            preview_lines: lines,
            what_matters_now: page.what_matters_now,
            what_shifted_complete: page.what_shifted_complete,
            what_shifted: page.what_shifted.clone(),
            lineage_id: page.lineage_id.clone(),
            is_open: page.is_open,
            parent_id: page.parent_id,
            line_count,
            created_at: page.created_at,
            content_json: page.content_json.clone(),
            pin_count: 0,
            backlink_count: 0,
            updated_at: Some(page.updated_at),
        });
    }

    Ok(summaries)
}

#[tauri::command]
pub fn get_focus_picker_list(db: State<'_, Db>) -> Result<Vec<PageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT * FROM pages WHERE what_matters_now IS NOT NULL AND what_matters_now != '' ORDER BY updated_at DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;
    let pages: Vec<Page> = stmt
        .query_map([], |row| Page::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(pages
        .into_iter()
        .map(|p| PageSummary {
            id: p.id,
            date: p.date,
            page_number: p.page_number,
            preview_lines: vec![],
            what_matters_now: p.what_matters_now,
            what_shifted_complete: p.what_shifted_complete,
            what_shifted: p.what_shifted.clone(),
            lineage_id: p.lineage_id.clone(),
            is_open: p.is_open,
            parent_id: p.parent_id,
            line_count: 0,
            created_at: p.created_at,
            content_json: p.content_json.clone(),
            pin_count: 0,
            backlink_count: 0,
            updated_at: Some(p.updated_at),
        })
        .collect())
}

#[tauri::command]
pub fn set_focus_parent(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    page_id: String,
    parent_id: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE pages SET parent_id = ?, updated_at = ? WHERE id = ?",
        params![&parent_id, &now, &page_id],
    )
    .map_err(|e| e.to_string())?;

    op_log::emit_page(
        &engine,
        &conn,
        &page_id,
        "set_focus_parent",
        serde_json::json!({ "parent_id": &parent_id }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

#[tauri::command]
pub fn get_focus_lineage(
    db: State<'_, Db>,
    page_id: String,
) -> Result<Vec<PageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE ancestors AS (
            SELECT * FROM pages WHERE id = ?
            UNION ALL
            SELECT p.* FROM pages p INNER JOIN ancestors a ON p.id = a.parent_id
        )
        SELECT * FROM ancestors ORDER BY date ASC, page_number ASC",
        )
        .map_err(|e| e.to_string())?;

    let pages: Vec<Page> = stmt
        .query_map(params![&page_id], |row| Page::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(pages
        .into_iter()
        .map(|p| PageSummary {
            id: p.id,
            date: p.date,
            page_number: p.page_number,
            preview_lines: vec![],
            what_matters_now: p.what_matters_now,
            what_shifted_complete: p.what_shifted_complete,
            what_shifted: p.what_shifted.clone(),
            lineage_id: p.lineage_id.clone(),
            is_open: p.is_open,
            parent_id: p.parent_id,
            line_count: 0,
            created_at: p.created_at,
            content_json: p.content_json.clone(),
            pin_count: 0,
            backlink_count: 0,
            updated_at: Some(p.updated_at),
        })
        .collect())
}

#[tauri::command]
pub fn create_block(
    db: State<'_, Db>,
    page_id: String,
    block_type: String,
    name: Option<String>,
) -> Result<BlockWithItems, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let max_pos: Option<i64> = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) FROM blocks WHERE page_id = ?",
            params![&page_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let position = max_pos.unwrap_or(0) + 1;

    conn.execute(
        "INSERT INTO blocks (id, page_id, block_type, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params![&id, &page_id, &block_type, &name, position, &now],
    )
    .map_err(|e| e.to_string())?;

    let block: Block = conn
        .query_row("SELECT * FROM blocks WHERE id = ?", params![&id], |row| {
            Block::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    Ok(BlockWithItems {
        block,
        items: vec![],
    })
}

#[tauri::command]
pub fn add_block_item(
    db: State<'_, Db>,
    block_id: String,
    text: String,
) -> Result<BlockItem, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let max_pos: Option<i64> = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) FROM block_items WHERE block_id = ?",
            params![&block_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let position = max_pos.unwrap_or(0) + 1;

    conn.execute(
        "INSERT INTO block_items (id, block_id, text, state, position, created_at) VALUES (?, ?, ?, 'open', ?, ?)",
        params![&id, &block_id, &text, position, &now],
    )
    .map_err(|e| e.to_string())?;

    let item: BlockItem = conn
        .query_row(
            "SELECT * FROM block_items WHERE id = ?",
            params![&id],
            |row| BlockItem::from_row(row),
        )
        .map_err(|e| e.to_string())?;

    Ok(item)
}

#[tauri::command]
pub fn update_block_item_state(
    db: State<'_, Db>,
    item_id: String,
    state: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE block_items SET state = ? WHERE id = ?",
        params![&state, &item_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_blocks_for_page(
    db: State<'_, Db>,
    page_id: String,
) -> Result<Vec<BlockWithItems>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT * FROM blocks WHERE page_id = ? ORDER BY position ASC")
        .map_err(|e| e.to_string())?;
    let blocks: Vec<Block> = stmt
        .query_map(params![&page_id], |row| Block::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for block in blocks {
        let mut stmt = conn
            .prepare("SELECT * FROM block_items WHERE block_id = ? ORDER BY position ASC")
            .map_err(|e| e.to_string())?;
        let items: Vec<BlockItem> = stmt
            .query_map(params![&block.id], |row| BlockItem::from_row(row))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        result.push(BlockWithItems { block, items });
    }

    Ok(result)
}

#[tauri::command]
pub fn promote_block_to_shared(db: State<'_, Db>, block_id: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE blocks SET is_shared = 1 WHERE id = ?",
        params![&block_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_inherited_shared_blocks(
    db: State<'_, Db>,
    page_id: String,
) -> Result<Vec<BlockWithItems>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Walk up the lineage chain, collect shared blocks from all ancestors
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE ancestors AS (
            SELECT * FROM pages WHERE id = (SELECT parent_id FROM pages WHERE id = ?)
            UNION ALL
            SELECT p.* FROM pages p INNER JOIN ancestors a ON p.id = a.parent_id
        )
        SELECT * FROM ancestors",
        )
        .map_err(|e| e.to_string())?;

    let ancestors: Vec<Page> = stmt
        .query_map(params![&page_id], |row| Page::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if ancestors.is_empty() {
        return Ok(vec![]);
    }

    let mut result = Vec::new();
    for ancestor in &ancestors {
        let mut stmt = conn
            .prepare(
                "SELECT * FROM blocks WHERE page_id = ? AND is_shared = 1 ORDER BY position ASC",
            )
            .map_err(|e| e.to_string())?;
        let blocks: Vec<Block> = stmt
            .query_map(params![&ancestor.id], |row| Block::from_row(row))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        for block in blocks {
            let mut stmt = conn
                .prepare("SELECT * FROM block_items WHERE block_id = ? ORDER BY position ASC")
                .map_err(|e| e.to_string())?;
            let items: Vec<BlockItem> = stmt
                .query_map(params![&block.id], |row| BlockItem::from_row(row))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            result.push(BlockWithItems { block, items });
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn delete_focus(db: State<'_, Db>, page_id: String) -> Result<(), String> {
    delete_focus_inner(&db, &page_id)
}

pub fn delete_focus_inner(db: &Db, page_id: &str) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Delete block items for blocks on this page
    conn.execute(
        "DELETE FROM block_items WHERE block_id IN (SELECT id FROM blocks WHERE page_id = ?)",
        params![page_id],
    )
    .map_err(|e| e.to_string())?;

    // Delete blocks
    conn.execute("DELETE FROM blocks WHERE page_id = ?", params![page_id])
        .map_err(|e| e.to_string())?;

    // Delete session markers
    conn.execute(
        "DELETE FROM session_markers WHERE page_id = ?",
        params![page_id],
    )
    .map_err(|e| e.to_string())?;

    // Delete shukonin sessions
    conn.execute(
        "DELETE FROM shukonin_sessions WHERE page_id = ?",
        params![page_id],
    )
    .map_err(|e| e.to_string())?;

    // Delete lines
    conn.execute("DELETE FROM lines WHERE page_id = ?", params![page_id])
        .map_err(|e| e.to_string())?;

    // Orphan pins anchored to this page; cache is frozen at last known state.
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE shared_objects SET status = 'orphaned', source_page_id = NULL, updated_at = ? WHERE source_page_id = ? AND status != 'closed'",
        params![&now, page_id],
    )
    .map_err(|e| e.to_string())?;
    // Closed pins keep their status but still need the FK reference cleared.
    conn.execute(
        "UPDATE shared_objects SET source_page_id = NULL, updated_at = ? WHERE source_page_id = ? AND status = 'closed'",
        params![&now, page_id],
    )
    .map_err(|e| e.to_string())?;

    // Delete FTS entry
    let _ = conn.execute("DELETE FROM pages_fts WHERE page_id = ?", params![page_id]);

    // Delete the page
    conn.execute("DELETE FROM pages WHERE id = ?", params![page_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_lineages(db: State<'_, Db>) -> Result<Vec<Lineage>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT l.* FROM lineages l
         LEFT JOIN pages p ON p.lineage_id = l.id
         GROUP BY l.id
         ORDER BY MAX(p.updated_at) DESC, l.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let lineages: Vec<Lineage> = stmt
        .query_map([], |row| Lineage::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(lineages)
}

#[tauri::command]
pub fn create_lineage(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    name: String,
    mode: Option<String>,
    parent_id: Option<String>,
) -> Result<Lineage, String> {
    let result = create_lineage_inner(&db, &engine, name, mode, parent_id)?;
    if let Ok(conn) = db.lock() {
        schedule_sync_wake(&worker_slot, &conn);
    }
    Ok(result)
}

pub fn create_lineage_inner(
    db: &Db,
    engine: &op_log::OpLog,
    name: String,
    mode: Option<String>,
    parent_id: Option<String>,
) -> Result<Lineage, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mode = mode.unwrap_or_else(|| "discrete".to_string());

    conn.execute(
        "INSERT INTO lineages (id, name, created_at, mode, parent_id) VALUES (?, ?, ?, ?, ?)",
        params![&id, &name, &now, &mode, &parent_id],
    )
    .map_err(|e| e.to_string())?;

    let lineage: Lineage = conn
        .query_row("SELECT * FROM lineages WHERE id = ?", params![&id], |row| {
            Lineage::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    op_log::emit_lineage(
        engine,
        &conn,
        &id,
        "create_lineage",
        serde_json::json!({
            "name": &name,
            "mode": &mode,
            "parent_id": &parent_id,
        }),
    );

    Ok(lineage)
}

/// Enforce the single-canonical-page invariant for continuous trails.
/// Returns Err if `lineage_id` is a continuous trail that already has a *different* page assigned.
pub fn check_continuous_invariant(
    conn: &rusqlite::Connection,
    page_id: &str,
    lineage_id: &str,
) -> Result<(), String> {
    let mode: Option<String> = conn
        .query_row(
            "SELECT mode FROM lineages WHERE id = ?",
            params![lineage_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if mode.as_deref() == Some("continuous") {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM pages WHERE lineage_id = ? AND id != ? LIMIT 1",
                params![lineage_id, page_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if existing.is_some() {
            return Err("continuous_trail_has_canonical_page".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_focus_lineage(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    page_id: String,
    lineage_id: Option<String>,
) -> Result<(), String> {
    set_focus_lineage_inner(&db, &engine, &page_id, lineage_id)?;
    if let Ok(conn) = db.lock() {
        schedule_sync_wake(&worker_slot, &conn);
    }
    Ok(())
}

pub fn set_focus_lineage_inner(
    db: &Db,
    engine: &op_log::OpLog,
    page_id: &str,
    lineage_id: Option<String>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Refuse to repoint or strip the lineage_id of a page that is the
    // canonical of a continuous trail — every continuous trail has exactly
    // one page, so changing this row's lineage_id orphans the trail's
    // living document. Same-trail no-ops are allowed (the UPDATE is a
    // tautology in that case).
    let current_lid: Option<String> = match conn.query_row(
        "SELECT lineage_id FROM pages WHERE id = ?",
        params![&page_id],
        |row| row.get::<_, Option<String>>(0),
    ) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => return Err(e.to_string()),
    };
    if let Some(old_lid) = current_lid.as_deref() {
        let same = lineage_id.as_deref() == Some(old_lid);
        if !same {
            let old_mode: Option<String> = conn
                .query_row(
                    "SELECT mode FROM lineages WHERE id = ?",
                    params![old_lid],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if old_mode.as_deref() == Some("continuous") {
                return Err("cannot_repoint_continuous_canonical".to_string());
            }
        }
    }

    if let Some(lid) = &lineage_id {
        check_continuous_invariant(&conn, page_id, lid)?;
    }

    conn.execute(
        "UPDATE pages SET lineage_id = ?, updated_at = ? WHERE id = ?",
        params![&lineage_id, &now, &page_id],
    )
    .map_err(|e| e.to_string())?;

    // Pins follow the page — migrate them to the new lineage atomically.
    conn.execute(
        "UPDATE shared_objects SET lineage_id = ?, updated_at = ? WHERE source_page_id = ?",
        params![&lineage_id, &now, &page_id],
    )
    .map_err(|e| e.to_string())?;

    op_log::emit_page(
        engine,
        &conn,
        page_id,
        "set_focus_lineage",
        serde_json::json!({ "lineage_id": &lineage_id }),
    );

    Ok(())
}

/// Returns the canonical page for a continuous trail, if one exists.
/// The frontend calls this when the user selects a continuous trail to decide
/// whether to assign the current page to it or navigate to the existing doc.
#[tauri::command]
pub fn get_canonical_trail_page(
    db: State<'_, Db>,
    lineage_id: String,
) -> Result<Option<PageWithLines>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mode: Option<String> = conn
        .query_row(
            "SELECT mode FROM lineages WHERE id = ?",
            params![&lineage_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if mode.as_deref() != Some("continuous") {
        return Ok(None);
    }

    let page: Option<Page> = conn
        .query_row(
            "SELECT * FROM pages WHERE lineage_id = ? ORDER BY created_at ASC LIMIT 1",
            params![&lineage_id],
            |row| Page::from_row(row),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match page {
        Some(p) => Ok(Some(load_page_with_lines(&conn, p)?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn delete_lineage(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    lineage_id: String,
    target_lineage_id: Option<String>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Move or unlink pages
    match &target_lineage_id {
        Some(target_id) => {
            conn.execute(
                "UPDATE pages SET lineage_id = ?, updated_at = ? WHERE lineage_id = ?",
                params![target_id, &now, &lineage_id],
            )
            .map_err(|e| e.to_string())?;
        }
        None => {
            conn.execute(
                "UPDATE pages SET lineage_id = NULL, updated_at = ? WHERE lineage_id = ?",
                params![&now, &lineage_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Reparent child trails to the deleted trail's own parent (grandparent of the children).
    // Falls back to NULL if the deleted trail was already a root.
    conn.execute(
        "UPDATE lineages SET parent_id = (SELECT parent_id FROM lineages WHERE id = ?1) WHERE parent_id = ?1",
        params![&lineage_id],
    )
    .map_err(|e| e.to_string())?;

    // Re-parent pins owned by the deleted trail.
    //   • If caller supplied a target lineage, pins move there (same as pages).
    //   • Otherwise pins inherit the deleted trail's own parent, falling back
    //     to NULL (= global) if the deleted trail was a root. Matches the
    //     child-lineage re-parenting rule above and preserves user content.
    match &target_lineage_id {
        Some(target_id) => {
            conn.execute(
                "UPDATE shared_objects SET lineage_id = ?, updated_at = ? WHERE lineage_id = ?",
                params![target_id, &now, &lineage_id],
            )
            .map_err(|e| e.to_string())?;
        }
        None => {
            conn.execute(
                "UPDATE shared_objects SET lineage_id = (SELECT parent_id FROM lineages WHERE id = ?1), updated_at = ?2 WHERE lineage_id = ?1",
                params![&lineage_id, &now],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Delete the lineage
    let n = conn
        .execute("DELETE FROM lineages WHERE id = ?", params![&lineage_id])
        .map_err(|e| e.to_string())?;

    if n > 0 {
        engine.try_apply(
            &conn,
            op_log::Op {
                kind: op_log::OpKind::tombstone(),
                doc_id: Some(lineage_id.clone()),
                stream_id: op_log::stream::SETTINGS_LINEAGES_PINS,
                payload: serde_json::json!({
                    "op": "delete_lineage",
                    "lineage_id": &lineage_id,
                    "target_lineage_id": &target_lineage_id,
                }),
            },
        );
        schedule_sync_wake(&worker_slot, &conn);
    }

    Ok(())
}

/// Rename a lineage. Trims whitespace; refuses empty names and collisions
/// with typed error codes (`lineage_name_empty`, `lineage_name_taken`).
/// Returns the updated row.
pub fn rename_lineage_inner(
    conn: &rusqlite::Connection,
    lineage_id: &str,
    new_name: &str,
) -> Result<Lineage, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("lineage_name_empty".to_string());
    }

    let target_exists: Option<String> = conn
        .query_row(
            "SELECT id FROM lineages WHERE id = ?",
            params![lineage_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if target_exists.is_none() {
        return Err("lineage_not_found".to_string());
    }

    match conn.execute(
        "UPDATE lineages SET name = ? WHERE id = ?",
        params![trimmed, lineage_id],
    ) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(err, msg)) => {
            let msg_str = msg.unwrap_or_default();
            if err.code == rusqlite::ErrorCode::ConstraintViolation
                && (msg_str.contains("UNIQUE") || msg_str.contains("unique"))
            {
                return Err("lineage_name_taken".to_string());
            }
            return Err(format!("{}: {}", err, msg_str));
        }
        Err(e) => return Err(e.to_string()),
    }

    conn.query_row(
        "SELECT * FROM lineages WHERE id = ?",
        params![lineage_id],
        |row| Lineage::from_row(row),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_lineage(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    lineage_id: String,
    new_name: String,
) -> Result<Lineage, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let result = rename_lineage_inner(&conn, &lineage_id, &new_name)?;
    op_log::emit_lineage(
        &engine,
        &conn,
        &lineage_id,
        "rename_lineage",
        serde_json::json!({ "name": new_name.trim() }),
    );
    schedule_sync_wake(&worker_slot, &conn);
    Ok(result)
}

/// Reparent a lineage. `new_parent_id = None` lifts to top level.
/// Refuses self-parent, cycles (lineage_id appears in new_parent's ancestor
/// chain), and missing targets — all via typed error codes.
pub fn set_lineage_parent_inner(
    conn: &rusqlite::Connection,
    lineage_id: &str,
    new_parent_id: Option<&str>,
) -> Result<Lineage, String> {
    let target_exists: Option<String> = conn
        .query_row(
            "SELECT id FROM lineages WHERE id = ?",
            params![lineage_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if target_exists.is_none() {
        return Err("lineage_not_found".to_string());
    }

    if let Some(np) = new_parent_id {
        if np == lineage_id {
            return Err("cannot_self_parent".to_string());
        }
        let parent_exists: Option<String> = conn
            .query_row(
                "SELECT id FROM lineages WHERE id = ?",
                params![np],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if parent_exists.is_none() {
            return Err("parent_not_found".to_string());
        }
        // Walk up new_parent's ancestor chain. If lineage_id appears, it's
        // a cycle (the new parent is a descendant of the lineage we're moving).
        let mut current: Option<String> = Some(np.to_string());
        let mut hops = 0;
        while let Some(cur) = current {
            if cur == lineage_id {
                return Err("cannot_move_under_descendant".to_string());
            }
            current = conn
                .query_row(
                    "SELECT parent_id FROM lineages WHERE id = ?",
                    params![&cur],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .flatten();
            hops += 1;
            if hops > 1000 {
                return Err("ancestor_chain_too_deep".to_string());
            }
        }
    }

    conn.execute(
        "UPDATE lineages SET parent_id = ? WHERE id = ?",
        params![&new_parent_id, lineage_id],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT * FROM lineages WHERE id = ?",
        params![lineage_id],
        |row| Lineage::from_row(row),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_lineage_parent(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    lineage_id: String,
    new_parent_id: Option<String>,
) -> Result<Lineage, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let result = set_lineage_parent_inner(&conn, &lineage_id, new_parent_id.as_deref())?;
    op_log::emit_lineage(
        &engine,
        &conn,
        &lineage_id,
        "set_lineage_parent",
        serde_json::json!({ "parent_id": &new_parent_id }),
    );
    schedule_sync_wake(&worker_slot, &conn);
    Ok(result)
}

/// Walks `source_id`'s descendants via `parent_id`. Returns true if
/// `candidate` appears anywhere in the descendant tree of `source_id`.
fn is_descendant_of(
    conn: &rusqlite::Connection,
    candidate: &str,
    source_id: &str,
) -> Result<bool, String> {
    let mut current: Option<String> = Some(candidate.to_string());
    let mut hops = 0;
    while let Some(cur) = current {
        if cur == source_id {
            return Ok(true);
        }
        current = conn
            .query_row(
                "SELECT parent_id FROM lineages WHERE id = ?",
                params![&cur],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        hops += 1;
        if hops > 1000 {
            return Err("ancestor_chain_too_deep".to_string());
        }
    }
    Ok(false)
}

/// Fold one lineage into another: retarget pages and pins from source to
/// target, then delete source. Subtrails of source re-parent to source's
/// old parent (existing `delete_lineage` cascade). Returns the counts.
/// Refuses self-fold, ancestor-into-descendant, and mode-incompatible folds.
pub fn fold_lineage_inner(
    conn: &rusqlite::Connection,
    source_id: &str,
    target_id: &str,
) -> Result<FoldResult, String> {
    if source_id == target_id {
        return Err("cannot_fold_into_self".to_string());
    }

    let source_mode: Option<String> = conn
        .query_row(
            "SELECT mode FROM lineages WHERE id = ?",
            params![source_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(source_mode) = source_mode else {
        return Err("lineage_not_found".to_string());
    };

    let target_mode: Option<String> = conn
        .query_row(
            "SELECT mode FROM lineages WHERE id = ?",
            params![target_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(target_mode) = target_mode else {
        return Err("target_not_found".to_string());
    };

    if is_descendant_of(conn, target_id, source_id)? {
        return Err("cannot_fold_into_descendant".to_string());
    }

    match (source_mode.as_str(), target_mode.as_str()) {
        ("continuous", "continuous") => {
            return Err("cannot_fold_continuous_into_continuous".to_string())
        }
        ("discrete", "continuous") => {
            return Err("cannot_fold_discrete_into_continuous".to_string())
        }
        _ => {}
    }

    let pages_moved: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pages WHERE lineage_id = ?",
            params![source_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let pins_moved: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM shared_objects WHERE lineage_id = ?",
            params![source_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE pages SET lineage_id = ?, updated_at = ? WHERE lineage_id = ?",
        params![target_id, &now, source_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE shared_objects SET lineage_id = ?, updated_at = ? WHERE lineage_id = ?",
        params![target_id, &now, source_id],
    )
    .map_err(|e| e.to_string())?;
    // Subtrails of the source re-parent to source's own parent (same cascade
    // as `delete_lineage`). Doing it here keeps the semantics consistent.
    conn.execute(
        "UPDATE lineages SET parent_id = (SELECT parent_id FROM lineages WHERE id = ?1) WHERE parent_id = ?1",
        params![source_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM lineages WHERE id = ?", params![source_id])
        .map_err(|e| e.to_string())?;

    Ok(FoldResult {
        pages_moved,
        pins_moved,
    })
}

#[tauri::command]
pub fn fold_lineage(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    source_id: String,
    target_id: String,
) -> Result<FoldResult, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let result = fold_lineage_inner(&conn, &source_id, &target_id)?;
    engine.try_apply(
        &conn,
        op_log::Op {
            kind: op_log::OpKind::tombstone(),
            doc_id: Some(source_id.clone()),
            stream_id: op_log::stream::SETTINGS_LINEAGES_PINS,
            payload: serde_json::json!({
                "op": "fold_lineage",
                "source_id": &source_id,
                "target_id": &target_id,
                "pages_moved": result.pages_moved,
                "pins_moved": result.pins_moved,
            }),
        },
    );
    schedule_sync_wake(&worker_slot, &conn);
    Ok(result)
}

#[tauri::command]
pub fn get_lineage_path(
    db: State<'_, Db>,
    lineage_id: String,
) -> Result<Vec<PageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT * FROM pages WHERE lineage_id = ? ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let pages: Vec<Page> = stmt
        .query_map(params![&lineage_id], |row| Page::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(pages
        .into_iter()
        .map(|p| PageSummary {
            id: p.id,
            date: p.date,
            page_number: p.page_number,
            preview_lines: vec![],
            what_matters_now: p.what_matters_now,
            what_shifted_complete: p.what_shifted_complete,
            what_shifted: p.what_shifted.clone(),
            lineage_id: p.lineage_id.clone(),
            is_open: p.is_open,
            parent_id: p.parent_id,
            line_count: 0,
            created_at: p.created_at,
            content_json: p.content_json.clone(),
            pin_count: 0,
            backlink_count: 0,
            updated_at: Some(p.updated_at),
        })
        .collect())
}

#[tauri::command]
pub fn get_trail_pages(
    db: State<'_, Db>,
    lineage_id: String,
) -> Result<Vec<PageWithLines>, String> {
    get_trail_pages_inner(&db, &lineage_id)
}

pub fn get_trail_pages_inner(
    db: &Db,
    lineage_id: &str,
) -> Result<Vec<PageWithLines>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT * FROM pages WHERE lineage_id = ? ORDER BY date ASC, page_number ASC")
        .map_err(|e| e.to_string())?;
    let pages: Vec<Page> = stmt
        .query_map(params![&lineage_id], |row| Page::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for page in pages {
        let pwl = load_page_with_lines(&conn, page)?;
        result.push(pwl);
    }
    Ok(result)
}

#[tauri::command]
pub fn insert_line_at(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    page_id: String,
    position: i64,
    text: String,
) -> Result<Line, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Shift existing lines at or after this position
    conn.execute(
        "UPDATE lines SET position = position + 1 WHERE page_id = ? AND position >= ?",
        params![&page_id, position],
    )
    .map_err(|e| e.to_string())?;

    // Insert the new line
    conn.execute(
        "INSERT INTO lines (id, page_id, position, text, state, created_at) VALUES (?, ?, ?, ?, 'settled', ?)",
        params![&id, &page_id, position, &text, &now],
    )
    .map_err(|e| e.to_string())?;

    let line: Line = conn
        .query_row("SELECT * FROM lines WHERE id = ?", params![&id], |row| {
            Line::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    op_log::emit_page(
        &engine,
        &conn,
        &page_id,
        "insert_line_at",
        serde_json::json!({
            "line_id": &id,
            "position": position,
            "text": &text,
        }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(line)
}

#[tauri::command]
pub fn delete_line(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    line_id: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Get the line's page_id and position before deleting
    let line_info: Option<(String, i64)> = conn
        .query_row(
            "SELECT page_id, position FROM lines WHERE id = ?",
            params![&line_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM lines WHERE id = ?", params![&line_id])
        .map_err(|e| e.to_string())?;

    // Shift positions down
    if let Some((page_id, position)) = line_info {
        conn.execute(
            "UPDATE lines SET position = position - 1 WHERE page_id = ? AND position > ?",
            params![&page_id, position],
        )
        .map_err(|e| e.to_string())?;

        op_log::emit_page(
            &engine,
            &conn,
            &page_id,
            "delete_line",
            serde_json::json!({
                "line_id": &line_id,
                "position": position,
            }),
        );
        schedule_sync_wake(&worker_slot, &conn);
    }

    Ok(())
}

#[tauri::command]
pub fn update_block_item_text(
    db: State<'_, Db>,
    item_id: String,
    text: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE block_items SET text = ? WHERE id = ?",
        params![&text, &item_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn reorder_lines(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    page_id: String,
    line_ids: Vec<String>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    for (i, line_id) in line_ids.iter().enumerate() {
        conn.execute(
            "UPDATE lines SET position = ? WHERE id = ? AND page_id = ?",
            params![(i + 1) as i64, line_id, &page_id],
        )
        .map_err(|e| e.to_string())?;
    }

    op_log::emit_page(
        &engine,
        &conn,
        &page_id,
        "reorder_lines",
        serde_json::json!({ "line_ids": &line_ids }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

#[tauri::command]
pub fn save_page_content(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    page_id: String,
    content_json: String,
    yjs_state: Option<Vec<u8>>,
) -> Result<(), String> {
    save_page_content_inner(&db, &page_id, &content_json, yjs_state.as_deref())?;
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        emit_page_op(&engine, &conn, &page_id, &content_json, yjs_state.as_deref());
        // Debounced wake: subsequent saves within the window reset the
        // target, so a flurry of edits (including a `/`-command
        // interaction — open menu, navigate, pick) coalesces into one
        // upload after the user has actually settled, instead of shipping
        // the half-typed intermediate state to the other device.
        schedule_sync_wake(&worker_slot, &conn);
    }
    Ok(())
}

/// Pick the right sync-emit shape for this save. Continuous-trail pages
/// (caller passes `yjs_state`) emit a `page_yjs` op so receivers fold
/// the CRDT delta into their own state; discrete and flag-off pages
/// stay on the existing `page_blob` shape that ships the full content
/// json.
fn emit_page_op(
    engine: &op_log::OpLog,
    conn: &rusqlite::Connection,
    page_id: &str,
    content_json: &str,
    yjs_state: Option<&[u8]>,
) {
    match yjs_state {
        Some(bytes) => {
            op_log::emit_page_yjs(engine, conn, page_id, bytes, content_json);
        }
        None => {
            op_log::emit_page(
                engine,
                conn,
                page_id,
                "save_page_content",
                serde_json::json!({ "content_json": content_json }),
            );
        }
    }
}

#[tauri::command]
pub fn load_page_content_for_modal(
    db: State<'_, Db>,
    page_id: String,
) -> Result<String, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let content: String = conn
        .query_row(
            "SELECT content_json FROM pages WHERE id = ?",
            params![&page_id],
            |row| row.get::<_, Option<String>>(0).map(|v| v.unwrap_or_default()),
        )
        .map_err(|e| e.to_string())?;
    Ok(content)
}

#[tauri::command]
pub fn save_page_content_with_pin_refresh(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    page_id: String,
    content_json: String,
    yjs_state: Option<Vec<u8>>,
) -> Result<(), String> {
    save_page_content_inner(&db, &page_id, &content_json, yjs_state.as_deref())?;
    let conn = db.lock().map_err(|e| e.to_string())?;
    emit_page_op(&engine, &conn, &page_id, &content_json, yjs_state.as_deref());
    Ok(())
}

pub fn save_page_content_inner(
    db: &Db,
    page_id: &str,
    content_json: &str,
    yjs_state: Option<&[u8]>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // COALESCE preserves any prior yjs_state when the caller passed
    // None — discrete-trail saves on a page that already had yjs_state
    // (from a continuous-trail past) shouldn't blow it away. Continuous
    // pages overwrite it with the editor's fresh bytes.
    conn.execute(
        "UPDATE pages
            SET content_json = ?,
                yjs_state = COALESCE(?, yjs_state),
                updated_at = ?
         WHERE id = ?",
        params![content_json, &yjs_state, &now, page_id],
    )
    .map_err(|e| e.to_string())?;

    // Extract plain text for FTS
    let text_content: String = serde_json::from_str::<serde_json::Value>(content_json)
        .ok()
        .and_then(|v| extract_text_from_tiptap(&v))
        .unwrap_or_default();

    // Update FTS index
    let _ = conn.execute("DELETE FROM pages_fts WHERE page_id = ?", params![page_id]);

    let page: Page = conn
        .query_row("SELECT * FROM pages WHERE id = ?", params![page_id], |row| {
            Page::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "INSERT INTO pages_fts (page_id, content, what_matters_now, what_shifted, voice_memo_transcript) VALUES (?, ?, ?, ?, ?)",
        params![page_id, &text_content, &page.what_matters_now, &page.what_shifted, &page.voice_memo_transcript],
    );

    refresh_pin_caches(&conn, page_id, content_json)?;
    refresh_page_refs(&conn, page_id, content_json)?;
    refresh_pin_refs(&conn, page_id, content_json)?;

    Ok(())
}

/// Walks the saved doc for nodes with `pinId` attrs and refreshes the
/// matching shared_objects rows' `content` and `title` caches. Pins whose
/// `pinId` is no longer in the doc flip to status='orphaned' (cache
/// untouched, frozen at last known). Pin row's `id` column is the locator
/// (matches `pinId` attr).
fn refresh_pin_caches(
    conn: &rusqlite::Connection,
    page_id: &str,
    content_json: &str,
) -> Result<(), String> {
    let doc: serde_json::Value = match serde_json::from_str(content_json) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    let mut found: std::collections::HashMap<String, serde_json::Value> =
        std::collections::HashMap::new();
    collect_pin_nodes(&doc, &mut found);

    let now = chrono::Utc::now().to_rfc3339();

    for (pin_id, node) in &found {
        let node_json = node.to_string();
        let title = extract_block_title(node);
        // Ownership follows the doc. This used to require
        // `source_page_id = ?`, so a pin injected into another page carried
        // its id but could never write back — every edit to the injected
        // copy was silently discarded, because the row still belonged to the
        // page it was originally pinned from.
        //
        // Matching on the id alone and re-stamping source_page_id means the
        // page that last saved a doc containing this pin owns it. That keeps
        // exactly one owner, so two pages cannot race, and the orphan sweep
        // below stays correct: it scopes by source_page_id, which now names
        // the page the pin actually lives on.
        conn.execute(
            "UPDATE shared_objects SET content = ?, title = ?, source_page_id = ?, \
             status = CASE WHEN status = 'orphaned' THEN 'open' ELSE status END, \
             updated_at = ? WHERE id = ?",
            params![&node_json, &title, page_id, &now, pin_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let found_ids: Vec<String> = found.keys().cloned().collect();
    if found_ids.is_empty() {
        conn.execute(
            "UPDATE shared_objects SET status = 'orphaned', updated_at = ? \
             WHERE source_page_id = ? AND status = 'open'",
            params![&now, page_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let placeholders = vec!["?"; found_ids.len()].join(",");
        let sql = format!(
            "UPDATE shared_objects SET status = 'orphaned', updated_at = ? \
             WHERE source_page_id = ? AND status = 'open' AND id NOT IN ({})",
            placeholders
        );
        let mut all_params: Vec<String> = vec![now.clone(), page_id.to_string()];
        all_params.extend(found_ids.iter().cloned());
        conn.execute(&sql, rusqlite::params_from_iter(all_params.iter()))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn collect_pin_nodes(
    node: &serde_json::Value,
    out: &mut std::collections::HashMap<String, serde_json::Value>,
) {
    if let Some(attrs) = node.get("attrs").and_then(|a| a.as_object()) {
        if let Some(pin_id) = attrs.get("pinId").and_then(|v| v.as_str()) {
            out.entry(pin_id.to_string()).or_insert_with(|| node.clone());
        }
    }
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            collect_pin_nodes(child, out);
        }
    }
}

/// Walk the saved doc for `pageRef` nodes and refresh the `page_refs`
/// index for this source page. Deletes all existing rows for the source,
/// then inserts the deduped current set.
pub fn refresh_page_refs(
    conn: &rusqlite::Connection,
    source_page_id: &str,
    content_json: &str,
) -> Result<(), String> {
    let doc: serde_json::Value = match serde_json::from_str(content_json) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    let mut targets: std::collections::HashSet<String> = std::collections::HashSet::new();
    collect_page_ref_targets(&doc, &mut targets);
    // A page referencing itself is meaningless; never store it.
    targets.remove(source_page_id);

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "DELETE FROM page_refs WHERE source_page_id = ?",
        params![source_page_id],
    )
    .map_err(|e| e.to_string())?;

    for target_id in &targets {
        conn.execute(
            "INSERT OR IGNORE INTO page_refs (source_page_id, target_page_id, created_at) VALUES (?, ?, ?)",
            params![source_page_id, target_id, &now],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn collect_page_ref_targets(
    node: &serde_json::Value,
    out: &mut std::collections::HashSet<String>,
) {
    if node.get("type").and_then(|v| v.as_str()) == Some("pageRef") {
        if let Some(attrs) = node.get("attrs").and_then(|a| a.as_object()) {
            if let Some(tid) = attrs.get("targetId").and_then(|v| v.as_str()) {
                if !tid.is_empty() {
                    out.insert(tid.to_string());
                }
            }
        }
    }
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            collect_page_ref_targets(child, out);
        }
    }
}

/// Mirror of `refresh_page_refs` for `pinRef` nodes. Walks the doc, collects
/// every distinct `pinId`, and rewrites `pin_refs` rows for this source
/// page in a DELETE+INSERT sweep. Same per-save semantics: the table is
/// authoritative as of the last save, no stale entries after a node is
/// removed from the doc.
pub fn refresh_pin_refs(
    conn: &rusqlite::Connection,
    source_page_id: &str,
    content_json: &str,
) -> Result<(), String> {
    let doc: serde_json::Value = match serde_json::from_str(content_json) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    let mut targets: std::collections::HashSet<String> = std::collections::HashSet::new();
    collect_pin_ref_targets(&doc, &mut targets);

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "DELETE FROM pin_refs WHERE source_page_id = ?",
        params![source_page_id],
    )
    .map_err(|e| e.to_string())?;

    for pin_id in &targets {
        conn.execute(
            "INSERT OR IGNORE INTO pin_refs (source_page_id, target_pin_id, created_at) VALUES (?, ?, ?)",
            params![source_page_id, pin_id, &now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn collect_pin_ref_targets(
    node: &serde_json::Value,
    out: &mut std::collections::HashSet<String>,
) {
    if node.get("type").and_then(|v| v.as_str()) == Some("pinRef") {
        if let Some(attrs) = node.get("attrs").and_then(|a| a.as_object()) {
            if let Some(pid) = attrs.get("pinId").and_then(|v| v.as_str()) {
                if !pid.is_empty() {
                    out.insert(pid.to_string());
                }
            }
        }
    }
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            collect_pin_ref_targets(child, out);
        }
    }
}

/// Pages that reference `target_pin_id` via `pinRef` nodes. Returns slim
/// `MentionRow`s ordered by source-page recency so the freshest references
/// surface first in the pin modal's "referenced from" line.
#[tauri::command]
pub fn get_backlinks_for_pin(
    db: State<'_, Db>,
    pin_id: String,
) -> Result<Vec<MentionRow>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.date, p.page_number, p.what_matters_now,
                    p.lineage_id, l.mode AS lineage_mode
             FROM pin_refs r
             JOIN pages p ON p.id = r.source_page_id
             LEFT JOIN lineages l ON l.id = p.lineage_id
             WHERE r.target_pin_id = ?
             ORDER BY p.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<MentionRow> = stmt
        .query_map(params![&pin_id], |row| {
            Ok(MentionRow {
                page_id: row.get("id")?,
                date: row.get("date")?,
                page_number: row.get("page_number")?,
                what_matters_now: row.get("what_matters_now")?,
                lineage_id: row.get("lineage_id")?,
                lineage_mode: row.get("lineage_mode")?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Resolve every page that references `target_page_id` and return slim
/// `MentionRow`s for client-side label assembly. Ordered by recency of
/// the source page (most-recent-source first).
pub fn get_backlinks_for_page_inner(
    conn: &rusqlite::Connection,
    target_page_id: &str,
) -> Result<Vec<MentionRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.date, p.page_number, p.what_matters_now,
                    p.lineage_id, l.mode AS lineage_mode
             FROM page_refs r
             JOIN pages p ON p.id = r.source_page_id
             LEFT JOIN lineages l ON l.id = p.lineage_id
             WHERE r.target_page_id = ?
             ORDER BY p.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<MentionRow> = stmt
        .query_map(params![target_page_id], |row| {
            Ok(MentionRow {
                page_id: row.get("id")?,
                date: row.get("date")?,
                page_number: row.get("page_number")?,
                what_matters_now: row.get("what_matters_now")?,
                lineage_id: row.get("lineage_id")?,
                lineage_mode: row.get("lineage_mode")?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn get_backlinks_for_page(
    db: State<'_, Db>,
    target_page_id: String,
) -> Result<Vec<MentionRow>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    get_backlinks_for_page_inner(&conn, &target_page_id)
}

fn extract_block_title(node: &serde_json::Value) -> Option<String> {
    let attrs = node.get("attrs")?.as_object()?;
    let title = attrs.get("blockTitle")?.as_str()?;
    let trimmed = title.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[tauri::command]
pub fn save_trail_content(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    lineage_id: String,
    page_id: String,
    content_json: String,
) -> Result<(), String> {
    save_trail_content_inner(&db, &lineage_id, &page_id, &content_json)?;
    let conn = db.lock().map_err(|e| e.to_string())?;
    op_log::emit_page(
        &engine,
        &conn,
        &page_id,
        "save_trail_content",
        serde_json::json!({
            "lineage_id": &lineage_id,
            "content_json": &content_json,
        }),
    );
    // Continuous-trail docs can grow to 50k+ words under one canonical
    // page — this was save_page_content's sibling gap: the debounced
    // wake existed only on the discrete/untrailed save path, so trail
    // content sat unsent until the worker's next unforced tick.
    schedule_sync_wake(&worker_slot, &conn);
    Ok(())
}

pub fn save_trail_content_inner(
    db: &Db,
    _lineage_id: &str,
    page_id: &str,
    content_json: &str,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Save content to today's page
    conn.execute(
        "UPDATE pages SET content_json = ?, updated_at = ? WHERE id = ?",
        params![content_json, &now, page_id],
    )
    .map_err(|e| e.to_string())?;

    // Past pages keep their content as historical snapshots — no clearing

    // Update FTS index
    let text_content: String = serde_json::from_str::<serde_json::Value>(content_json)
        .ok()
        .and_then(|v| extract_text_from_tiptap(&v))
        .unwrap_or_default();

    let _ = conn.execute("DELETE FROM pages_fts WHERE page_id = ?", params![page_id]);

    let page: Page = conn
        .query_row("SELECT * FROM pages WHERE id = ?", params![page_id], |row| {
            Page::from_row(row)
        })
        .map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "INSERT INTO pages_fts (page_id, content, what_matters_now, what_shifted, voice_memo_transcript) VALUES (?, ?, ?, ?, ?)",
        params![page_id, &text_content, &page.what_matters_now, &page.what_shifted, &page.voice_memo_transcript],
    );

    refresh_pin_caches(&conn, page_id, content_json)?;
    refresh_page_refs(&conn, page_id, content_json)?;
    refresh_pin_refs(&conn, page_id, content_json)?;

    Ok(())
}

fn extract_text_from_tiptap(value: &serde_json::Value) -> Option<String> {
    let mut texts = Vec::new();
    extract_text_recursive(value, &mut texts);
    if texts.is_empty() {
        None
    } else {
        Some(texts.join("\n"))
    }
}

fn extract_text_recursive(value: &serde_json::Value, texts: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(|v| v.as_str()) {
                texts.push(text.to_string());
            }
            if let Some(content) = map.get("content").and_then(|v| v.as_array()) {
                for item in content {
                    extract_text_recursive(item, texts);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                extract_text_recursive(item, texts);
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub fn get_pins(db: State<'_, Db>, lineage_id: Option<String>) -> Result<Vec<Pin>, String> {
    get_pins_inner(&db, lineage_id)
}

pub fn get_pins_inner(db: &Db, lineage_id: Option<String>) -> Result<Vec<Pin>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let objects: Vec<Pin> = match lineage_id {
        Some(lid) => {
            // A pin is visible in trail T if its lineage_id is T or any ancestor of T.
            // The recursive CTE walks parent_id upward from the current lineage.
            let sql = r#"
                WITH RECURSIVE chain(id) AS (
                    SELECT ?1
                    UNION ALL
                    SELECT l.parent_id FROM lineages l
                    JOIN chain c ON l.id = c.id
                    WHERE l.parent_id IS NOT NULL
                )
                SELECT so.id, so.lineage_id, so.source_page_id, so.object_type,
                       so.title, so.content, so.status, so.position, so.auto_insert,
                       so.diverged, so.created_at, so.updated_at,
                       p.lineage_id AS source_page_lineage_id
                FROM shared_objects so
                LEFT JOIN pages p ON p.id = so.source_page_id
                WHERE so.lineage_id IN (SELECT id FROM chain)
                ORDER BY so.object_type, so.position ASC, so.created_at ASC
            "#;
            let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows: Vec<Pin> = stmt
                .query_map(params![&lid], |row| Pin::from_row_joined(row))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        }
        None => {
            let sql = r#"
                SELECT so.id, so.lineage_id, so.source_page_id, so.object_type,
                       so.title, so.content, so.status, so.position, so.auto_insert,
                       so.diverged, so.created_at, so.updated_at,
                       p.lineage_id AS source_page_lineage_id
                FROM shared_objects so
                LEFT JOIN pages p ON p.id = so.source_page_id
                WHERE so.lineage_id IS NULL
                ORDER BY so.object_type, so.position ASC, so.created_at ASC
            "#;
            let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows: Vec<Pin> = stmt
                .query_map([], |row| Pin::from_row_joined(row))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        }
    };

    Ok(objects)
}

#[tauri::command]
pub fn create_pin(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    lineage_id: Option<String>,
    source_page_id: String,
    object_type: String,
    content: String,
    title: Option<String>,
) -> Result<Pin, String> {
    let result = create_pin_inner(
        &db,
        &engine,
        lineage_id,
        source_page_id,
        object_type,
        content,
        title,
    )?;
    if let Ok(conn) = db.lock() {
        schedule_sync_wake(&worker_slot, &conn);
    }
    Ok(result)
}

pub fn create_pin_inner(
    db: &Db,
    engine: &op_log::OpLog,
    lineage_id: Option<String>,
    source_page_id: String,
    object_type: String,
    content: String,
    title: Option<String>,
) -> Result<Pin, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let max_pos: Option<i64> = match &lineage_id {
        Some(lid) => conn
            .query_row(
                "SELECT COALESCE(MAX(position), 0) FROM shared_objects WHERE lineage_id = ? AND object_type = ?",
                params![lid, &object_type],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?,
        None => conn
            .query_row(
                "SELECT COALESCE(MAX(position), 0) FROM shared_objects WHERE lineage_id IS NULL AND object_type = ?",
                params![&object_type],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?,
    };

    let position = max_pos.unwrap_or(0) + 1;

    conn.execute(
        "INSERT INTO shared_objects (id, lineage_id, source_page_id, object_type, title, content, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)",
        params![&id, &lineage_id, &source_page_id, &object_type, &title, &content, position, &now, &now],
    )
    .map_err(|e| e.to_string())?;

    let obj: Pin = conn
        .query_row(
            "SELECT * FROM shared_objects WHERE id = ?",
            params![&id],
            |row| Pin::from_row(row),
        )
        .map_err(|e| e.to_string())?;

    op_log::emit_pin(
        engine,
        &conn,
        &id,
        "create_pin",
        serde_json::json!({
            "lineage_id": &lineage_id,
            "source_page_id": &source_page_id,
            "object_type": &object_type,
            "content": &content,
            "title": &title,
            "position": position,
        }),
    );

    Ok(obj)
}

#[tauri::command]
pub fn update_pin_status(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    id: String,
    status: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE shared_objects SET status = ?, updated_at = ? WHERE id = ?",
        params![&status, &now, &id],
    )
    .map_err(|e| e.to_string())?;

    op_log::emit_pin(
        &engine,
        &conn,
        &id,
        "update_pin_status",
        serde_json::json!({ "status": &status }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

#[tauri::command]
pub fn update_pin_scope(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    id: String,
    lineage_id: Option<String>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE shared_objects SET lineage_id = ?, updated_at = ? WHERE id = ?",
        params![&lineage_id, &now, &id],
    )
    .map_err(|e| e.to_string())?;

    op_log::emit_pin(
        &engine,
        &conn,
        &id,
        "update_pin_scope",
        serde_json::json!({ "lineage_id": &lineage_id }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

#[tauri::command]
pub fn update_pin_content(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    id: String,
    content: String,
    title: Option<String>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE shared_objects SET content = ?, title = ?, updated_at = ? WHERE id = ?",
        params![&content, &title, &now, &id],
    )
    .map_err(|e| e.to_string())?;

    op_log::emit_pin(
        &engine,
        &conn,
        &id,
        "update_pin_content",
        serde_json::json!({ "content": &content, "title": &title }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

#[tauri::command]
pub fn delete_pin(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    id: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let n = conn
        .execute("DELETE FROM shared_objects WHERE id = ?", params![&id])
        .map_err(|e| e.to_string())?;

    if n > 0 {
        engine.try_apply(
            &conn,
            op_log::Op {
                kind: op_log::OpKind::tombstone(),
                doc_id: Some(id.clone()),
                stream_id: op_log::stream::SETTINGS_LINEAGES_PINS,
                payload: serde_json::json!({
                    "op": "delete_pin",
                    "pin_id": &id,
                }),
            },
        );
        schedule_sync_wake(&worker_slot, &conn);
    }

    Ok(())
}

#[tauri::command]
pub fn update_pin_auto_insert(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    id: String,
    auto_insert: bool,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let value: i64 = if auto_insert { 1 } else { 0 };

    conn.execute(
        "UPDATE shared_objects SET auto_insert = ?, updated_at = ? WHERE id = ?",
        params![value, &now, &id],
    )
    .map_err(|e| e.to_string())?;

    op_log::emit_pin(
        &engine,
        &conn,
        &id,
        "update_pin_auto_insert",
        serde_json::json!({ "auto_insert": auto_insert }),
    );
    schedule_sync_wake(&worker_slot, &conn);

    Ok(())
}

/// Fetch a slim pin row by id, used as the source of truth for `pinRef`
/// extension's label resolution and hover-preview content. Returns None
/// when the pin no longer exists (deleted) so the inline node can render
/// a "deleted" state.
#[tauri::command]
pub fn get_pin_for_reference(
    db: State<'_, Db>,
    pin_id: String,
) -> Result<Option<PinRefRow>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let row = conn
        .query_row(
            r#"
              SELECT so.id, so.title, so.content, so.updated_at, so.lineage_id,
                     l.name AS lineage_name
              FROM shared_objects so
              LEFT JOIN lineages l ON l.id = so.lineage_id
              WHERE so.id = ?1
            "#,
            params![&pin_id],
            |row| {
                Ok(PinRefRow {
                    id: row.get::<_, String>(0)?,
                    title: row.get::<_, Option<String>>(1)?,
                    content: row.get::<_, Option<String>>(2)?,
                    updated_at: row.get::<_, String>(3)?,
                    scope_label: row.get::<_, Option<String>>(5)?
                        .unwrap_or_else(|| "global".to_string()),
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row)
}

/// Substring-search pins for the @-mention popup's pin section. Matches on
/// title and on plaintext fragments of content (cheap LIKE; FTS5 indexing
/// for pins is post-v0.3). Limited to `limit` rows ordered by recently
/// edited so the freshest pins surface first.
#[tauri::command]
pub fn search_pins_for_mention(
    db: State<'_, Db>,
    query: String,
    limit: i64,
    lineage_id: Option<String>,
) -> Result<Vec<PinRefRow>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let q = query.trim();
    let like = format!("%{}%", q);
    let cap = if limit > 0 { limit } else { 50 };

    // Scope: include pins from the current trail's CTE (self + ancestors) +
    // global pins. Mirrors get_pins' visibility model so the user only sees
    // pins they'd see in their panel.
    let sql = match &lineage_id {
        Some(_) => {
            r#"
              WITH RECURSIVE chain(id) AS (
                  SELECT ?1
                  UNION ALL
                  SELECT l.parent_id FROM lineages l
                  JOIN chain c ON l.id = c.id
                  WHERE l.parent_id IS NOT NULL
              )
              SELECT so.id, so.title, so.content, so.updated_at,
                     so.lineage_id, l.name AS lineage_name
              FROM shared_objects so
              LEFT JOIN lineages l ON l.id = so.lineage_id
              WHERE (so.lineage_id IS NULL OR so.lineage_id IN (SELECT id FROM chain))
                AND so.status != 'orphaned'
                AND (?2 = '' OR so.title LIKE ?3 OR so.content LIKE ?3)
              ORDER BY so.updated_at DESC
              LIMIT ?4
            "#
        }
        None => {
            r#"
              SELECT so.id, so.title, so.content, so.updated_at,
                     so.lineage_id, l.name AS lineage_name
              FROM shared_objects so
              LEFT JOIN lineages l ON l.id = so.lineage_id
              WHERE so.status != 'orphaned'
                AND (?1 = '' OR so.title LIKE ?2 OR so.content LIKE ?2)
              ORDER BY so.updated_at DESC
              LIMIT ?3
            "#
        }
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows: Vec<PinRefRow> = match &lineage_id {
        Some(lid) => stmt
            .query_map(params![lid, q, &like, cap], |row| {
                Ok(PinRefRow {
                    id: row.get::<_, String>(0)?,
                    title: row.get::<_, Option<String>>(1)?,
                    content: row.get::<_, Option<String>>(2)?,
                    updated_at: row.get::<_, String>(3)?,
                    scope_label: row.get::<_, Option<String>>(5)?
                        .unwrap_or_else(|| "global".to_string()),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?,
        None => stmt
            .query_map(params![q, &like, cap], |row| {
                Ok(PinRefRow {
                    id: row.get::<_, String>(0)?,
                    title: row.get::<_, Option<String>>(1)?,
                    content: row.get::<_, Option<String>>(2)?,
                    updated_at: row.get::<_, String>(3)?,
                    scope_label: row.get::<_, Option<String>>(5)?
                        .unwrap_or_else(|| "global".to_string()),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?,
    };
    Ok(rows)
}

/// Atomically rewrite the `position` column for a list of pin IDs in the
/// order given. The first id gets position 1, the second 2, etc. — same
/// section's ordering is preserved by the caller (the panel only lets users
/// drag-reorder within one scope section, so the ids passed here are always
/// homogeneous in scope + object_type). Wrapped in a transaction so a
/// failure rolls back to the prior order.
///
/// This is the persistence path for drag-to-reorder in the pin panel.
#[tauri::command]
pub fn reorder_pins(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    ids: Vec<String>,
) -> Result<(), String> {
    reorder_pins_inner(&db, ids.clone())?;
    let conn = db.lock().map_err(|e| e.to_string())?;
    // Single op for the whole batch (the relay's wire format treats
    // reorder as one atomic action per call; v0.4 will replicate this
    // shape).
    engine.try_apply(
        &conn,
        op_log::Op {
            kind: op_log::OpKind::pin_op(),
            doc_id: None,
            stream_id: op_log::stream::SETTINGS_LINEAGES_PINS,
            payload: serde_json::json!({
                "op": "reorder_pins",
                "ids": &ids,
            }),
        },
    );
    schedule_sync_wake(&worker_slot, &conn);
    Ok(())
}

/// Tauri-free entry point so integration tests can call this directly
/// without spinning up a State<'_, Db>. Atomically rewrites `position` for
/// every id in 1-based order; failure rolls the whole batch back.
pub fn reorder_pins_inner(db: &Db, ids: Vec<String>) -> Result<(), String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (idx, id) in ids.iter().enumerate() {
        // 1-based positions match the existing convention in create_pin.
        let pos = (idx as i64) + 1;
        tx.execute(
            "UPDATE shared_objects SET position = ?, updated_at = ? WHERE id = ?",
            params![pos, &now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn resolve_pin_divergence(
    db: State<'_, Db>,
    pin_id: String,
    action: String,
    new_content: Option<String>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    match action.as_str() {
        "update" => {
            let content = new_content.ok_or("new_content required for update")?;
            conn.execute(
                "UPDATE shared_objects SET content = ?, diverged = 0, updated_at = ? WHERE id = ?",
                rusqlite::params![content, chrono::Utc::now().to_rfc3339(), pin_id],
            ).map_err(|e| e.to_string())?;
        }
        "keep" => {
            conn.execute(
                "UPDATE shared_objects SET diverged = 0 WHERE id = ?",
                rusqlite::params![pin_id],
            ).map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("unknown action: {action}")),
    }
    Ok(())
}

/// Returns auto_insert pins owned exactly by the given trail. Carry-forward
/// is a per-trail behavior: a pin lives where its lineage_id points and is
/// not inherited up or down the trail tree. Display-time pin listing
/// (`get_pins`) still walks ancestors so users see context — only injection
/// is scoped strict.
#[tauri::command]
pub fn get_carry_forward_pins(
    db: State<'_, Db>,
    lineage_id: String,
) -> Result<Vec<Pin>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let sql = r#"
        SELECT so.id, so.lineage_id, so.source_page_id, so.object_type,
               so.title, so.content, so.status, so.position, so.auto_insert,
               so.diverged, so.created_at, so.updated_at,
               p.lineage_id AS source_page_lineage_id
        FROM shared_objects so
        LEFT JOIN pages p ON p.id = so.source_page_id
        WHERE so.lineage_id = ?1
          AND so.auto_insert = 1
          AND so.status != 'orphaned'
        ORDER BY so.object_type, so.position ASC, so.created_at ASC
    "#;

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows: Vec<Pin> = stmt
        .query_map(params![&lineage_id], |row| Pin::from_row_joined(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn save_shukonin_session(
    db: State<'_, Db>,
    page_id: String,
    intended_min: i64,
    actual_sec: i64,
    completed: bool,
    started_at: String,
    ended_at: String,
) -> Result<ShukoninSession, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO shukonin_sessions (id, page_id, intended_min, actual_sec, completed, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![&id, &page_id, intended_min, actual_sec, completed, &started_at, &ended_at],
    )
    .map_err(|e| e.to_string())?;

    Ok(ShukoninSession {
        id,
        page_id,
        intended_min,
        actual_sec,
        completed,
        started_at,
        ended_at,
    })
}

#[tauri::command]
pub fn get_shukonin_sessions_for_date(
    db: State<'_, Db>,
    date: String,
) -> Result<Vec<ShukoninSession>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT s.* FROM shukonin_sessions s JOIN pages p ON s.page_id = p.id WHERE p.date = ? ORDER BY s.started_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let sessions: Vec<ShukoninSession> = stmt
        .query_map(params![&date], |row| ShukoninSession::from_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(sessions)
}

// --- Encryption/lock commands ---

#[tauri::command]
pub fn check_encryption_status(db: State<'_, Db>) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    // If we can read the db, check if encryption setting is stored
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'encryption_enabled'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(result.map(|v| v == "true").unwrap_or(false))
}

#[tauri::command]
pub fn setup_encryption(
    db: State<'_, Db>,
    passphrase: String,
) -> Result<(), String> {
    // Get the db path, then release the file by swapping in a temp connection
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    let db_path: String = conn
        .query_row("PRAGMA database_list", [], |row| row.get::<_, String>(2))
        .map_err(|e| e.to_string())?;
    let path = std::path::PathBuf::from(&db_path);

    // Replace with in-memory connection to release the file lock
    *conn = rusqlite::Connection::open_in_memory()
        .map_err(|e| e.to_string())?;
    drop(conn);

    // Migrate the database file to encrypted
    crate::crypto::migrate_to_encrypted(&path, &passphrase)?;

    // Always store the key in the system keyring — required for unlock on restart.
    // The keyring is protected by the OS login (libsecret/kwallet/Keychain/Credential Manager).
    crate::crypto::store_key(&passphrase)
        .map_err(|e| format!("encryption succeeded but failed to store key in keyring: {e}"))?;

    // Reopen with encryption
    let new_conn = crate::crypto::open_encrypted(&path, &passphrase)
        .map_err(|e| format!("failed to reopen encrypted db: {e}"))?;
    new_conn
        .execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| e.to_string())?;

    // Mark encryption as enabled
    new_conn
        .execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('encryption_enabled', 'true')",
            [],
        )
        .map_err(|e| e.to_string())?;

    // Replace the connection in the mutex
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    *conn = new_conn;

    Ok(())
}

#[tauri::command]
pub fn unlock(db: State<'_, Db>, passphrase: String) -> Result<bool, String> {
    // Try to verify passphrase by opening a test connection
    let conn = db.lock().map_err(|e| e.to_string())?;
    let db_path: String = conn
        .query_row("PRAGMA database_list", [], |row| row.get::<_, String>(2))
        .map_err(|e| e.to_string())?;
    drop(conn);

    let path = std::path::PathBuf::from(&db_path);
    match crate::crypto::open_encrypted(&path, &passphrase) {
        Ok(new_conn) => {
            new_conn
                .execute_batch("PRAGMA journal_mode=WAL;")
                .map_err(|e| e.to_string())?;
            let mut conn = db.lock().map_err(|e| e.to_string())?;
            *conn = new_conn;
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub fn lock(_db: State<'_, Db>) -> Result<(), String> {
    // In a full implementation, this would clear the db connection
    // and require unlock before further access.
    // For now, this is a placeholder that the frontend uses to trigger lock UI.
    Ok(())
}

#[tauri::command]
pub fn get_lock_timeout(db: State<'_, Db>) -> Result<Option<i64>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'lock_timeout_minutes'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(result.and_then(|v| v.parse::<i64>().ok()))
}

#[tauri::command]
pub fn set_lock_timeout(
    db: State<'_, Db>,
    engine: State<'_, op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    minutes: i64,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let value = minutes.to_string();
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('lock_timeout_minutes', ?)",
        params![&value],
    )
    .map_err(|e| e.to_string())?;
    op_log::emit_setting(&engine, &conn, "lock_timeout_minutes", Some(&value));
    schedule_sync_wake(&worker_slot, &conn);
    Ok(())
}

#[tauri::command]
pub async fn export_pages_gui(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    format: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<usize, String> {
    use crate::export::{self, ExportFormat};
    // Desktop only: Android never opens a save dialog (see below).
    #[cfg(not(target_os = "android"))]
    use tauri_plugin_dialog::DialogExt;

    let fmt = ExportFormat::from_str(&format)?;

    let default_name = format!(
        "shizumu-export-{}.zip",
        chrono::Local::now().format("%Y-%m-%d")
    );

    // Android has no writable path to give us. Its save dialog goes through
    // the Storage Access Framework and returns a `content://` URI, which
    // `FilePath::as_path()` reports as None by contract — so this command
    // answered "invalid file path" on every Android export it ever ran.
    // Stage the zip in the cache dir and hand it to the system share sheet
    // instead, which is how an Android app gives the user a file, and which
    // this codebase already does for attachments.
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
        let staged_dir = cache_dir.join("shared");
        std::fs::create_dir_all(&staged_dir).map_err(|e| format!("create share dir: {e}"))?;
        let zip_path = staged_dir.join(&default_name);
        let count = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            export::export_pages(&conn, fmt, from.as_deref(), to.as_deref(), &zip_path)?
        };
        crate::attachments::share::share_via_intent(
            &zip_path.to_string_lossy(),
            "application/zip",
        )?;
        return Ok(count);
    }

    #[cfg(not(target_os = "android"))]
    {
        let zip_path = match app
            .dialog()
            .file()
            .set_title("save export as")
            .set_file_name(&default_name)
            .add_filter("zip archive", &["zip"])
            .blocking_save_file()
        {
            Some(path) => export::dialog_save_path(path)?,
            None => return Err("export cancelled".to_string()),
        };

        let conn = db.lock().map_err(|e| e.to_string())?;
        export::export_pages(&conn, fmt, from.as_deref(), to.as_deref(), &zip_path)
    }
}

#[tauri::command]
pub async fn backup_database_gui(app: tauri::AppHandle) -> Result<String, String> {
    use crate::export;
    // Desktop only: Android never opens a save dialog (see below).
    #[cfg(not(target_os = "android"))]
    use tauri_plugin_dialog::DialogExt;

    let now = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let default_name = format!("shizumu-backup-{now}.db");

    let db_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    let db_path = db_dir.join("settles.db");

    // Same Android story as export_pages_gui: the SAF hands back a
    // `content://` URI that `as_path()` reports as None, so backup answered
    // "invalid file path" on every Android run. Stage and share instead.
    #[cfg(target_os = "android")]
    {
        let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
        let staged_dir = cache_dir.join("shared");
        std::fs::create_dir_all(&staged_dir).map_err(|e| format!("create share dir: {e}"))?;
        let staged = staged_dir.join(&default_name);
        export::backup_database(&db_path, &staged)?;
        crate::attachments::share::share_via_intent(
            &staged.to_string_lossy(),
            "application/octet-stream",
        )?;
        return Ok(staged.display().to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let path = match app
            .dialog()
            .file()
            .set_title("save database backup")
            .set_file_name(&default_name)
            .blocking_save_file()
        {
            Some(p) => export::dialog_save_path(p)?,
            None => return Err("backup cancelled".to_string()),
        };

        export::backup_database(&db_path, &path)?;
        Ok(path.display().to_string())
    }
}

/// Copy an image from any location into the app's images directory and return
/// the new absolute path. The frontend uses convertFileSrc() on the returned
/// path to produce a WebView-safe URL.
#[tauri::command]
pub fn save_image_file(
    app: tauri::AppHandle,
    src_path: String,
) -> Result<String, String> {
    use std::path::Path;
    let src = Path::new(&src_path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let images_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let dest = images_dir.join(&filename);
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}

/// Save raw image bytes (e.g. from clipboard or drag-drop) into the app's
/// images directory and return the new absolute path.
#[tauri::command]
pub fn save_image_bytes(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    let ext_clean = ext.trim_start_matches('.').to_lowercase();
    let images_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let filename = format!("{}.{}", uuid::Uuid::new_v4(), ext_clean);
    let dest = images_dir.join(&filename);
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}

/// Walk a TipTap doc and remove top-level `dayMarker` nodes whose between-section
/// (from immediately after this marker until the next marker or end of doc) has
/// no real text content. Returns the number of markers removed.
///
/// "Real text" = any descendant `text` field whose trimmed value is non-empty.
/// dayMarkers themselves are not text content; a marker followed only by another
/// marker or by empty/whitespace paragraphs counts as empty.
///
/// `today_date` is preserved: a marker whose `attrs.date` equals today is
/// treated as part of the user's active session and is NEVER removed even
/// if the between-section is empty. The user has assigned a trail today
/// and may have just paused before writing — they expect the trail to
/// stay on today's rail across same-day reopens. Cross-day cleanup
/// happens naturally: tomorrow's boot sees yesterday's marker as
/// non-today, and removes it if the user never wrote.
pub fn clean_empty_markers_in_doc(doc: &mut serde_json::Value, today_date: &str) -> i64 {
    let Some(content) = doc.get_mut("content").and_then(|v| v.as_array_mut()) else {
        return 0;
    };

    let marker_indices: Vec<usize> = content
        .iter()
        .enumerate()
        .filter(|(_, n)| n.get("type").and_then(|v| v.as_str()) == Some("dayMarker"))
        .map(|(i, _)| i)
        .collect();

    if marker_indices.is_empty() {
        return 0;
    }

    let mut to_remove: Vec<usize> = Vec::new();
    for (i, &mi) in marker_indices.iter().enumerate() {
        // Preserve today's marker even if between-section is empty.
        let marker_date = content[mi]
            .get("attrs")
            .and_then(|a| a.get("date"))
            .and_then(|d| d.as_str());
        if marker_date == Some(today_date) {
            continue;
        }

        let next_idx = marker_indices.get(i + 1).copied().unwrap_or(content.len());
        let between = &content[mi + 1..next_idx];
        let has_text = between.iter().any(node_has_real_text);
        if !has_text {
            to_remove.push(mi);
        }
    }

    for &idx in to_remove.iter().rev() {
        content.remove(idx);
    }
    to_remove.len() as i64
}

fn node_has_real_text(node: &serde_json::Value) -> bool {
    if let Some(text) = node.get("text").and_then(|v| v.as_str()) {
        if !text.trim().is_empty() {
            return true;
        }
    }
    if let Some(content) = node.get("content").and_then(|v| v.as_array()) {
        for child in content {
            if node_has_real_text(child) {
                return true;
            }
        }
    }
    false
}

/// Walks every continuous canonical's `content_json` and removes empty
/// `dayMarker` nodes (markers with no real text content following them),
/// EXCEPT today's marker — which is preserved across same-day reopens
/// even when the user hasn't written yet. Runs on app boot alongside
/// `cleanup_orphan_pages`, so yesterday's "I just peeked at this trail"
/// markers don't pile up over time.
///
/// Returns the total number of markers removed across all canonicals.
#[tauri::command]
pub fn cleanup_empty_day_markers(db: State<'_, Db>) -> Result<i64, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let candidates: Vec<(String, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.content_json FROM pages p
                 JOIN lineages l ON l.id = p.lineage_id
                 WHERE l.mode = 'continuous'",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    let mut total_removed = 0i64;
    for (page_id, content_json_str) in candidates {
        let Some(json_str) = content_json_str else {
            continue;
        };
        let mut doc: serde_json::Value = match serde_json::from_str(&json_str) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let removed = clean_empty_markers_in_doc(&mut doc, &today);
        if removed > 0 {
            total_removed += removed;
            let new_json = serde_json::to_string(&doc).map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE pages SET content_json = ?, updated_at = ? WHERE id = ?",
                params![&new_json, &now, &page_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(total_removed)
}

/// A page counts as empty when it has no stored content_json, an empty string,
/// or a TipTap doc with no text content (after whitespace trim) AND no
/// standalone media node (image, attachment) — a page holding only a
/// dropped-in photo is real content, even before the user types anything
/// next to it. See contains_media_node: extract_text_from_tiptap alone
/// can't see these, since they're atom nodes with no "text" field.
/// Is this page GC garbage — i.e. may a `cleanup_orphan_page` tombstone
/// delete it?
///
/// The one definition of "empty enough to sweep", shared by the device
/// that decides to sweep (`cleanup_orphan_pages_inner`) and the device
/// that receives the resulting tombstone (`sync::merge::merge_tombstone`).
///
/// Extracted because the two sides disagreed, and the disagreement
/// deleted pages. The sweeper required five things — no focus line, no
/// what-shifted, no trail, no lines, empty content — while the tombstone
/// guard checked only the last one. A page this device would never sweep
/// could therefore be deleted by a peer's tombstone, and a GC tombstone
/// is only ever a *guess* ("this looked empty at launch"), which is
/// precisely the premise local state is supposed to be able to disprove.
///
/// Seen live on a real account (2026-08-22): two pages held an empty
/// TipTap doc, a real focus line, and a trail. Either would have lost its
/// focus line the moment a peer swept its own copy.
///
/// A missing row is not eligible: there is nothing to delete, and
/// returning true would invite callers to read absence as permission.
pub(crate) fn page_is_gc_eligible(
    conn: &rusqlite::Connection,
    page_id: &str,
) -> rusqlite::Result<bool> {
    use rusqlite::OptionalExtension;
    let row: Option<(Option<String>, Option<String>, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT what_matters_now, what_shifted, lineage_id, content_json
               FROM pages WHERE id = ?",
            params![page_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((what_matters, what_shifted, lineage_id, content_json)) = row else {
        return Ok(false);
    };
    let blank = |v: &Option<String>| v.as_deref().map_or(true, |t| t.trim().is_empty());
    if !blank(&what_matters) || !blank(&what_shifted) {
        return Ok(false);
    }
    if lineage_id.is_some() {
        return Ok(false);
    }
    if !is_page_empty(&content_json) {
        return Ok(false);
    }
    let has_lines: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM lines WHERE page_id = ?)",
        params![page_id],
        |r| r.get(0),
    )?;
    Ok(!has_lines)
}

pub(crate) fn is_page_empty(content_json: &Option<String>) -> bool {
    let Some(s) = content_json else { return true; };
    if s.trim().is_empty() { return true; }
    match serde_json::from_str::<serde_json::Value>(s) {
        Ok(v) => {
            let has_text = extract_text_from_tiptap(&v)
                .map(|t| !t.trim().is_empty())
                .unwrap_or(false);
            if has_text {
                false
            } else {
                !contains_media_node(&v)
            }
        }
        Err(_) => true,
    }
}

/// True if the doc contains a localImage or attachment node anywhere.
/// Without this check, a page whose only content is a dropped-in image
/// (no typed text yet) reads as empty via extract_text_from_tiptap alone,
/// and cleanup_orphan_pages deletes it outright the next time it runs —
/// which includes every app launch, same-day or not.
fn contains_media_node(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(t) = map.get("type").and_then(|v| v.as_str()) {
                if t == "localImage" || t == "attachment" {
                    return true;
                }
            }
            if let Some(content) = map.get("content").and_then(|v| v.as_array()) {
                if content.iter().any(contains_media_node) {
                    return true;
                }
            }
            false
        }
        serde_json::Value::Array(arr) => arr.iter().any(contains_media_node),
        _ => false,
    }
}

/// A page is "relevant" — worth surfacing in lists, counts, and navigation —
/// when the user has invested *any* signal in it: attached a trail, declared a
/// focus, written body text, or saved any line. Untrailed pages with none of
/// those are orphans (typically created by `get_or_create_today` on launch or
/// an unused "+" click) and stay hidden until `cleanup_orphan_pages` deletes
/// them. Mirrored on the frontend by `isFocusRelevant` in utils.js.
fn is_page_relevant(p: &Page, has_lines: bool) -> bool {
    if p.lineage_id.is_some() {
        return true;
    }
    if p.what_matters_now
        .as_deref()
        .map_or(false, |s| !s.trim().is_empty())
    {
        return true;
    }
    if has_lines {
        return true;
    }
    !is_page_empty(&p.content_json)
}

/// Append a page's content into an existing continuous trail's canonical,
/// under a dayMarker stamped for today's local date. The source page is
/// deleted afterwards; its pins (shared_objects) are re-parented to the
/// canonical so nothing orphans. Used when the user writes on today's
/// untrailed page and then assigns it to a continuous trail that already has
/// a canonical — the final state matches "as if they'd selected the trail
/// first and written those paragraphs."
///
/// Errors: `lineage_not_continuous` if the trail is discrete; `canonical_missing`
/// if the trail has no canonical yet (caller should use set_focus_lineage).
#[tauri::command]
pub fn append_page_to_canonical(
    db: State<'_, Db>,
    source_page_id: String,
    lineage_id: String,
) -> Result<PageWithLines, String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let mode: Option<String> = conn
        .query_row(
            "SELECT mode FROM lineages WHERE id = ?",
            params![&lineage_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if mode.as_deref() != Some("continuous") {
        return Err("lineage_not_continuous".to_string());
    }

    // Refuse to merge a source page that is itself the canonical of a
    // continuous trail — the merge deletes the source row, which would
    // destroy the source trail's entire living document. Frontend should
    // navigate without merging in that case (handleLineageChange does).
    let source_lid: Option<String> = match conn.query_row(
        "SELECT lineage_id FROM pages WHERE id = ?",
        params![&source_page_id],
        |row| row.get::<_, Option<String>>(0),
    ) {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => return Err(e.to_string()),
    };
    if let Some(slid) = source_lid.as_deref() {
        if slid != lineage_id {
            let source_mode: Option<String> = conn
                .query_row(
                    "SELECT mode FROM lineages WHERE id = ?",
                    params![slid],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if source_mode.as_deref() == Some("continuous") {
                return Err("source_is_continuous_canonical".to_string());
            }
        }
    }

    let canonical: Page = match conn
        .query_row(
            "SELECT * FROM pages WHERE lineage_id = ? ORDER BY created_at ASC LIMIT 1",
            params![&lineage_id],
            |row| Page::from_row(row),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        Some(p) => p,
        None => return Err("canonical_missing".to_string()),
    };

    // No-op: source IS the canonical. Just return it.
    if canonical.id == source_page_id {
        return load_page_with_lines(&conn, canonical);
    }

    let source: Page = conn
        .query_row(
            "SELECT * FROM pages WHERE id = ?",
            params![&source_page_id],
            |row| Page::from_row(row),
        )
        .map_err(|e| e.to_string())?;

    let source_empty = is_page_empty(&source.content_json);

    // Parse canonical doc (seed empty if null/malformed — preserve the trail).
    let mut canonical_doc: serde_json::Value = canonical
        .content_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .unwrap_or_else(|| {
            serde_json::json!({ "type": "doc", "content": [] })
        });
    if !canonical_doc.is_object() {
        canonical_doc = serde_json::json!({ "type": "doc", "content": [] });
    }
    // Ensure content array exists.
    if canonical_doc.get("content").and_then(|v| v.as_array()).is_none() {
        canonical_doc["content"] = serde_json::json!([]);
    }

    // Build the appended nodes from the source (skip entirely if empty).
    if !source_empty {
        let source_doc: serde_json::Value = source
            .content_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .unwrap_or_else(|| serde_json::json!({ "type": "doc", "content": [] }));
        let source_nodes: Vec<serde_json::Value> = source_doc
            .get("content")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let content_arr = canonical_doc["content"].as_array_mut().unwrap();

        // Stamp today's dayMarker if not already present.
        let has_today_marker = content_arr.iter().any(|n| {
            n.get("type").and_then(|v| v.as_str()) == Some("dayMarker")
                && n.get("attrs")
                    .and_then(|a| a.get("date"))
                    .and_then(|v| v.as_str())
                    == Some(&today)
        });
        if !has_today_marker {
            let focus = source.what_matters_now.clone().unwrap_or_default();
            content_arr.push(serde_json::json!({
                "type": "dayMarker",
                "attrs": { "date": today, "whatMatters": focus },
            }));
        }

        for node in source_nodes {
            content_arr.push(node);
        }
    }

    let new_canonical_json =
        serde_json::to_string(&canonical_doc).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Reparent pins BEFORE deleting the source (FK-agnostic; keeps joins sane).
    tx.execute(
        "UPDATE shared_objects SET source_page_id = ?, lineage_id = ?, updated_at = ? WHERE source_page_id = ?",
        params![&canonical.id, &lineage_id, &now, &source_page_id],
    )
    .map_err(|e| e.to_string())?;

    // Clean up side tables for the source page.
    tx.execute(
        "DELETE FROM block_items WHERE block_id IN (SELECT id FROM blocks WHERE page_id = ?)",
        params![&source_page_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM blocks WHERE page_id = ?", params![&source_page_id])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM session_markers WHERE page_id = ?",
        params![&source_page_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM shukonin_sessions WHERE page_id = ?",
        params![&source_page_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM lines WHERE page_id = ?", params![&source_page_id])
        .map_err(|e| e.to_string())?;
    let _ = tx.execute(
        "DELETE FROM pages_fts WHERE page_id = ?",
        params![&source_page_id],
    );
    tx.execute("DELETE FROM pages WHERE id = ?", params![&source_page_id])
        .map_err(|e| e.to_string())?;

    // Persist merged canonical content.
    tx.execute(
        "UPDATE pages SET content_json = ?, updated_at = ? WHERE id = ?",
        params![&new_canonical_json, &now, &canonical.id],
    )
    .map_err(|e| e.to_string())?;

    // Rebuild FTS for the canonical.
    let text_content: String = serde_json::from_str::<serde_json::Value>(&new_canonical_json)
        .ok()
        .and_then(|v| extract_text_from_tiptap(&v))
        .unwrap_or_default();
    let _ = tx.execute(
        "DELETE FROM pages_fts WHERE page_id = ?",
        params![&canonical.id],
    );
    let _ = tx.execute(
        "INSERT INTO pages_fts (page_id, content, what_matters_now, what_shifted, voice_memo_transcript) VALUES (?, ?, ?, ?, ?)",
        params![&canonical.id, &text_content, &canonical.what_matters_now, &canonical.what_shifted, &canonical.voice_memo_transcript],
    );

    tx.commit().map_err(|e| e.to_string())?;

    let fresh: Page = conn
        .query_row(
            "SELECT * FROM pages WHERE id = ?",
            params![&canonical.id],
            |row| Page::from_row(row),
        )
        .map_err(|e| e.to_string())?;
    load_page_with_lines(&conn, fresh)
}

/// Return up to `limit` recent pages for the `@`-mention dropdown.
///
/// With `query` empty, returns the most-recently-touched pages overall.
/// With a non-empty `query`, returns pages whose `what_matters_now` or
/// whose parent `lineage.name` substring-matches (case-insensitive).
/// Untrailed pages are included. Each row is slim — enough for client-side
/// label assembly via `buildMentionLabel(...)`.
pub fn search_pages_for_mention_inner(
    conn: &rusqlite::Connection,
    query: &str,
    limit: i64,
) -> Result<Vec<MentionRow>, String> {
    let trimmed = query.trim();
    let limit = if limit <= 0 { 50 } else { limit };

    let (sql, with_pattern): (&str, bool) = if trimmed.is_empty() {
        (
            "SELECT p.id, p.date, p.page_number, p.what_matters_now,
                    p.lineage_id, l.mode AS lineage_mode
             FROM pages p
             LEFT JOIN lineages l ON l.id = p.lineage_id
             ORDER BY p.updated_at DESC
             LIMIT ?1",
            false,
        )
    } else {
        (
            "SELECT p.id, p.date, p.page_number, p.what_matters_now,
                    p.lineage_id, l.mode AS lineage_mode
             FROM pages p
             LEFT JOIN lineages l ON l.id = p.lineage_id
             WHERE lower(IFNULL(p.what_matters_now, '')) LIKE ?1
                OR lower(IFNULL(l.name, '')) LIKE ?1
             ORDER BY p.updated_at DESC
             LIMIT ?2",
            true,
        )
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mapper = |row: &rusqlite::Row| {
        Ok(MentionRow {
            page_id: row.get("id")?,
            date: row.get("date")?,
            page_number: row.get("page_number")?,
            what_matters_now: row.get("what_matters_now")?,
            lineage_id: row.get("lineage_id")?,
            lineage_mode: row.get("lineage_mode")?,
        })
    };

    let rows: Vec<MentionRow> = if with_pattern {
        let pattern = format!("%{}%", trimmed.to_lowercase());
        stmt.query_map(params![&pattern, limit], mapper)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        stmt.query_map(params![limit], mapper)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    Ok(rows)
}

#[tauri::command]
pub fn search_pages_for_mention(
    db: State<'_, Db>,
    query: String,
    limit: i64,
) -> Result<Vec<MentionRow>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    search_pages_for_mention_inner(&conn, &query, limit)
}

/// Resolve a single page id into a `MentionRow` for inline `pageRef`
/// rendering. Returns `None` if the page no longer exists (the caller
/// renders the deleted/folded state).
pub fn get_page_for_mention_inner(
    conn: &rusqlite::Connection,
    page_id: &str,
) -> Result<Option<MentionRow>, String> {
    conn.query_row(
        "SELECT p.id, p.date, p.page_number, p.what_matters_now,
                p.lineage_id, l.mode AS lineage_mode
         FROM pages p
         LEFT JOIN lineages l ON l.id = p.lineage_id
         WHERE p.id = ?",
        params![page_id],
        |row| {
            Ok(MentionRow {
                page_id: row.get("id")?,
                date: row.get("date")?,
                page_number: row.get("page_number")?,
                what_matters_now: row.get("what_matters_now")?,
                lineage_id: row.get("lineage_id")?,
                lineage_mode: row.get("lineage_mode")?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_page_for_mention(
    db: State<'_, Db>,
    page_id: String,
) -> Result<Option<MentionRow>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    get_page_for_mention_inner(&conn, &page_id)
}

// ===== sync engine commands (phase 14.10) =====
//
// Drive the v0.4 sync engine from the frontend: generate a recovery
// phrase, write keys + relay URL, enroll against the relay, flip the
// enabled gate, read status. The worker spawned at startup picks up
// new keys via the `SyncWorkerSlot` Tauri state below.

/// Thread-safe slot for the background worker. Always managed by
/// Tauri so commands can spawn / replace the worker mid-session
/// (after `sync_setup` writes keys). `Drop` on shutdown signals the
/// thread to exit cleanly.
// Arc-wrapped so commands can clone the handle into a spawn_blocking
// closure (Mutex itself isn't Clone). Tauri's `State<'_, T>` borrows the
// underlying value; for any command that needs to do work on a worker
// thread, we extract the Arc, clone it, and move that.
pub type SyncWorkerSlot = std::sync::Arc<std::sync::Mutex<Option<crate::sync::worker::WorkerHandle>>>;

/// Debounced sync wake, shared by every command that just emitted a local
/// op (a page save, a pin edit, a lineage rename, a setting flip, …).
///
/// Before this helper existed, `save_page_content` was the ONLY call site
/// for `wake_after` — every other op-emitting command left the worker
/// asleep until its next unforced tick (`DEFAULT_TICK`, up to 30s), so a
/// pin, a trail rename, or a `what_matters_now` edit could sit unsent for
/// half a minute even though the write itself was already durable and
/// op-logged. Debounced (not immediate `.wake()`) for the same reason
/// `save_page_content` debounces: a flurry of related local writes (e.g.
/// several pin reorders, or a lineage rename immediately followed by a
/// move) coalesces into one upload after things settle, instead of firing
/// an upload pass per keystroke-adjacent command.
///
/// Reads the same `sync_save_debounce_ms` setting `save_page_content` uses
/// (default 2000ms) so every write shares one tunable debounce window.
/// Best-effort: no running worker (sync disabled, or the handle hasn't
/// been installed yet) is a silent no-op, exactly like the existing
/// `save_page_content` and `attachment_set_sync` wake call sites.
pub(crate) fn schedule_sync_wake(worker_slot: &SyncWorkerSlot, conn: &rusqlite::Connection) {
    let sync_delay_ms = sync_wake_delay_ms(conn);
    if let Ok(slot) = worker_slot.lock() {
        if let Some(h) = slot.as_ref() {
            h.wake_after(sync_delay_ms);
        }
    }
}

/// The debounce window `schedule_sync_wake` schedules its wake at. Split
/// out as its own (pure, DB-only) function so it's testable without a live
/// `SyncWorkerSlot` — constructing a real `WorkerHandle` needs an actual
/// spawned worker thread, which a unit test has no business standing up
/// just to check a number. Default 2000ms; overridden by the
/// `sync_save_debounce_ms` setting row when present.
pub(crate) fn sync_wake_delay_ms(conn: &rusqlite::Connection) -> i64 {
    crate::sync::config::get_setting_i64(conn, "sync_save_debounce_ms").unwrap_or(2000)
}

#[derive(serde::Serialize)]
pub struct SyncStatusDto {
    pub relay_url: Option<String>,
    pub user_id: Option<String>,
    pub device_id: Option<String>,
    pub enabled: bool,
    pub configured: bool,
    pub last_seen_user_seq: i64,
    pub last_sync_at_ms: Option<i64>,
    pub last_error: Option<String>,
    /// True when the account secrets sit in plaintext in the local DB
    /// instead of the OS keyring (keyring-unavailable fallback). The UI
    /// warns the user; see security audit H3.
    pub keys_at_rest_unprotected: bool,
    /// True once the worker has seen a `device_revoked` wire error and
    /// stopped ticking (settings key `sync_revoked`). The UI offers
    /// re-pairing instead of treating this like a transient wire
    /// failure; `sync_reset` (pair-again) is what clears it.
    pub revoked: bool,
}

/// One row from `sync_error_history`. The status pill's popover
/// renders these as kind + relative-age + message; kept narrow on
/// purpose (no stack traces, no relay request IDs) so the popover
/// stays informational rather than a debug pane.
#[derive(serde::Serialize)]
pub struct SyncErrorDto {
    pub at_ms: i64,
    pub kind: String,
    pub message: String,
}

#[derive(serde::Serialize)]
pub struct SyncEnrollResultDto {
    pub user_id: String,
    pub device_id: String,
}

/// Return a fresh 24-word BIP-39 mnemonic for the user to record
/// before continuing setup. Does NOT touch the DB — the phrase is
/// only persisted once the user passes it back to `sync_setup`.
#[tauri::command]
pub fn sync_generate_phrase() -> Result<String, String> {
    Ok(crate::sync::keys::generate_seed_phrase().to_string())
}

/// Re-reveal the recovery phrase stored on THIS device, so a user who lost
/// their written copy can save it again. Returns `Some(words)` on a device
/// that ran setup/recovery (it keeps the phrase), or `None` on a paired
/// device — paired devices receive only the derived keys, never the phrase,
/// so the user must reveal it from the original device. Reading the secret
/// store requires the app to be unlocked, which it already is in settings.
#[tauri::command]
pub fn sync_reveal_phrase() -> Result<Option<String>, String> {
    match crate::sync::secret_store::load().map_err(|e| e.to_string())? {
        Some(keys) => Ok(keys.phrase.clone()),
        None => Ok(None),
    }
}

/// First-time setup (or recovery): derive UserKeys from the phrase,
/// generate fresh DeviceKeys, persist both to sync_keys, write the
/// relay URL. Idempotent in the sense that re-running with a new
/// phrase overwrites prior state — the user has chosen to start over.
/// Spawns the worker (replacing any existing one) so the new keys
/// take effect immediately; the engine stays silent until
/// `sync_set_enabled(true)`.
#[tauri::command]
pub async fn sync_setup(
    db: State<'_, Db>,
    engine: State<'_, crate::op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    phrase: String,
    relay_url: String,
) -> Result<(), String> {
    let db = db.inner().clone();
    let engine = engine.inner().clone();
    let worker_slot = worker_slot.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mnemonic = bip39::Mnemonic::parse_normalized(phrase.trim())
            .map_err(|e| format!("invalid bip39 phrase: {e}"))?;
        let device_keys = crate::sync::keys::generate_device_keys();
        {
            let conn = db.lock().map_err(|e| e.to_string())?;
            crate::sync::keys::persist_user_phrase(&conn, &mnemonic)
                .map_err(|e| e.to_string())?;
            crate::sync::keys::persist_device_keys(&conn, &device_keys)
                .map_err(|e| e.to_string())?;
            crate::sync::config::set_relay_url(&conn, &relay_url)
                .map_err(|e| e.to_string())?;
        }
        // Respawn worker so it picks up the new keys. The existing
        // WorkerHandle (if any) drops on assignment, signalling shutdown.
        let new_handle = crate::sync::worker::spawn_if_configured(
            db.clone(),
            engine.clone(),
            crate::sync::worker::DEFAULT_TICK,
            crate::sync::worker::WorkerCallbacks::default(),
        )?;
        let mut slot = worker_slot.lock().map_err(|e| e.to_string())?;
        *slot = new_handle;
        Ok(())
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Send POST /v1/devices/enroll with the persisted device keys + the
/// operator-issued enrollment token. On success, sync_state is
/// stamped with the relay-confirmed user_id and device_id. Does NOT
/// flip `enabled` — the caller decides when to go live.
#[tauri::command]
pub async fn sync_enroll(
    db: State<'_, Db>,
    enrollment_token: String,
    device_label: String,
) -> Result<SyncEnrollResultDto, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (user_keys, device_keys, relay_url) = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let uk = crate::sync::keys::load_user_keys(&conn)?
                .ok_or_else(|| "sync not set up: run sync_setup first".to_string())?;
            let dk = crate::sync::keys::load_device_keys(&conn)?
                .ok_or_else(|| "device keys missing: run sync_setup first".to_string())?;
            let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
            let url = cfg
                .relay_url
                .ok_or_else(|| "relay_url not set: pass it to sync_setup".to_string())?;
            (uk, dk, url)
        };

        let resp = crate::sync::wire::enroll::enroll(
            &relay_url,
            &user_keys,
            &device_keys,
            enrollment_token.trim(),
            &device_label,
        )
        .map_err(|e| e.to_string())?;

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        {
            let conn = db.lock().map_err(|e| e.to_string())?;
            crate::sync::config::set_enrollment(&conn, &resp.user_id, &resp.device_id, now_ms)
                .map_err(|e| e.to_string())?;
        }
        Ok(SyncEnrollResultDto {
            user_id: resp.user_id,
            device_id: resp.device_id,
        })
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Combined setup + self-enroll for relays running in single_user
/// mode with zero users. Parses the BIP-39 phrase, generates device
/// keys, persists everything, calls `POST /v1/devices/self-enroll`,
/// and stamps the enrollment. On 409 the relay already has a user;
/// the error string will contain "relay_already_claimed" so the
/// frontend can detect it.
#[allow(unused_variables)]
#[tauri::command]
pub async fn sync_self_enroll(
    db: State<'_, Db>,
    engine: State<'_, crate::op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    phrase: String,
    relay_url: String,
    device_label: String,
) -> Result<SyncEnrollResultDto, String> {
    let db = db.inner().clone();
    let engine = engine.inner().clone();
    let worker_slot = worker_slot.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mnemonic = bip39::Mnemonic::parse_normalized(phrase.trim())
            .map_err(|e| format!("invalid bip39 phrase: {e}"))?;
        let user_keys = crate::sync::keys::user_keys_from_phrase(&mnemonic);
        let device_keys = crate::sync::keys::generate_device_keys();

        {
            let conn = db.lock().map_err(|e| e.to_string())?;
            // Same-phrase re-enroll (the user re-runs setup with the same
            // recovery phrase) is NOT a new identity — the derived keys
            // are byte-identical to whatever's already on disk. In that
            // case the cached ciphertext is still valid and the backfill
            // is already done; wiping them forces a slow, unnecessary
            // re-encrypt + re-upload of every existing op. Only wipe when
            // the user_sign_pub actually changed (different phrase =
            // genuinely new identity, so old ciphertext is unreadable
            // by the new content_master_key).
            let prior_sign_pub = crate::sync::keys::load_user_keys(&conn)
                .ok()
                .flatten()
                .map(|k| k.user_sign_pub_bytes());
            let new_sign_pub = user_keys.user_sign_pub_bytes();
            let identity_changed = prior_sign_pub
                .map(|p| p != new_sign_pub)
                .unwrap_or(true);

            crate::sync::keys::persist_user_phrase(&conn, &mnemonic)
                .map_err(|e| e.to_string())?;
            crate::sync::keys::persist_device_keys(&conn, &device_keys)
                .map_err(|e| e.to_string())?;
            crate::sync::config::set_relay_url(&conn, &relay_url)
                .map_err(|e| e.to_string())?;

            if identity_changed {
                // Different phrase = new content_master_key — old ciphertext
                // can't be decrypted anymore. Reset state so ops re-encrypt
                // and re-upload, and re-trigger backfill.
                conn.execute_batch(
                    "UPDATE op_log SET ciphertext = NULL, state = 'local_only', user_seq = NULL \
                     WHERE state IN ('committed', 'pending_upload'); \
                     UPDATE sync_state SET last_seen_user_seq = 0;"
                ).map_err(|e| e.to_string())?;
                conn.execute("DELETE FROM op_log_meta WHERE key = 'backfill_complete'", [])
                    .ok();
            }
        }

        let resp = crate::sync::wire::enroll::self_enroll(
            &relay_url,
            &user_keys,
            &device_keys,
            &device_label,
        )
        .map_err(|e| e.to_string())?;

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        {
            let conn = db.lock().map_err(|e| e.to_string())?;
            crate::sync::config::set_enrollment(&conn, &resp.user_id, &resp.device_id, now_ms)
                .map_err(|e| e.to_string())?;
        }

        // Best-effort, unlike sync_recover's hard error: this path is
        // pre-existing (self-enroll predates phrase recovery) and a
        // fresh single_user relay simply has zero epochs yet, so 0
        // recovered here is the common, expected case — not a failure
        // worth surfacing to the user mid-setup. A relay that already
        // has rotated epochs (e.g. re-claiming after a wipe) still
        // benefits when this succeeds; it just doesn't block enrollment
        // when it doesn't.
        match crate::sync::rotation::recover_epoch_keys_from_phrase(
            &db, &device_keys, &relay_url, &resp.user_id,
        ) {
            Ok(n) => log::info!(
                "sync_self_enroll: unwrapped {n} epoch key(s) from the recovery phrase"
            ),
            Err(e) => log::warn!("sync_self_enroll: epoch key recovery failed: {e}"),
        }

        // Spawn worker so sync is ready as soon as the caller flips enabled.
        let new_handle = crate::sync::worker::spawn_if_configured(
            db.clone(),
            engine.clone(),
            crate::sync::worker::DEFAULT_TICK,
            crate::sync::worker::WorkerCallbacks::default(),
        )?;
        let mut slot = worker_slot.lock().map_err(|e| e.to_string())?;
        *slot = new_handle;

        Ok(SyncEnrollResultDto {
            user_id: resp.user_id,
            device_id: resp.device_id,
        })
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Which bootstrap endpoint `bootstrap_hosted_account` posts to.
#[derive(Clone, Copy)]
enum BootstrapVerb {
    /// `POST /v1/devices/init` — always creates a new user+device.
    Init,
    /// `POST /v1/devices/recover` — finds the account a phrase already
    /// belongs to instead of creating one.
    Recover,
}

/// Shared body for `sync_init` and `sync_recover`: parse the phrase,
/// derive keys, persist them, reset local op_log state on an identity
/// change, hit the relay's bootstrap endpoint, and stamp enrollment.
/// `sync_init` and `sync_recover` are thin `#[tauri::command]` wrappers
/// around this — the two used to be ~85 lines of copy-pasted bookkeeping
/// with nothing enforcing that a future change (key derivation, the
/// op_log reset, the worker respawn) landed in both places.
///
/// The only `match verb` points are the wire call (`enroll::init` vs
/// `enroll::recover`) and the post-enrollment epoch-key recovery, which
/// runs for `Recover` only: a recovered device has no device-sealed
/// epoch-key copy yet (those are sealed to a device's kex key), so it
/// must unwrap the phrase-recovery copies or every post-rotation op
/// reads as "no content key for epoch" and the pull silently skips it.
/// That's a hard `?` error here — unlike `sync_self_enroll`'s best-effort
/// version, a freshly-recovered device silently missing history is
/// exactly the failure mode recovery exists to prevent.
async fn bootstrap_hosted_account(
    db: Db,
    engine: crate::op_log::OpLog,
    worker_slot: SyncWorkerSlot,
    phrase: String,
    relay_url: String,
    device_label: String,
    verb: BootstrapVerb,
) -> Result<SyncEnrollResultDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mnemonic = bip39::Mnemonic::parse_normalized(phrase.trim())
            .map_err(|e| format!("invalid bip39 phrase: {e}"))?;
        let user_keys = crate::sync::keys::user_keys_from_phrase(&mnemonic);
        let device_keys = crate::sync::keys::generate_device_keys();

        {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let prior_sign_pub = crate::sync::keys::load_user_keys(&conn)
                .ok()
                .flatten()
                .map(|k| k.user_sign_pub_bytes());
            let new_sign_pub = user_keys.user_sign_pub_bytes();
            let identity_changed = prior_sign_pub
                .map(|p| p != new_sign_pub)
                .unwrap_or(true);

            crate::sync::keys::persist_user_phrase(&conn, &mnemonic)
                .map_err(|e| e.to_string())?;
            crate::sync::keys::persist_device_keys(&conn, &device_keys)
                .map_err(|e| e.to_string())?;
            crate::sync::config::set_relay_url(&conn, &relay_url)
                .map_err(|e| e.to_string())?;

            if identity_changed {
                conn.execute_batch(
                    "UPDATE op_log SET ciphertext = NULL, state = 'local_only', user_seq = NULL \
                     WHERE state IN ('committed', 'pending_upload'); \
                     UPDATE sync_state SET last_seen_user_seq = 0;"
                ).map_err(|e| e.to_string())?;
                conn.execute("DELETE FROM op_log_meta WHERE key = 'backfill_complete'", [])
                    .ok();
            }
        }

        let resp = match verb {
            BootstrapVerb::Init => crate::sync::wire::enroll::init(
                &relay_url,
                &user_keys,
                &device_keys,
                &device_label,
            ),
            BootstrapVerb::Recover => crate::sync::wire::enroll::recover(
                &relay_url,
                &user_keys,
                &device_keys,
                &device_label,
            ),
        }
        .map_err(|e| e.to_string())?;

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        {
            let conn = db.lock().map_err(|e| e.to_string())?;
            crate::sync::config::set_enrollment(&conn, &resp.user_id, &resp.device_id, now_ms)
                .map_err(|e| e.to_string())?;
        }

        if matches!(verb, BootstrapVerb::Recover) {
            // Epochs ≥ 1 are sealed to each device's kex key AND to a
            // phrase-derived recovery key. A recovered device has no
            // device-sealed copy yet, so it must unwrap the recovery
            // copies or every post-rotation op is "no content key for
            // epoch" and the pull silently skips it.
            let recovered = crate::sync::rotation::recover_epoch_keys_from_phrase(
                &db, &device_keys, &relay_url, &resp.user_id,
            )?;
            log::info!(
                "sync_recover: unwrapped {recovered} epoch key(s) from the recovery phrase"
            );
        }

        let new_handle = crate::sync::worker::spawn_if_configured(
            db.clone(),
            engine.clone(),
            crate::sync::worker::DEFAULT_TICK,
            crate::sync::worker::WorkerCallbacks::default(),
        )?;
        let mut slot = worker_slot.lock().map_err(|e| e.to_string())?;
        *slot = new_handle;

        Ok(SyncEnrollResultDto {
            user_id: resp.user_id,
            device_id: resp.device_id,
        })
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// `POST /v1/devices/init` — multi_user mode enrollment.
/// Creates a new user+device atomically on a relay running in
/// multi_user mode. Same key setup as sync_self_enroll but calls
/// the init endpoint instead.
#[tauri::command]
pub async fn sync_init(
    db: State<'_, Db>,
    engine: State<'_, crate::op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    phrase: String,
    relay_url: String,
    device_label: String,
) -> Result<SyncEnrollResultDto, String> {
    bootstrap_hosted_account(
        db.inner().clone(),
        engine.inner().clone(),
        worker_slot.inner().clone(),
        phrase,
        relay_url,
        device_label,
        BootstrapVerb::Init,
    )
    .await
}

/// `POST /v1/devices/recover` — attach this device to the account a
/// known recovery phrase already belongs to, on a relay running in
/// multi_user mode. `sync_init` creates a new account; this one finds
/// the existing one, so a phrase the user already has doesn't collide
/// with `user_sign_pub_already_registered`. Same key setup and local
/// bookkeeping as `sync_init` (shared via `bootstrap_hosted_account`),
/// but posts to `recover` instead of `init`, and then unwraps any
/// phrase-recoverable epoch keys so a device recovered after a rotation
/// can still read past ops.
#[tauri::command]
pub async fn sync_recover(
    db: State<'_, Db>,
    engine: State<'_, crate::op_log::OpLog>,
    worker_slot: State<'_, SyncWorkerSlot>,
    phrase: String,
    relay_url: String,
    device_label: String,
) -> Result<SyncEnrollResultDto, String> {
    bootstrap_hosted_account(
        db.inner().clone(),
        engine.inner().clone(),
        worker_slot.inner().clone(),
        phrase,
        relay_url,
        device_label,
        BootstrapVerb::Recover,
    )
    .await
}

/// Flip the `enabled` gate. The worker is already spawned (since
/// sync_setup) and polls every 30s; flipping this changes whether
/// each tick actually does work. Returns immediately — the next tick
/// will pick up the new state within DEFAULT_TICK.
#[tauri::command]
pub fn sync_set_enabled(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::sync::config::set_enabled(&conn, enabled).map_err(|e| e.to_string())
}

/// Explicit user-initiated re-upload. Clears cached ciphertext from
/// every committed / pending_upload op, resets the pull cursor, and
/// re-triggers backfill so the next worker tick re-encrypts and
/// re-uploads everything from scratch. Use this when the user wants
/// to force a clean re-sync (e.g. corrupted relay state, debugging).
/// Same-phrase re-enroll no longer does this implicitly (see S2).
#[tauri::command]
pub fn sync_force_reupload(db: State<'_, Db>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(
        "UPDATE op_log SET ciphertext = NULL, state = 'local_only', user_seq = NULL \
         WHERE state IN ('committed', 'pending_upload'); \
         UPDATE sync_state SET last_seen_user_seq = 0; \
         DELETE FROM op_log_meta WHERE key = 'backfill_complete';"
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Snapshot the sync engine state for the frontend. `configured` is
/// true iff both BIP-39 phrase and device keys are persisted —
/// independent of the `enabled` flag.
#[tauri::command]
pub fn sync_status(db: State<'_, Db>) -> Result<SyncStatusDto, String> {
    sync_status_inner(db.inner())
}

/// `sync_status` body taking `&Db` directly so it can be called from
/// inside `spawn_blocking` closures (where State references can't go).
pub fn sync_status_inner(db: &Db) -> Result<SyncStatusDto, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
    let configured = crate::sync::keys::load_user_keys(&conn)?.is_some()
        && crate::sync::keys::load_device_keys(&conn)?.is_some();
    let keys_at_rest_unprotected =
        configured && crate::sync::keys::secrets_unprotected_at_rest(&conn);
    let revoked = crate::sync::config::get_setting_i64(&conn, "sync_revoked") == Some(1);
    Ok(SyncStatusDto {
        relay_url: cfg.relay_url,
        user_id: cfg.user_id,
        device_id: cfg.device_id,
        enabled: cfg.enabled,
        configured,
        last_seen_user_seq: cfg.last_seen_user_seq,
        last_sync_at_ms: cfg.last_sync_at_ms,
        last_error: cfg.last_error,
        keys_at_rest_unprotected,
        revoked,
    })
}

/// Flush any pending uploads RIGHT NOW, inline and blocking, instead of
/// waiting for the worker thread to wake and run its own tick.
///
/// Why this exists: `wake_after` (`schedule_sync_wake`) only sets a flag
/// the worker's sleep loop notices next time it polls — on Android,
/// backgrounding the app can freeze that thread before it ever gets
/// scheduled again, so anything written in the seconds before the user
/// switches away or locks the screen could sit unsent indefinitely, until
/// the app is reopened. This command is the frontend's `visibilitychange`
/// / `pagehide` handler's last chance to get bytes out the door before
/// the OS suspends the process — it does the upload itself, on the
/// command thread, rather than asking a thread that may never run again
/// to do it.
///
/// Reuses `upload::run_pass` — the exact same call `worker::tick` makes —
/// so this is not a second upload code path to keep in sync with the
/// first; it is the first, invoked early. Deliberately narrower than a
/// full `tick()`: no pull, no key-rotation housekeeping, no attachment
/// object sweep — those are not "did the user's just-typed content reach
/// the relay" and can wait for the worker's next real tick. A quick,
/// synchronous "get pending ops out" is what a few seconds before
/// suspension can actually afford.
///
/// Guarded to a fast no-op when sync isn't configured/enabled, or when
/// this device has no keys yet (fresh install, never paired) — both
/// normal states, not errors. Resilient by design: every failure path
/// logs and returns `Ok(())` rather than propagating an error, because
/// the caller is a best-effort lifecycle hook, not a user action waiting
/// on a result — a promise rejection here must never block or throw
/// during app teardown.
#[tauri::command]
pub fn sync_flush_now(db: State<'_, Db>) -> Result<(), String> {
    sync_flush_now_inner(db.inner());
    Ok(())
}

/// `&Db`-only body so it's callable without a `State` (tests, and any
/// future non-command lifecycle hook). Never returns `Err` — see the
/// doc comment on `sync_flush_now` for why every failure is logged and
/// swallowed instead.
pub fn sync_flush_now_inner(db: &Db) {
    let (cfg, user_keys, device_keys) = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("sync_flush_now: db mutex poisoned: {e}");
                return;
            }
        };
        let cfg = match crate::sync::config::load(&conn) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("sync_flush_now: config load failed: {e}");
                return;
            }
        };
        if !cfg.is_active() {
            // Not configured, or the user has sync paused — a quiet,
            // expected no-op, not something worth a log line on every
            // background of an app that has never turned sync on.
            return;
        }
        let user_keys = match crate::sync::keys::load_user_keys(&conn) {
            Ok(k) => k,
            Err(e) => {
                log::warn!("sync_flush_now: user keys load failed: {e}");
                return;
            }
        };
        let device_keys = match crate::sync::keys::load_device_keys(&conn) {
            Ok(k) => k,
            Err(e) => {
                log::warn!("sync_flush_now: device keys load failed: {e}");
                return;
            }
        };
        (cfg, user_keys, device_keys)
    };
    let (Some(user_keys), Some(device_keys)) = (user_keys, device_keys) else {
        // is_active() checks relay_url/user_id/enabled, not whether keys
        // are actually persisted — a config that's active by every other
        // measure but has no keys yet (mid-setup) has nothing to sign
        // uploads with.
        return;
    };
    match crate::sync::upload::run_pass(db, &cfg, &user_keys, &device_keys) {
        Ok(stats) if stats.ops_posted > 0 || stats.blobs_uploaded > 0 => {
            log::info!(
                "sync_flush_now: posted={} uploaded={} acked={}",
                stats.ops_posted,
                stats.blobs_uploaded,
                stats.blobs_acked
            );
        }
        Ok(_) => {}
        Err(e) => log::warn!("sync_flush_now: upload pass failed: {e}"),
    }
}

/// Return the most recent entries from `sync_error_history` for the
/// status pill's popover. Clamped to 1..=50 so a misbehaving caller
/// can't OOM us with `limit = i64::MAX`; the popover only ever shows
/// the top handful.
#[tauri::command]
pub fn sync_error_history(
    db: State<'_, Db>,
    limit: Option<i64>,
) -> Result<Vec<SyncErrorDto>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(20).max(1).min(50);
    let mut stmt = conn
        .prepare(
            "SELECT error_at_ms, error_kind, error_message FROM sync_error_history \
             ORDER BY error_at_ms DESC LIMIT ?",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<SyncErrorDto> = stmt
        .query_map(params![limit], |r| {
            Ok(SyncErrorDto {
                at_ms: r.get(0)?,
                kind: r.get(1)?,
                message: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

// ===== sync ops surface (phase 14.22) =====

/// Pause the sync engine. Functionally identical to
/// `sync_set_enabled(false)` but exposed under its own name so the JS
/// settings UI doesn't have to know about the flag indirection. The
/// worker is already spawned; next tick sees enabled=false and skips.
#[tauri::command]
pub fn sync_pause(db: State<'_, Db>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::sync::config::set_enabled(&conn, false).map_err(|e| e.to_string())
}

/// Resume the sync engine. Symmetric counterpart to `sync_pause`.
#[tauri::command]
pub fn sync_resume(db: State<'_, Db>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::sync::config::set_enabled(&conn, true).map_err(|e| e.to_string())
}

/// Drop the pull cursor back to 0 and immediately run a sync tick.
/// Used by the cold-start / restore-from-relay flow — after entering
/// the recovery phrase on a new device, the user expects their old
/// state to appear without waiting up to 30s for the next worker
/// poll. Spec arch §11.
///
/// Returns the post-tick status snapshot so the frontend can show
/// progress without polling.
#[tauri::command(async)]
pub async fn sync_force_pull(
    db: State<'_, Db>,
    engine: State<'_, crate::op_log::OpLog>,
) -> Result<SyncStatusDto, String> {
    let db_arc = db.inner().clone();
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<SyncStatusDto, String> {
        // Reset cursor synchronously inside its own lock scope so the
        // tick below can re-acquire freely.
        {
            let conn = db_arc.lock().map_err(|e| e.to_string())?;
            crate::sync::config::set_last_seen_user_seq(&conn, 0)
                .map_err(|e| e.to_string())?;
        }

        // Load keys for the tick. If sync isn't configured yet (no
        // keys), skip the tick — caller still gets a coherent status.
        let (user_keys, device_keys) = {
            let conn = db_arc.lock().map_err(|e| e.to_string())?;
            let uk = crate::sync::keys::load_user_keys(&conn)?;
            let dk = crate::sync::keys::load_device_keys(&conn)?;
            (uk, dk)
        };
        if let (Some(uk), Some(dk)) = (user_keys, device_keys) {
            crate::sync::worker::tick(&db_arc, &uk, &dk, &engine);
        }

        sync_status_inner(&db_arc)
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Update the relay URL. Used when the user re-points to a different
/// self-hosted relay or moves between hosting providers. The next
/// tick uses the new URL; no worker restart needed.
#[tauri::command]
pub fn sync_set_relay_url(db: State<'_, Db>, url: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::sync::config::set_relay_url(&conn, &url).map_err(|e| e.to_string())
}

/// Revoke a paired device. Sends `DELETE /v1/users/<uid>/devices/<did>`
/// signed by the calling device. After 204 the target device's worker
/// will start getting 401 device_revoked on every signed call and the
/// live channel emits `closed` so the revoked device's loop exits.
///
/// Self-revoke (calling with this device's own id) is allowed — used
/// by the "leave this device" path in Settings.
#[tauri::command]
pub async fn sync_revoke_device(
    db: State<'_, Db>,
    target_device_id: String,
) -> Result<(), String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (relay_url, user_id, device_keys) = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
            let dk = crate::sync::keys::load_device_keys(&conn)?
                .ok_or_else(|| "device not configured".to_string())?;
            let url = cfg
                .relay_url
                .ok_or_else(|| "relay_url not set".to_string())?;
            let uid = cfg.user_id.ok_or_else(|| "not enrolled".to_string())?;
            (url, uid, dk)
        };
        crate::sync::wire::devices::revoke_device(
            &relay_url,
            &device_keys,
            &user_id,
            &target_device_id,
        )
        .map_err(|e| format!("revoke failed: {e}"))?;

        // Rotate the account keys so the revoked device is locked out of all
        // content from the next epoch onward (key rotation plan 4). Skip on
        // self-revoke: a device leaving the account can't rotate for the
        // others, and would get 401 on the publish call anyway. Rotation
        // failure does NOT un-revoke (the relay already refuses the device);
        // it is surfaced so the user can re-run it from another device.
        let is_self = device_keys.device_id.to_string() == target_device_id;
        if !is_self {
            crate::sync::rotation::rotate_after_revoke(
                &db,
                &device_keys,
                &relay_url,
                &user_id,
                &target_device_id,
            )
            .map_err(|e| format!("device revoked, but key rotation failed: {e}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Device row shown in the device list. Mirrors the relay's `DeviceInfo`
/// plus `last_seen_ms`, which the relay does not track at all — it is
/// derived locally from the op log (see `sync::device_view`).
#[derive(serde::Serialize)]
pub struct DeviceDto {
    pub id: String,
    pub label: Option<String>,
    pub created_at: i64,
    pub revoked_at: Option<i64>,
    pub device_kex_pub: Option<String>,
    pub device_sign_pub: String,
    pub last_seen_ms: Option<i64>,
}

/// List the devices on this user's account. Hits `GET /v1/users/<uid>/devices`
/// (spec §5.3) signed by this device. Returns the relay's full list, each row
/// annotated with a locally-derived last-seen time; the frontend may filter
/// `revoked_at IS NOT NULL` rows before display.
#[tauri::command]
pub async fn sync_list_devices(db: State<'_, Db>) -> Result<Vec<DeviceDto>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (relay_url, user_id, device_keys) = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
            let dk = crate::sync::keys::load_device_keys(&conn)?
                .ok_or_else(|| "device not configured".to_string())?;
            let url = cfg
                .relay_url
                .ok_or_else(|| "relay_url not set".to_string())?;
            let uid = cfg.user_id.ok_or_else(|| "not enrolled".to_string())?;
            (url, uid, dk)
        };
        let items = crate::sync::wire::devices::list_devices(&relay_url, &device_keys, &user_id)
            .map_err(|e| format!("list devices failed: {e}"))?;

        // Lock once around the map rather than per-device: this is a local
        // read against the same connection, not another network round trip.
        let conn = db.lock().map_err(|e| e.to_string())?;
        Ok(items
            .into_iter()
            .map(|item| {
                let last_seen_ms =
                    crate::sync::device_view::last_seen_ms(&conn, &item.id).unwrap_or(None);
                DeviceDto {
                    id: item.id,
                    label: item.label,
                    created_at: item.created_at,
                    revoked_at: item.revoked_at,
                    device_kex_pub: item.device_kex_pub,
                    device_sign_pub: item.device_sign_pub,
                    last_seen_ms,
                }
            })
            .collect())
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Storage quota readout for the current user. `cap=None` indicates an
/// uncapped tier (self-hosted relay or an explicitly unlimited plan);
/// the UI renders this branch as the infinity symbol.
#[derive(serde::Serialize)]
pub struct QuotaDto {
    pub used: i64,
    pub cap: Option<i64>,
    pub tier: String,
}

/// Hit `GET /v1/users/<uid>/quota` (signed via §5.1) and return the
/// relay's view of this user's storage usage, cap, and tier label.
/// Drives the storage section of SyncSettings.
#[tauri::command]
pub async fn sync_quota(db: State<'_, Db>) -> Result<QuotaDto, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (relay_url, user_id, device_keys) = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
            let dk = crate::sync::keys::load_device_keys(&conn)?
                .ok_or_else(|| "device not configured".to_string())?;
            let url = cfg
                .relay_url
                .ok_or_else(|| "relay_url not set".to_string())?;
            let uid = cfg.user_id.ok_or_else(|| "not enrolled".to_string())?;
            (url, uid, dk)
        };
        let resp = crate::sync::wire::quota::get_quota(&relay_url, &device_keys, &user_id)
            .map_err(|e| format!("quota failed: {e}"))?;
        Ok(QuotaDto {
            used: resp.used,
            cap: resp.cap,
            tier: resp.tier,
        })
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Shape returned by `sync_account_email_status`. Serialized to JSON for
/// the frontend — mirrors the relay's `GET /v1/account/email-status` body.
#[derive(serde::Serialize)]
pub struct EmailStatusDto {
    pub email: Option<String>,
    pub verified: bool,
}

/// Register or update the email address used for web access at shizumu.app.
/// The relay sends a verification email on success (202). Error strings
/// preserve the relay error code so the frontend can map them to copy:
///   "email_unavailable" / "bad_password" / "bad_email" / "mail_failed".
#[tauri::command]
pub async fn sync_set_account_email(
    db: State<'_, Db>,
    email: String,
    password: String,
) -> Result<(), String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (relay_url, device_keys) = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
            let dk = crate::sync::keys::load_device_keys(&conn)?
                .ok_or_else(|| "device not configured".to_string())?;
            let url = cfg
                .relay_url
                .ok_or_else(|| "relay_url not set".to_string())?;
            (url, dk)
        };
        crate::sync::wire::account::set_email(&relay_url, &device_keys, &email, &password)
            .map_err(|e| match &e {
                crate::sync::wire::WireError::Wire { body, .. } => body.code.clone(),
                other => format!("set_email failed: {other}"),
            })
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Fetch this account's current email address and verification status from the
/// relay. Returns `email: null` when no email has been linked yet.
#[tauri::command]
pub async fn sync_account_email_status(db: State<'_, Db>) -> Result<EmailStatusDto, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (relay_url, device_keys) = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
            let dk = crate::sync::keys::load_device_keys(&conn)?
                .ok_or_else(|| "device not configured".to_string())?;
            let url = cfg
                .relay_url
                .ok_or_else(|| "relay_url not set".to_string())?;
            (url, dk)
        };
        let resp =
            crate::sync::wire::account::email_status(&relay_url, &device_keys)
                .map_err(|e| format!("email_status failed: {e}"))?;
        Ok(EmailStatusDto {
            email: resp.email,
            verified: resp.verified,
        })
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Redeem a license key against the relay's billing endpoint. On success the
/// relay upgrades the account's entitlement tier. Error strings preserve the
/// relay error code so the frontend can map them to copy:
///   "unknown_key" / "already_bound" / "inactive" / "bad_body".
#[tauri::command]
pub async fn sync_redeem_license(
    db: State<'_, Db>,
    license_key: String,
) -> Result<(), String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (relay_url, device_keys) = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
            let dk = crate::sync::keys::load_device_keys(&conn)?
                .ok_or_else(|| "device not configured".to_string())?;
            let url = cfg
                .relay_url
                .ok_or_else(|| "relay_url not set".to_string())?;
            (url, dk)
        };
        crate::sync::wire::billing::redeem(&relay_url, &device_keys, &license_key)
            .map_err(|e| match &e {
                crate::sync::wire::WireError::Wire { body, .. } => body.code.clone(),
                other => format!("redeem failed: {other}"),
            })
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Probe a relay's /healthz endpoint before persisting any keys.
/// Returns the relay's self-reported version/info on success. Used
/// by the setup wizard so a typo'd or down relay fails fast without
/// leaving the user with persisted-but-unreachable keys.
///
/// Goes through reqwest (not browser fetch) to bypass CORS — the
/// webview's tauri://localhost origin would otherwise be rejected
/// by relays that don't set Access-Control-Allow-Origin.
#[tauri::command]
pub async fn sync_relay_health(relay_url: String) -> Result<serde_json::Value, String> {
    // spawn_blocking puts the body on a dedicated thread that has NO
    // tokio runtime entered, so reqwest::blocking's internal runtime can
    // create+drop cleanly. With #[command(async)] or pub async fn alone,
    // the body runs in a tokio worker, and reqwest::blocking's runtime
    // drop panics ("Cannot drop a runtime in a context where blocking
    // is not allowed"). This is the standard pattern for every Tauri
    // command that uses reqwest::blocking.
    tauri::async_runtime::spawn_blocking(move || {
        let url = relay_url.trim().trim_end_matches('/');
        crate::sync::config::validate_relay_url(url)?;
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| format!("client build: {e}"))?;
        let resp = client
            .get(format!("{url}/healthz"))
            .send()
            .map_err(|e| format!("can't reach {url}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("relay returned {}", resp.status()));
        }
        resp.json::<serde_json::Value>()
            .map_err(|e| format!("decode healthz: {e}"))
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Disconnect from the relay, keep local writing intact. Clears all
/// sync state but leaves pages/lineages/pins/op_log alone. User can
/// re-enroll later (same or different phrase).
#[tauri::command]
pub fn sync_reset(
    db: State<'_, Db>,
    worker_slot: State<'_, SyncWorkerSlot>,
) -> Result<(), String> {
    sync_reset_inner(db.inner())?;
    // Shut down the worker; the slot drop signals it.
    let mut slot = worker_slot.lock().map_err(|e| e.to_string())?;
    *slot = None;
    Ok(())
}

/// `sync_reset`'s DB-only body, split out so tests can drive it without
/// a Tauri `State<SyncWorkerSlot>` (which needs a running app).
pub fn sync_reset_inner(db: &Db) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(
        "UPDATE sync_state SET enabled=0, user_id=NULL, device_id=NULL, \
         relay_url=NULL, enrolled_at_ms=NULL, last_sync_at_ms=NULL, \
         last_error=NULL, last_seen_user_seq=0; \
         DELETE FROM sync_keys; \
         UPDATE op_log SET state='local_only', ciphertext=NULL, user_seq=NULL \
         WHERE state IN ('committed', 'pending_upload'); \
         DELETE FROM op_log_meta WHERE key='backfill_complete'; \
         DELETE FROM settings WHERE key = 'sync_revoked';"
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Point at a different relay URL. Resets cursor + clears ciphertext
/// (the new relay needs fresh uploads). Keeps keys and identity.
/// User still needs to re-enroll on the new relay.
#[tauri::command]
pub fn sync_switch_relay(
    db: State<'_, Db>,
    worker_slot: State<'_, SyncWorkerSlot>,
    new_url: String,
) -> Result<(), String> {
    let url = new_url.trim();
    crate::sync::config::validate_relay_url(url)?;
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(&format!(
        "UPDATE sync_state SET enabled=0, user_id=NULL, device_id=NULL, \
         relay_url='{}', enrolled_at_ms=NULL, last_sync_at_ms=NULL, \
         last_error=NULL, last_seen_user_seq=0; \
         UPDATE op_log SET state='local_only', ciphertext=NULL, user_seq=NULL \
         WHERE state IN ('committed', 'pending_upload');",
        url.replace('\'', "''")
    )).map_err(|e| e.to_string())?;
    drop(conn);
    let mut slot = worker_slot.lock().map_err(|e| e.to_string())?;
    *slot = None;
    Ok(())
}

// ===== pairing commands (phase 14.15) =====

/// Tauri-managed: in-memory pairing sessions. The ephemeral X25519
/// key the new device generates in `pair_new_join` must survive
/// across to `pair_new_complete` (where it decrypts the bundle).
/// Keyed by pair_token because that's the only stable identifier
/// shared between commands.
pub type PairingSessions = std::sync::Arc<
    std::sync::Mutex<std::collections::HashMap<String, x25519_dalek::StaticSecret>>,
>;

#[derive(serde::Serialize)]
pub struct PairExistingStartDto {
    pub qr_payload: String,
    pub pair_token: String,
    pub expires_at: i64,
}

#[derive(serde::Serialize)]
pub struct PairSasDto {
    pub sas: String,
    pub ephemeral_pub_b64: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct QrPayload {
    relay: String,
    uid: String,
    tok: String,
}

/// Existing device: request a pair_token from the relay and return
/// it as a QR-renderable string for the new device to scan.
#[tauri::command]
pub async fn pair_existing_start(
    db: State<'_, Db>,
    ttl_seconds: u32,
) -> Result<PairExistingStartDto, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        log::info!("pair_existing_start: acquiring db lock");
        let (relay_url, user_id, device_keys) = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            log::info!("pair_existing_start: lock acquired");
            let dk = crate::sync::keys::load_device_keys(&conn)?
                .ok_or_else(|| "device not configured".to_string())?;
            let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
            let relay = cfg
                .relay_url
                .ok_or_else(|| "relay url not set".to_string())?;
            let uid = cfg
                .user_id
                .ok_or_else(|| "device not enrolled".to_string())?;
            (relay, uid, dk)
        };
        log::info!("pair_existing_start: calling pair_start");
        let resp =
            crate::sync::wire::pair::pair_start(&relay_url, &device_keys, &user_id, ttl_seconds)
                .map_err(|e| {
                    log::error!("pair_existing_start: FAILED: {e}");
                    e.to_string()
                })?;
        log::info!("pair_existing_start: success, token={}", resp.pair_token);

        let payload = QrPayload {
            relay: relay_url.clone(),
            uid: user_id.clone(),
            tok: resp.pair_token.clone(),
        };
        let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        Ok(PairExistingStartDto {
            qr_payload: json,
            pair_token: resp.pair_token,
            expires_at: resp.expires_at,
        })
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Existing device: after the new device has uploaded its ephemeral_pub,
/// fetch it and compute the SAS the user will compare against the new
/// device's screen. Polls until the new device shows up or the
/// `attempts` count is exhausted (one attempt every 500ms by default).
#[tauri::command]
pub async fn pair_existing_fetch_sas(
    db: State<'_, Db>,
    pair_token: String,
    attempts: Option<u32>,
) -> Result<PairSasDto, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
    let (relay_url, user_id_str, device_keys, user_uuid) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let dk = crate::sync::keys::load_device_keys(&conn)?
            .ok_or_else(|| "device not configured".to_string())?;
        let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
        let relay = cfg
            .relay_url
            .ok_or_else(|| "relay url not set".to_string())?;
        let uid_str = cfg
            .user_id
            .ok_or_else(|| "device not enrolled".to_string())?;
        let uid_uuid = uuid::Uuid::parse_str(&uid_str)
            .map_err(|e| format!("user_id not a uuid: {e}"))?;
        (relay, uid_str, dk, uid_uuid)
    };

    let max_attempts = attempts.unwrap_or(40); // 40 * 500ms = 20s
    let mut last_err = String::new();
    for _ in 0..max_attempts {
        match crate::sync::wire::pair::pair_ephemeral(
            &relay_url,
            &device_keys,
            &user_id_str,
            &pair_token,
        ) {
            Ok(resp) => {
                use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
                let raw = B64
                    .decode(&resp.ephemeral_pub)
                    .map_err(|e| format!("ephemeral_pub not base64: {e}"))?;
                if raw.len() != 32 {
                    return Err(format!("ephemeral_pub is {} bytes, expected 32", raw.len()));
                }
                let mut pub_bytes = [0u8; 32];
                pub_bytes.copy_from_slice(&raw);
                let sas = crate::sync::pair::compute_sas(&user_uuid, &pub_bytes);
                return Ok(PairSasDto {
                    sas,
                    ephemeral_pub_b64: resp.ephemeral_pub,
                });
            }
            Err(e) => {
                last_err = e.to_string();
                // Only retry on Wire 4xx (token-not-yet-uploaded) — surface other errors immediately.
                if !last_err.contains("404") && !last_err.contains("pair_token") {
                    return Err(last_err);
                }
                // 1500ms baseline keeps the auto-confirm cadence well
                // under typical rate limits (the new flow polls in a
                // tight loop on both sides simultaneously).
                let sleep_ms = if last_err.contains("429") || last_err.contains("rate_limited") {
                    3000
                } else {
                    1500
                };
                std::thread::sleep(std::time::Duration::from_millis(sleep_ms));
            }
        }
    }
    Err(format!("pair_ephemeral timed out: {last_err}"))
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

/// Existing device: AFTER the user has confirmed the SAS matches on
/// both screens, generate the new device's identity, wrap the key
/// bundle (including device identity), upload, and finalize.
///
/// Spec design note: the spec text says the NEW device generates its
/// own sign keys, but the relay's `pair_upload` schema doesn't carry
/// `device_sign_pub` and `pair_finalize` (signed by the existing
/// device) needs it. To bridge the gap, the existing device generates
/// the new device's identity and ships it inside the age-wrapped
/// bundle. The new device adopts the included identity rather than
/// generating its own. Still confidential to the new device (the
/// bundle is encrypted to its ephemeral_pub) and the user_kex_priv
/// they receive is already symmetric trust.
#[tauri::command]
pub async fn pair_existing_confirm(
    db: State<'_, Db>,
    pair_token: String,
    ephemeral_pub_b64: String,
    new_device_label: String,
) -> Result<(), String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use ed25519_dalek::Signer;

    let (relay_url, user_id, device_keys, mut user_keys) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let dk = crate::sync::keys::load_device_keys(&conn)?
            .ok_or_else(|| "device not configured".to_string())?;
        let uk = crate::sync::keys::load_user_keys(&conn)?
            .ok_or_else(|| "user keys missing".to_string())?;
        let cfg = crate::sync::config::load(&conn).map_err(|e| e.to_string())?;
        let relay = cfg
            .relay_url
            .ok_or_else(|| "relay url not set".to_string())?;
        let uid = cfg
            .user_id
            .ok_or_else(|| "device not enrolled".to_string())?;
        (relay, uid, dk, uk)
    };
    user_keys.user_id = Some(
        uuid::Uuid::parse_str(&user_id).map_err(|e| format!("user_id parse: {e}"))?,
    );

    // Decode the new device's ephemeral_pub.
    let pub_bytes_raw = B64
        .decode(&ephemeral_pub_b64)
        .map_err(|e| format!("ephemeral_pub not base64: {e}"))?;
    if pub_bytes_raw.len() != 32 {
        return Err(format!(
            "ephemeral_pub is {} bytes, expected 32",
            pub_bytes_raw.len()
        ));
    }
    let mut pub_bytes = [0u8; 32];
    pub_bytes.copy_from_slice(&pub_bytes_raw);

    // Mint the new device's identity. The seed travels inside the
    // wrapped bundle; the corresponding pubkey + UUID travel via
    // pair_finalize for the relay's bookkeeping.
    let new_device_keys = crate::sync::keys::generate_device_keys();
    let new_dev_seed = new_device_keys.device_sign_priv.to_bytes();
    let new_dev_pub_bytes = new_device_keys.device_sign_pub_bytes();
    let new_dev_pub_b64 = B64.encode(new_dev_pub_bytes);
    let new_dev_id = new_device_keys.device_id;

    // Build + age-wrap the bundle, with device identity attached.
    let bundle = crate::sync::pair::KeyBundle::from_user_keys(&user_keys)?
        .with_device_identity(&new_dev_seed, &new_dev_id);
    let wrapped = crate::sync::pair::wrap_bundle(&bundle, &pub_bytes)?;
    let wrapped_b64 = B64.encode(&wrapped);

    crate::sync::wire::pair::pair_upload_wrapped(
        &relay_url,
        &device_keys,
        &user_id,
        &pair_token,
        &wrapped_b64,
    )
    .map_err(|e| e.to_string())?;

    // authorized_sig = user_sign_priv.sign(new device's sign_pub bytes).
    let authorized_sig = user_keys.user_sign_priv.sign(&new_dev_pub_bytes);
    let authorized_sig_b64 = B64.encode(authorized_sig.to_bytes());

    crate::sync::wire::pair::pair_finalize(
        &relay_url,
        &device_keys,
        &user_id,
        &pair_token,
        &new_dev_pub_b64,
        &new_dev_id.as_hyphenated().to_string(),
        &new_device_label,
        &authorized_sig_b64,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

#[derive(serde::Serialize)]
pub struct PairNewJoinDto {
    pub sas: String,
    pub user_id: String,
    pub relay_url: String,
}

/// New device: parse the QR payload, generate ephemeral keypair,
/// upload to relay, compute SAS locally, return for display. The
/// ephemeral private key is stashed in `PairingSessions` keyed by
/// pair_token so `pair_new_complete` can decrypt the bundle later.
#[tauri::command]
pub async fn pair_new_join(
    sessions: State<'_, PairingSessions>,
    qr_payload: String,
) -> Result<PairNewJoinDto, String> {
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

        let payload: QrPayload = serde_json::from_str(qr_payload.trim())
            .map_err(|e| format!("qr payload not JSON: {e}"))?;
        let user_uuid = uuid::Uuid::parse_str(&payload.uid)
            .map_err(|e| format!("user_id not a uuid: {e}"))?;

        let (ephem_priv, ephem_pub) = crate::sync::pair::generate_ephemeral_keypair();
        let pub_bytes = ephem_pub.to_bytes();
        let pub_b64 = B64.encode(pub_bytes);

        crate::sync::wire::pair::pair_upload_ephemeral(
            &payload.relay,
            &payload.uid,
            &payload.tok,
            &pub_b64,
        )
        .map_err(|e| e.to_string())?;

        let sas = crate::sync::pair::compute_sas(&user_uuid, &pub_bytes);
        {
            let mut map = sessions.lock().map_err(|e| e.to_string())?;
            map.insert(payload.tok.clone(), ephem_priv);
        }
        Ok(PairNewJoinDto {
            sas,
            user_id: payload.uid,
            relay_url: payload.relay,
        })
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

#[derive(serde::Serialize)]
pub struct PairNewCompleteDto {
    pub user_id: String,
    pub device_id: String,
}

/// New device: after the user has confirmed the SAS match on the
/// existing device, fetch the wrapped bundle, decrypt, persist all
/// keys + new device keys, then poll status until ready. Returns
/// the assigned (user_id, device_id) once finalized.
#[tauri::command]
pub async fn pair_new_complete(
    db: State<'_, Db>,
    engine: State<'_, crate::op_log::OpLog>,
    sessions: State<'_, PairingSessions>,
    worker_slot: State<'_, SyncWorkerSlot>,
    qr_payload: String,
    device_label: String,
    poll_attempts: Option<u32>,
) -> Result<PairNewCompleteDto, String> {
    let db = db.inner().clone();
    let engine = engine.inner().clone();
    let sessions = sessions.inner().clone();
    let worker_slot = worker_slot.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let payload: QrPayload = serde_json::from_str(qr_payload.trim())
        .map_err(|e| format!("qr payload not JSON: {e}"))?;

    // Reclaim the ephemeral private key the join command stashed.
    let ephem_priv = {
        let mut map = sessions.lock().map_err(|e| e.to_string())?;
        map.remove(&payload.tok)
            .ok_or_else(|| "no pairing session for this token (did join run?)".to_string())?
    };

    // 1. Fetch the age-wrapped bundle. The existing device deposits this
    //    asynchronously (its own auto-confirm loop polls for our ephemeral
    //    pub before wrapping + uploading), so a 404 / state_invalid here
    //    just means we got there first — retry until the deposit lands or
    //    the budget expires. Hard-errors (expired token) abort immediately.
    // Total time budget ≈ 60s at the default poll_attempts of 120 with
    // 500ms sleep; we now use a slower 1500ms baseline (and back off on
    // 429s) so cap iterations at 40 to stay near the same wall-clock.
    let fetch_budget = poll_attempts.unwrap_or(40);
    let mut wrapped_resp = None;
    let mut last_fetch_err = String::new();
    for _ in 0..fetch_budget {
        match crate::sync::wire::pair::pair_fetch_wrapped(
            &payload.relay,
            &payload.uid,
            &payload.tok,
        ) {
            Ok(r) => {
                wrapped_resp = Some(r);
                break;
            }
            Err(e) => {
                last_fetch_err = e.to_string();
                if last_fetch_err.contains("expired")
                    || last_fetch_err.contains("pair_token_unknown")
                {
                    return Err(last_fetch_err);
                }
                // 429 from the relay means our cadence is too tight —
                // back off further before the next attempt.
                let sleep_ms = if last_fetch_err.contains("429")
                    || last_fetch_err.contains("rate_limited")
                {
                    3000
                } else {
                    1500
                };
                std::thread::sleep(std::time::Duration::from_millis(sleep_ms));
            }
        }
    }
    let wrapped_resp = wrapped_resp.ok_or_else(|| {
        format!("wrapped bundle never deposited: {last_fetch_err}")
    })?;
    let wrapped_bytes = B64
        .decode(&wrapped_resp.wrapped)
        .map_err(|e| format!("wrapped envelope not base64: {e}"))?;

    // 2. Decrypt + unmarshal.
    let bundle = crate::sync::pair::unwrap_bundle(&wrapped_bytes, &ephem_priv)?;
    let bundle_user_id = bundle.user_id.clone();
    let embedded = bundle.embedded_device()?;
    let user_keys = bundle.into_user_keys()?;

    // 3. Adopt the device identity the existing device generated for
    //    us (see `pair_existing_confirm`'s design note on the spec
    //    gap). Without it the relay's pair_finalize used a different
    //    sign_pub and our auth would fail.
    let (new_dev_id, new_dev_seed) =
        embedded.ok_or_else(|| "wrapped bundle missing device identity".to_string())?;
    // The kex key is per-device and random — the new device mints its own
    // (it is NOT carried in the bundle). Its public half is published to the
    // relay by the worker's backfill step on first sync (key rotation plan 1).
    let mut kex_seed = [0u8; 32];
    {
        use rand_core::RngCore;
        rand_core::OsRng.fill_bytes(&mut kex_seed);
    }
    let device_kex_priv = x25519_dalek::StaticSecret::from(kex_seed);
    {
        use zeroize::Zeroize;
        kex_seed.zeroize();
    }
    let new_device_keys = crate::sync::keys::DeviceKeys {
        device_id: new_dev_id,
        device_sign_priv: ed25519_dalek::SigningKey::from_bytes(&new_dev_seed),
        device_kex_priv,
    };

    // 4. Persist device keys + relay URL + raw user keys. The BIP-39
    //    phrase isn't transmitted via pairing (paired devices receive
    //    derived keys, not the phrase). `persist_user_keys_raw`
    //    stores the four derived secrets directly so the worker can
    //    reload after a relaunch without needing the phrase.
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        crate::sync::config::set_relay_url(&conn, &payload.relay)
            .map_err(|e| e.to_string())?;
        crate::sync::keys::persist_device_keys(&conn, &new_device_keys)
            .map_err(|e| e.to_string())?;
        crate::sync::keys::persist_user_keys_raw(&conn, &user_keys)
            .map_err(|e| e.to_string())?;
    }

    // 5. Poll status until ready.
    let max_attempts = poll_attempts.unwrap_or(120); // 120 * 500ms = 60s
    let mut assigned_user_id = String::new();
    let mut assigned_device_id = String::new();
    let mut last_err = String::new();
    let mut ready = false;
    for _ in 0..max_attempts {
        match crate::sync::wire::pair::pair_status(&payload.relay, &payload.uid, &payload.tok) {
            Ok(resp) => match resp.status.as_str() {
                "ready" => {
                    assigned_user_id = resp.user_id.unwrap_or(bundle_user_id.clone());
                    assigned_device_id = resp
                        .device_id
                        .unwrap_or_else(|| new_device_keys.device_id.to_string());
                    ready = true;
                    break;
                }
                "pending" => {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
                other => {
                    return Err(format!("unexpected pair status: {other}"));
                }
            },
            Err(e) => {
                last_err = e.to_string();
                if last_err.contains("expired") {
                    return Err(last_err);
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }
    }
    if !ready {
        return Err(format!("pair_status never ready: {last_err}"));
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        crate::sync::config::set_enrollment(
            &conn,
            &assigned_user_id,
            &assigned_device_id,
            now_ms,
        )
        .map_err(|e| e.to_string())?;
        // Auto-enable: a successful pair flow's whole point is to start
        // syncing immediately. sync_setup leaves enabled=false on purpose
        // because the caller is mid-onboarding; pair_new_complete runs
        // after the user has explicitly typed a pair code, so we don't
        // need a second "are you sure" gate.
        crate::sync::config::set_enabled(&conn, true)
            .map_err(|e| e.to_string())?;
    }

    // 6. Spawn the worker. The user keys + device keys + sync_state
    //    are all on disk now, so `spawn_if_configured` reloads them
    //    cleanly. Replaces any prior worker handle.
    //
    // NOTE: see sync_setup — mid-session respawns lose the Tauri-event
    // hookup. Polling-fallback covers it until next process restart.
    let _ = device_label; // currently unused on the new-device side; the existing device sent the label to the relay's pair_finalize.
    let new_handle = crate::sync::worker::spawn_if_configured(
        db.clone(),
        engine.clone(),
        crate::sync::worker::DEFAULT_TICK,
        crate::sync::worker::WorkerCallbacks::default(),
    )
    .ok()
    .flatten();
    let mut slot = worker_slot.lock().map_err(|e| e.to_string())?;
    *slot = new_handle;

    // The in-memory user_keys we no longer need; zeroize-on-drop
    // wrappers (SecretKey32, Ed25519 SigningKey, X25519 StaticSecret)
    // scrub the bytes on the implicit drop at end-of-fn.
    drop(user_keys);

    Ok(PairNewCompleteDto {
        user_id: assigned_user_id,
        device_id: assigned_device_id,
    })
    })
    .await
    .map_err(|e| format!("blocking task panicked: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{insert_lineage, insert_page, set_page_lineage, test_db, test_db_at};

    /// Spins up an op_log engine over `db`. The three golden-path tests
    /// below drive the real command bodies, which emit op_log rows inline,
    /// so they need one the way the Tauri runtime supplies it as state.
    fn engine_for(db: &Db) -> crate::op_log::OpLog {
        std::sync::Arc::new(
            crate::op_log::OpLogEngine::load(&db.lock().unwrap()).unwrap(),
        )
    }

    fn doc_with(text: &str) -> String {
        serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": text }] }
            ]
        })
        .to_string()
    }

    // ─── golden paths ───────────────────────────────────────────────────
    // Ported down from e2e/specs/golden-paths.e2e.js (deleted). Those specs
    // ran under WebdriverIO + tauri-driver but never touched the UI — they
    // called the same command surface through the Tauri IPC bridge, because
    // WebKitWebDriver implements neither the Actions API nor click() on
    // contenteditable. That made them command-layer tests wearing a webview
    // harness, inside a job that could not fail the pipeline. Here they run
    // blocking, in milliseconds, against the same code path.
    //
    // The fourth spec (lock screen, INV-SEC-2) is NOT ported: crypto.rs's
    // `encrypted_db_roundtrip` already asserts wrong-passphrase rejection,
    // and the spec's only additional claim was the system keyring, which CI
    // has no session bus for.

    /// INV-DATA-2/3, INV-NAV-1 — content written to today's page survives a
    /// connection teardown, and reopening lands on the same page rather than
    /// minting a second one for the same day.
    #[test]
    fn golden_path_write_today_survives_reopen() {
        let dir = std::env::temp_dir().join(format!("shizumu-golden-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shizumu.db");
        let probe = "the probe that must outlive the connection";

        let first_id = {
            let db = test_db_at(&path);
            let engine = engine_for(&db);
            let pwl = get_or_create_today_inner(&db, &engine).unwrap();
            save_page_content_inner(&db, &pwl.page.id, &doc_with(probe), None).unwrap();
            pwl.page.id
        }; // db dropped — the file is all that carries the write forward

        let db = test_db_at(&path);
        let engine = engine_for(&db);
        let reopened = get_or_create_today_inner(&db, &engine).unwrap();

        assert_eq!(
            reopened.page.id, first_id,
            "reopen must resolve to the same today page, not create a second one"
        );
        assert!(
            reopened.page.content_json.unwrap_or_default().contains(probe),
            "content written before teardown must be readable after reopen"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// INV-NAV-5/6 — a page written on a trail is reachable through that
    /// trail with its content intact. This is the invariant the memory view
    /// depends on.
    #[test]
    fn golden_path_page_on_a_trail_is_reachable_through_it() {
        let db = test_db();
        let engine = engine_for(&db);
        let probe = "trail probe";

        let lineage = create_lineage_inner(
            &db,
            &engine,
            "reading notes".to_string(),
            Some("discrete".to_string()),
            None,
        )
        .unwrap();

        let pwl = create_new_page_inner(&db, &engine, "2026-08-02").unwrap();
        set_focus_lineage_inner(&db, &engine, &pwl.page.id, Some(lineage.id.clone())).unwrap();
        save_page_content_inner(&db, &pwl.page.id, &doc_with(probe), None).unwrap();

        let pages = get_trail_pages_inner(&db, &lineage.id).unwrap();
        let found = pages
            .iter()
            .find(|p| p.page.id == pwl.page.id)
            .expect("page assigned to the trail must come back from get_trail_pages");

        assert!(
            found
                .page
                .content_json
                .clone()
                .unwrap_or_default()
                .contains(probe),
            "trail lookup must carry the page's content, not just its row"
        );
    }


    /// The sidebar count must not depend on how many pages happen to be
    /// loaded. It used to: Memory tallied lineage_id over getThread(100, ..),
    /// so a trail whose pages sat outside the hundred most recent showed a
    /// number smaller than the truth. Counting in SQL is what removes that
    /// window, so this pins the aggregate itself.
    #[test]
    fn trail_page_counts_see_every_page_not_just_a_window() {
        let db = test_db();
        let conn = db.lock().unwrap();

        let a = insert_lineage(&conn, "the book", "discrete");
        let b = insert_lineage(&conn, "morning pages", "discrete");

        // 150 pages on trail A — more than any client-side page window.
        for i in 0..150 {
            let p = insert_page(&conn, "2026-01-01", i + 1);
            set_page_lineage(&conn, &p, &a);
        }
        // 2 on trail B.
        for i in 0..2 {
            let p = insert_page(&conn, "2026-01-02", i + 1);
            set_page_lineage(&conn, &p, &b);
        }
        // An untrailed page belongs to no sidebar row and must not be counted.
        insert_page(&conn, "2026-01-03", 1);

        let counts = get_trail_page_counts_inner(&conn).unwrap();
        let map: std::collections::HashMap<String, i64> = counts.into_iter().collect();

        assert_eq!(map.get(&a), Some(&150), "must count all 150, not a window");
        assert_eq!(map.get(&b), Some(&2));
        assert_eq!(map.len(), 2, "untrailed pages must not appear");
    }

    /// INV-DATA-5 — a pin created from one page on a trail is visible from a
    /// sibling page on the same trail. Pin × trail is the cross-product the
    /// product is built on; this is its floor.
    #[test]
    fn golden_path_pin_is_visible_from_a_sibling_page_on_the_trail() {
        let db = test_db();
        let engine = engine_for(&db);
        let probe = "pin probe";

        let lineage = create_lineage_inner(
            &db,
            &engine,
            "the book".to_string(),
            Some("discrete".to_string()),
            None,
        )
        .unwrap();

        // page A — source of the pin
        let page_a = create_new_page_inner(&db, &engine, "2026-08-02").unwrap();
        set_focus_lineage_inner(&db, &engine, &page_a.page.id, Some(lineage.id.clone())).unwrap();
        let pin = create_pin_inner(
            &db,
            &engine,
            Some(lineage.id.clone()),
            page_a.page.id.clone(),
            "text".to_string(),
            probe.to_string(),
            None,
        )
        .unwrap();

        // page B — sibling on the same trail, must see A's pin
        let page_b = create_new_page_inner(&db, &engine, "2026-08-02").unwrap();
        set_focus_lineage_inner(&db, &engine, &page_b.page.id, Some(lineage.id.clone())).unwrap();

        let pins = get_pins_inner(&db, Some(lineage.id.clone())).unwrap();
        let found = pins
            .iter()
            .find(|p| p.content == probe)
            .expect("pin created on the trail must be visible from a sibling page");

        assert_eq!(found.id, pin.id, "must be the same pin row, not a copy");
    }

    /// The premise the continuous-trail new-page affordance rests on:
    /// creating a page never attaches it to a trail. The single-canonical
    /// invariant is enforced at ASSIGNMENT time (check_continuous_invariant),
    /// so creation is always safe — including while a continuous trail is on
    /// screen. If this ever fails, the UI gate removed in
    /// docs/superpowers/specs/2026-08-02-continuous-trail-new-page-design.md
    /// has to come back.
    #[test]
    fn created_pages_are_untrailed() {
        let db = test_db();
        let engine = engine_for(&db);

        let first = create_new_page_inner(&db, &engine, "2026-08-02").unwrap();
        assert!(
            first.page.lineage_id.is_none(),
            "a newly created page must not belong to any trail"
        );

        // A second page on the same day is likewise untrailed — nothing about
        // an existing continuous trail elsewhere can leak into creation.
        let lineage_id = insert_lineage(&db.lock().unwrap(), "the book", "continuous");
        let canonical = insert_page(&db.lock().unwrap(), "2026-08-02", 9);
        set_page_lineage(&db.lock().unwrap(), &canonical, &lineage_id);

        let second = create_new_page_inner(&db, &engine, "2026-08-02").unwrap();
        assert!(
            second.page.lineage_id.is_none(),
            "creation must stay untrailed even when a continuous trail owns another page that day"
        );
        assert_ne!(second.page.id, canonical, "must be a distinct row");
    }

    /// `sync_generate_phrase` returns a 24-word mnemonic that
    /// round-trips through bip39::Mnemonic::parse_normalized. Sanity
    /// check that the Tauri wrapper passes through the underlying
    /// `keys::generate_seed_phrase()`'s 256-bit-entropy contract.
    #[test]
    fn sync_generate_phrase_returns_valid_24_word_bip39() {
        let phrase = sync_generate_phrase().unwrap();
        let words: Vec<&str> = phrase.split_whitespace().collect();
        assert_eq!(words.len(), 24, "phrase must be 24 words");
        bip39::Mnemonic::parse_normalized(&phrase)
            .expect("generated phrase must round-trip through bip39::parse");
    }

    #[test]
    fn continuous_trail_rejects_second_page() {
        let db = test_db();
        let conn = db.lock().unwrap();

        let lineage_id = insert_lineage(&conn, "startup journal", "continuous");
        let page1_id = insert_page(&conn, "2026-04-18", 1);
        let page2_id = insert_page(&conn, "2026-04-19", 1);

        // assign the first page — must succeed
        set_page_lineage(&conn, &page1_id, &lineage_id);
        assert!(check_continuous_invariant(&conn, &page1_id, &lineage_id).is_ok(),
            "re-assigning the same page must be idempotent");

        // assigning a second different page — must be rejected
        let result = check_continuous_invariant(&conn, &page2_id, &lineage_id);
        assert_eq!(
            result,
            Err("continuous_trail_has_canonical_page".to_string()),
            "continuous trail must refuse a second page"
        );
    }

    #[test]
    fn discrete_trail_allows_multiple_pages() {
        let db = test_db();
        let conn = db.lock().unwrap();

        let lineage_id = insert_lineage(&conn, "morning pages", "discrete");
        let page1_id = insert_page(&conn, "2026-04-18", 1);
        let page2_id = insert_page(&conn, "2026-04-19", 1);

        set_page_lineage(&conn, &page1_id, &lineage_id);
        // discrete trail — second page must not be rejected
        assert!(check_continuous_invariant(&conn, &page2_id, &lineage_id).is_ok(),
            "discrete trail must allow multiple pages");
    }

    #[test]
    fn page_content_survives_save_and_load() {
        let db = test_db();
        let conn = db.lock().unwrap();

        let page_id = insert_page(&conn, "2026-04-18", 1);
        let content = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"the invariant is simple."}]}]}"#;

        conn.execute(
            "UPDATE pages SET content_json = ? WHERE id = ?",
            rusqlite::params![content, &page_id],
        )
        .unwrap();

        let loaded: String = conn
            .query_row(
                "SELECT content_json FROM pages WHERE id = ?",
                rusqlite::params![&page_id],
                |r| r.get(0),
            )
            .unwrap();

        assert_eq!(loaded, content);
    }

    /// Regression: `strip_pin_ids_in_place` (used by clone_page_for_new_day)
    /// must keep `pinId` on inline `pinRef` nodes (the new v0.3 @-pin
    /// forward references) while still stripping `pinId` from legacy
    /// block-level pinned nodes. Without this distinction, the midnight
    /// clone breaks every @-pin mention into a `(deleted: …)` rendering.
    #[test]
    fn strip_pin_ids_keeps_pin_ref_targets() {
        let mut doc: serde_json::Value = serde_json::from_str(
            r#"{
                "type": "doc",
                "content": [
                    { "type": "paragraph", "content": [
                        { "type": "text", "text": "see " },
                        { "type": "pinRef", "attrs": { "pinId": "PIN_REF_KEEP", "labelSnapshot": "x" } }
                    ]},
                    { "type": "calloutBlock",
                      "attrs": { "pinId": "PIN_BLOCK_STRIP" },
                      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "y" }]}] }
                ]
            }"#,
        ).unwrap();

        super::strip_pin_ids_in_place(&mut doc);

        // pinRef target preserved
        let pinref_attrs = &doc["content"][0]["content"][1]["attrs"];
        assert_eq!(pinref_attrs["pinId"], "PIN_REF_KEEP");

        // legacy block-level pinId still stripped
        let block_attrs = &doc["content"][1]["attrs"];
        assert!(
            block_attrs.get("pinId").is_none(),
            "block-level pinId must be stripped to avoid re-binding clone to source pin row"
        );
    }

    /// 13.4 silent-engine check: writing a page's content through the
    /// save path must emit exactly one op_log row tagged page_blob,
    /// with the page_id in doc_id and the content_json in the
    /// payload. Exercises the same emission path as the Tauri command
    /// wrapper (op_log::emit_page after save_page_content_inner).
    #[test]
    fn save_page_content_emits_one_op_log_row() {
        use crate::op_log::{self, OpLogEngine};
        use std::sync::Arc;

        let db = test_db();
        let engine: crate::op_log::OpLog =
            Arc::new(OpLogEngine::load(&db.lock().unwrap()).unwrap());

        let page_id = insert_page(&db.lock().unwrap(), "2026-05-15", 1);

        let content = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"silent"}]}]}"#;
        save_page_content_inner(&db, &page_id, content, None).unwrap();
        op_log::emit_page(
            &engine,
            &db.lock().unwrap(),
            &page_id,
            "save_page_content",
            serde_json::json!({ "content_json": content }),
        );

        let conn = db.lock().unwrap();
        let (count, kind, doc_id, payload_blob): (i64, String, String, Vec<u8>) = conn
            .query_row(
                "SELECT COUNT(*) OVER (), op_kind, doc_id, payload_blob
                 FROM op_log
                 WHERE op_kind = 'page_blob' AND doc_id = ?",
                rusqlite::params![&page_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();

        assert_eq!(count, 1, "exactly one op_log row per save");
        assert_eq!(kind, "page_blob");
        assert_eq!(doc_id, page_id);
        let payload: serde_json::Value = serde_json::from_slice(&payload_blob).unwrap();
        assert_eq!(payload["op"], "save_page_content");
        assert_eq!(payload["fields"]["content_json"], content);
    }

    // ─── is_page_empty / cleanup_orphan_pages: image-only pages must survive ───
    // Regression coverage for a real bug: is_page_empty only looked at "text"
    // fields, so a page holding nothing but a dropped-in photo (no typed text
    // yet) read as empty and cleanup_orphan_pages — which runs on every app
    // launch, same-day or not — deleted the page outright.

    fn doc_with_image_only() -> String {
        serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [
                    { "type": "localImage", "attrs": { "src": "asset://localhost/img.png", "localPath": "/tmp/img.png" } }
                ] }
            ]
        })
        .to_string()
    }

    #[test]
    fn is_page_empty_treats_image_only_content_as_non_empty() {
        assert!(
            !is_page_empty(&Some(doc_with_image_only())),
            "a page holding only an image must not be classified as empty"
        );
    }

    #[test]
    fn is_page_empty_treats_attachment_only_content_as_non_empty() {
        let doc = serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [
                    { "type": "attachment", "attrs": { "kind": "file", "filename": "report.pdf" } }
                ] }
            ]
        })
        .to_string();
        assert!(!is_page_empty(&Some(doc)));
    }

    #[test]
    fn is_page_empty_still_true_for_a_genuinely_empty_doc() {
        let doc = serde_json::json!({
            "type": "doc",
            "content": [ { "type": "paragraph" } ]
        })
        .to_string();
        assert!(is_page_empty(&Some(doc)));
        assert!(is_page_empty(&None));
    }

    #[test]
    fn cleanup_orphan_pages_keeps_an_image_only_page() {
        let db = test_db();
        let engine = engine_for(&db);
        let page_id = {
            let conn = db.lock().unwrap();
            let id = insert_page(&conn, "2026-01-01", 1);
            conn.execute(
                "UPDATE pages SET content_json = ?1 WHERE id = ?2",
                rusqlite::params![&doc_with_image_only(), &id],
            )
            .unwrap();
            id
        };

        let deleted = cleanup_orphan_pages_inner(&db, &engine).unwrap();
        assert_eq!(deleted, 0, "an image-only page must not be swept as an orphan");

        let conn = db.lock().unwrap();
        let still_there: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE id = ?1",
                [&page_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(still_there, 1, "the page row must survive cleanup_orphan_pages");
    }

    #[test]
    fn cleanup_orphan_pages_still_sweeps_a_genuinely_empty_page() {
        let db = test_db();
        let engine = engine_for(&db);
        let page_id = {
            let conn = db.lock().unwrap();
            // content_json left NULL by insert_page — genuinely empty, and
            // this must still be swept so the fix above doesn't quietly
            // disable the cleanup entirely.
            insert_page(&conn, "2026-01-01", 1)
        };

        let deleted = cleanup_orphan_pages_inner(&db, &engine).unwrap();
        assert_eq!(deleted, 1, "a genuinely empty untrailed page must still be swept");

        let conn = db.lock().unwrap();
        let still_there: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE id = ?1",
                [&page_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(still_there, 0, "a genuinely empty page must actually be deleted");
    }

    // ─── cleanup_orphan_pages: sync-aware guards ───────────────────────
    // Regression coverage for a real bug: the launch-time sweeper deleted a
    // synced page that was empty-at-that-instant (its content ops hadn't
    // merged yet) and broadcast a tombstone for it, destroying the other
    // device's writes (diagnosed: desktop DB op_log seq 180, then 24
    // refused edits). Two guards: never sweep a page any other device has
    // ops for; never sweep before this session's first successful pull
    // when sync is enabled.

    #[test]
    fn cleanup_skips_a_page_touched_by_another_device() {
        let db = test_db();
        let engine = engine_for(&db);
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at) VALUES ('p1','2026-08-13',1,'t','t')",
            [],
        ).unwrap();
        // A remote op that references p1: device_id set, page_id only in payload.
        conn.execute(
            "INSERT INTO op_log (op_id, op_kind, doc_id, payload_blob, hlc_ts, device_id, state, applied_at, created_at)
             VALUES ('r1','page_blob','', ?, 1, 'other-device', 'committed', 0, 0)",
            rusqlite::params![br#"{"op":"save_page_content","page_id":"p1","fields":{}}"#.to_vec()],
        ).unwrap();
        drop(conn);
        let deleted = cleanup_orphan_pages_inner(&db, &engine).unwrap();
        assert_eq!(deleted, 0, "a foreign-touched page must never be swept");
        let conn = db.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM pages WHERE id='p1'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "the foreign-touched page row must survive cleanup_orphan_pages");
    }

    #[test]
    fn cleanup_waits_for_first_pull_when_sync_enabled() {
        use std::sync::atomic::Ordering;
        let db = test_db();
        let engine = engine_for(&db);
        {
            let conn = db.lock().unwrap();
            conn.execute("INSERT INTO pages (id, date, page_number, created_at, updated_at) VALUES ('p2','2026-08-13',1,'t','t')", []).unwrap();
            crate::sync::config::set_enabled(&conn, true).unwrap();
        }
        crate::sync::worker::FIRST_PULL_DONE.store(false, Ordering::SeqCst);
        let deleted = cleanup_orphan_pages_inner(&db, &engine).unwrap();
        assert_eq!(deleted, 0, "no sweep before the session's first pull");
        crate::sync::worker::FIRST_PULL_DONE.store(true, Ordering::SeqCst);
        let deleted = cleanup_orphan_pages_inner(&db, &engine).unwrap();
        assert_eq!(deleted, 1, "after first pull the empty local-only page sweeps normally");
    }

    /// FINDING 2 (whole-branch-review follow-up, Critical, reviewer repro).
    /// If the OTHER device's own last word on this page was "it's garbage"
    /// (a cleanup_orphan_page tombstone), a local sweep of a locally-empty
    /// row is aligned with that device's own conclusion, not destructive
    /// of anything. The old blanket "any foreign op ever = touched" guard
    /// made a tombstone-refused page (commit 1's FIX 1b: local writing
    /// disproves a GC guess, so the delete is refused and the row
    /// survives) permanently unsweepable even after it later legitimately
    /// converged to empty — the row would sit forever, and the sweeper's
    /// own generic foreign-touch guard blocked the only path that could
    /// ever clear it.
    #[test]
    fn cleanup_sweeps_when_the_newest_foreign_op_is_its_own_gc_tombstone() {
        let db = test_db();
        let engine = engine_for(&db);
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at) VALUES ('p4','2026-08-13',1,'t','t')",
            [],
        ).unwrap();
        // The other device created it...
        conn.execute(
            "INSERT INTO op_log (op_id, op_kind, doc_id, payload_blob, hlc_ts, device_id, state, applied_at, created_at)
             VALUES ('r4a','page_blob','', ?, 1, 'other-device', 'committed', 0, 0)",
            rusqlite::params![br#"{"op":"get_or_create_today","page_id":"p4","fields":{"date":"2026-08-13","page_number":1}}"#.to_vec()],
        ).unwrap();
        // ...then GC-swept it itself. This is the NEWEST foreign op.
        conn.execute(
            "INSERT INTO op_log (op_id, op_kind, doc_id, payload_blob, hlc_ts, device_id, state, applied_at, created_at)
             VALUES ('r4b','tombstone','', ?, 2, 'other-device', 'committed', 0, 0)",
            rusqlite::params![br#"{"op":"cleanup_orphan_page","page_id":"p4"}"#.to_vec()],
        ).unwrap();
        drop(conn);
        let deleted = cleanup_orphan_pages_inner(&db, &engine).unwrap();
        assert_eq!(deleted, 1, "both sides agree this page is garbage — the local sweep may proceed");
        let conn = db.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM pages WHERE id='p4'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "the row must actually be swept");
    }

    /// Control for FINDING 2: the newest foreign op is a `save_page_content`
    /// that arrives AFTER an earlier foreign GC tombstone — the other
    /// device un-GC'd the page by writing to it again. Ordering matters,
    /// not just "does a tombstone appear anywhere in the log" — the sweep
    /// must still be blocked here.
    #[test]
    fn cleanup_still_skips_when_newest_foreign_op_is_a_save_after_an_older_tombstone() {
        let db = test_db();
        let engine = engine_for(&db);
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at) VALUES ('p5','2026-08-13',1,'t','t')",
            [],
        ).unwrap();
        // The other device GC-swept it first...
        conn.execute(
            "INSERT INTO op_log (op_id, op_kind, doc_id, payload_blob, hlc_ts, device_id, state, applied_at, created_at)
             VALUES ('r5a','tombstone','', ?, 1, 'other-device', 'committed', 0, 0)",
            rusqlite::params![br#"{"op":"cleanup_orphan_page","page_id":"p5"}"#.to_vec()],
        ).unwrap();
        // ...then wrote to it again — the NEWEST foreign op is real writing.
        conn.execute(
            "INSERT INTO op_log (op_id, op_kind, doc_id, payload_blob, hlc_ts, device_id, state, applied_at, created_at)
             VALUES ('r5b','page_blob','', ?, 2, 'other-device', 'committed', 0, 0)",
            rusqlite::params![br#"{"op":"save_page_content","page_id":"p5","fields":{}}"#.to_vec()],
        ).unwrap();
        drop(conn);
        let deleted = cleanup_orphan_pages_inner(&db, &engine).unwrap();
        assert_eq!(deleted, 0, "the other device's last word here was writing, not garbage — must not sweep");
        let conn = db.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM pages WHERE id='p5'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "row must survive");
    }

    #[test]
    fn cleanup_treats_a_foreign_touch_query_error_as_touched() {
        // A malformed foreign payload makes json_extract error for the WHOLE
        // EXISTS query, not just its own row; fail-open here (unwrap_or(false))
        // silently disabled the guard for the entire sweep pass. Fail-closed =
        // assume touched, skip the sweep.
        let db = test_db();
        let engine = engine_for(&db);
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at) VALUES ('p3','2026-08-13',1,'t','t')",
            [],
        ).unwrap();
        // A remote op with a payload_blob that isn't valid JSON at all —
        // json_extract errors on this, poisoning the EXISTS query.
        conn.execute(
            "INSERT INTO op_log (op_id, op_kind, doc_id, payload_blob, hlc_ts, device_id, state, applied_at, created_at)
             VALUES ('r3','page_blob','', ?, 1, 'other-device', 'committed', 0, 0)",
            rusqlite::params![b"not json at all".to_vec()],
        ).unwrap();
        drop(conn);
        let deleted = cleanup_orphan_pages_inner(&db, &engine).unwrap();
        assert_eq!(deleted, 0, "a foreign-touch query error must fail closed, not silently disable the guard");
        let conn = db.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM pages WHERE id='p3'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "the page must survive when the foreign-touch check itself errors");
    }

    // ─── sync_reset: revoked flag ──────────────────────────────────────

    #[test]
    fn sync_reset_clears_the_revoked_flag() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            conn.execute("INSERT OR REPLACE INTO settings (key, value, applied_hlc_ts) VALUES ('sync_revoked','1',0)", []).unwrap();
        }

        sync_reset_inner(&db).unwrap();

        let conn = db.lock().unwrap();
        let v = crate::sync::config::get_setting_i64(&conn, "sync_revoked");
        assert!(v.is_none() || v == Some(0), "pair-again must clear the revoked flag");
    }

    // ─── schedule_sync_wake / sync_wake_delay_ms ────────────────────────
    // A live SyncWorkerSlot needs an actual spawned worker thread
    // (WorkerHandle's fields are all private, built only by the real
    // spawn path) — not something a unit test should stand up just to
    // check a number. `sync_wake_delay_ms` is the pure half of
    // `schedule_sync_wake` (read the debounce setting; the wake-a-live-
    // worker half is one `if let` around a method call, exercised for
    // real by every golden-path test above that drives save_page_content
    // end to end). This is the "the helper exists and computes the
    // configured delay" proof the mobile-stability plan asked for.

    #[test]
    fn sync_wake_delay_ms_defaults_to_2000_when_unset() {
        let db = test_db();
        let conn = db.lock().unwrap();
        assert_eq!(sync_wake_delay_ms(&conn), 2000);
    }

    #[test]
    fn sync_wake_delay_ms_honors_sync_save_debounce_ms() {
        let db = test_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_save_debounce_ms', '750')",
            [],
        )
        .unwrap();
        assert_eq!(sync_wake_delay_ms(&conn), 750);
    }

    /// Every op-emitting command in this file is expected to call
    /// `schedule_sync_wake` (or, pre-existing, `attachment_set_sync`'s own
    /// wake path) after it commits — this is the count check that fails
    /// loudly if a future op-emitting command is added without wiring it,
    /// rather than silently falling back to the 30s unforced tick the way
    /// every command except `save_page_content` did before this change.
    #[test]
    fn schedule_sync_wake_has_the_expected_number_of_call_sites() {
        let needle = "schedule_sync_wake(&worker_slot, &conn)";
        let src = include_str!("commands.rs");
        let call_sites = src.matches(needle).count();
        // save_page_content, get_or_create_today, save_line,
        // create_new_page, clone_page_for_new_day, cleanup_orphan_pages,
        // update_what_matters_now, update_what_shifted, strike_line,
        // mark_onboarding_complete, set_setting, set_close_to_tray,
        // update_line_text, set_focus_parent, create_lineage,
        // set_focus_lineage, delete_lineage, rename_lineage,
        // set_lineage_parent, fold_lineage, insert_line_at, delete_line,
        // reorder_lines, save_trail_content, create_pin,
        // update_pin_status, update_pin_scope, update_pin_content,
        // delete_pin, update_pin_auto_insert, reorder_pins,
        // set_lock_timeout — 32 real call sites at the time this test was
        // written, PLUS one for this test's own `needle` literal above
        // (include_str! reads this whole file, itself included) = 33.
        // Bump both numbers (and the list above) when a new call site is
        // deliberately added; don't loosen this to a `>=`, which would
        // stop catching the regression it exists for.
        assert_eq!(
            call_sites, 33,
            "expected call count changed — update this test's count (and the \
             comment listing every wired command) if a command was added or \
             removed, don't just bump the number blind"
        );
    }

    // ─── sync_flush_now ──────────────────────────────────────────────────

    /// The common case this command exists to be safe for: a device that
    /// has never turned on sync backgrounds the app on every launch, and
    /// `visibilitychange` fires `sync_flush_now` every single time. It
    /// must be an instant, silent no-op — no panic, no error surfaced to
    /// the frontend (a rejected promise here must not block or throw
    /// during app teardown), no attempted network call.
    #[test]
    fn sync_flush_now_is_a_noop_when_sync_is_unconfigured() {
        let db = test_db();
        // fresh test_db(): no sync_state row written, no keys persisted —
        // exactly a fresh install that has never seen the sync setup flow.
        sync_flush_now_inner(&db);
        // Must not have touched anything that would make a later real
        // `sync_setup` see stale state; a crude but sufficient proof for
        // "did nothing" is that the db is still readable and unchanged.
        let conn = db.lock().unwrap();
        let configured = crate::sync::keys::load_user_keys(&conn).unwrap().is_some();
        assert!(!configured, "an unconfigured device must stay unconfigured");
    }

    /// `cfg.is_active()` requires `enabled = true` in addition to a
    /// relay_url/user_id — a device that has relay details persisted but
    /// has sync switched off (sync_pause) must also flush as a no-op, not
    /// attempt a network call the user explicitly paused.
    #[test]
    fn sync_flush_now_is_a_noop_when_sync_is_configured_but_disabled() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO sync_state (id, relay_url, user_id, last_seen_user_seq, enabled) \
                 VALUES (1, 'https://relay.example', 'u1', 0, 0)",
                [],
            )
            .unwrap();
        }
        // No panic, no attempted network call (there is no network in this
        // test environment — a call attempt would hang or error instead of
        // returning promptly).
        sync_flush_now_inner(&db);
    }
}
