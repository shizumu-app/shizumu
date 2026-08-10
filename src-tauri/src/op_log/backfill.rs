//! Eager backfill — runs once on the first v0.3.0 launch.
//!
//! Walks the existing v0.2.x source tables (lineages, pages,
//! shared_objects, settings) and emits one op_log entry per row, so
//! the relay (when v0.4 wires it up) sees a complete history even for
//! users who haven't typed anything since upgrading.
//!
//! Chunked + background: each `run_batch` call processes up to
//! `batch_size` rows from the current cursor table, then releases the
//! DB mutex so the UI thread can interleave queries. The cursor is
//! persisted in `op_log_meta` so a partial backfill resumes across
//! launches. Per-row skip uses `op_log.doc_id` presence so a crash
//! mid-batch is safe.

use crate::db::Db;
use rusqlite::{params, OptionalExtension};

use super::{emit_lineage, emit_page, emit_pin, emit_setting, OpLog};

const BACKFILL_FLAG: &str = "backfill_complete";
const BACKFILL_CURSOR: &str = "backfill_cursor";

const CURSOR_LINEAGES: &str = "lineages";
const CURSOR_PAGES: &str = "pages";
const CURSOR_PINS: &str = "pins";
const CURSOR_SETTINGS: &str = "settings";
const CURSOR_DONE: &str = "done";

#[derive(Debug, Clone, Copy)]
pub struct BatchState {
    pub done: bool,
    pub processed: usize,
}

/// Process up to `batch_size` rows from the current cursor table and
/// return. Drops the DB mutex on return so callers can interleave
/// other work. Idempotent: the `backfill_complete` flag short-circuits
/// subsequent calls; per-table presence checks make individual
/// batches resumable across crashes.
pub fn run_batch(db: &Db, engine: &OpLog, batch_size: usize) -> Result<BatchState, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let done_flag: Option<String> = conn
        .query_row(
            "SELECT value FROM op_log_meta WHERE key = ?",
            params![BACKFILL_FLAG],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if done_flag.as_deref() == Some("true") {
        return Ok(BatchState {
            done: true,
            processed: 0,
        });
    }

    let cursor: String = conn
        .query_row(
            "SELECT value FROM op_log_meta WHERE key = ?",
            params![BACKFILL_CURSOR],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| CURSOR_LINEAGES.to_string());

    let mut next_cursor = cursor.clone();
    let processed: usize;

    match cursor.as_str() {
        CURSOR_LINEAGES => {
            processed = backfill_lineages(&conn, engine, batch_size)?;
            if processed < batch_size {
                next_cursor = CURSOR_PAGES.to_string();
            }
        }
        CURSOR_PAGES => {
            processed = backfill_pages(&conn, engine, batch_size)?;
            if processed < batch_size {
                next_cursor = CURSOR_PINS.to_string();
            }
        }
        CURSOR_PINS => {
            processed = backfill_pins(&conn, engine, batch_size)?;
            if processed < batch_size {
                next_cursor = CURSOR_SETTINGS.to_string();
            }
        }
        CURSOR_SETTINGS => {
            // Settings rows have no doc_id in op_log (setting_op uses
            // None) — we can't dedupe presence-style. Settings is
            // typically <10 rows so emit in one shot and advance.
            processed = backfill_settings(&conn, engine)?;
            next_cursor = CURSOR_DONE.to_string();
        }
        CURSOR_DONE | _ => {
            conn.execute(
                "INSERT OR REPLACE INTO op_log_meta (key, value) VALUES (?, ?)",
                params![BACKFILL_FLAG, "true"],
            )
            .map_err(|e| e.to_string())?;
            return Ok(BatchState {
                done: true,
                processed: 0,
            });
        }
    }

    // Persist the cursor every batch — even if it didn't advance —
    // so an inspection of op_log_meta after any batch shows the
    // explicit state rather than relying on the default-when-missing
    // fallback.
    conn.execute(
        "INSERT OR REPLACE INTO op_log_meta (key, value) VALUES (?, ?)",
        params![BACKFILL_CURSOR, &next_cursor],
    )
    .map_err(|e| e.to_string())?;

    let done = next_cursor == CURSOR_DONE && processed == 0;
    if done {
        conn.execute(
            "INSERT OR REPLACE INTO op_log_meta (key, value) VALUES (?, ?)",
            params![BACKFILL_FLAG, "true"],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(BatchState { done, processed })
}

/// Convenience: drive `run_batch` to completion synchronously. Tests
/// use this; the runtime uses `run_background` instead.
pub fn run(db: &Db, engine: &OpLog) -> Result<usize, String> {
    let mut total = 0usize;
    loop {
        let state = run_batch(db, engine, 1000)?;
        total += state.processed;
        if state.done {
            return Ok(total);
        }
    }
}

/// Spawn a background thread that drives `run_batch` to completion
/// with a 10ms sleep between batches so the UI thread can interleave
/// queries on the shared DB mutex. Returns immediately. Failures are
/// logged at warn-level; the thread exits without retrying so a
/// persistent fault doesn't busy-spin.
pub fn run_background(db: Db, engine: OpLog) {
    std::thread::spawn(move || {
        const BATCH: usize = 100;
        loop {
            match run_batch(&db, &engine, BATCH) {
                Ok(state) => {
                    if state.done {
                        log::info!("op_log backfill complete");
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(e) => {
                    log::warn!("op_log backfill batch failed (silent): {e}");
                    return;
                }
            }
        }
    });
}

fn backfill_lineages(
    conn: &rusqlite::Connection,
    engine: &OpLog,
    batch_size: usize,
) -> Result<usize, String> {
    // Skip rows already emitted (resume after crash).
    let rows: Vec<(String, String, Option<String>, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, mode, parent_id FROM lineages
                 WHERE id NOT IN (SELECT doc_id FROM op_log WHERE doc_id IS NOT NULL)
                 LIMIT ?",
            )
            .map_err(|e| e.to_string())?;
        let rs = stmt
            .query_map(params![batch_size as i64], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        rs
    };

    let n = rows.len();
    for (id, name, mode, parent_id) in rows {
        emit_lineage(
            engine,
            conn,
            &id,
            "backfill_create_lineage",
            serde_json::json!({
                "name": name,
                "mode": mode,
                "parent_id": parent_id,
            }),
        );
    }
    Ok(n)
}

fn backfill_pages(
    conn: &rusqlite::Connection,
    engine: &OpLog,
    batch_size: usize,
) -> Result<usize, String> {
    let rows: Vec<(
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, date, page_number, content_json, what_matters_now, lineage_id
                 FROM pages
                 WHERE id NOT IN (SELECT doc_id FROM op_log WHERE doc_id IS NOT NULL)
                 LIMIT ?",
            )
            .map_err(|e| e.to_string())?;
        let rs = stmt
            .query_map(params![batch_size as i64], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        rs
    };

    let n = rows.len();
    for (id, date, page_number, content_json, what_matters_now, lineage_id) in rows {
        emit_page(
            engine,
            conn,
            &id,
            "backfill_page_initial_state",
            serde_json::json!({
                "date": date,
                "page_number": page_number,
                "content_json": content_json,
                "what_matters_now": what_matters_now,
                "lineage_id": lineage_id,
            }),
        );
    }
    Ok(n)
}

fn backfill_pins(
    conn: &rusqlite::Connection,
    engine: &OpLog,
    batch_size: usize,
) -> Result<usize, String> {
    let rows: Vec<(
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        String,
    )> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, lineage_id, source_page_id, object_type, title, content
                 FROM shared_objects
                 WHERE id NOT IN (SELECT doc_id FROM op_log WHERE doc_id IS NOT NULL)
                 LIMIT ?",
            )
            .map_err(|e| e.to_string())?;
        let rs = stmt
            .query_map(params![batch_size as i64], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        rs
    };

    let n = rows.len();
    for (id, lineage_id, source_page_id, object_type, title, content) in rows {
        emit_pin(
            engine,
            conn,
            &id,
            "backfill_create_pin",
            serde_json::json!({
                "lineage_id": lineage_id,
                "source_page_id": source_page_id,
                "object_type": object_type,
                "title": title,
                "content": content,
            }),
        );
    }
    Ok(n)
}

fn backfill_settings(conn: &rusqlite::Connection, engine: &OpLog) -> Result<usize, String> {
    let rows: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings")
            .map_err(|e| e.to_string())?;
        let rs = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        rs
    };

    let n = rows.len();
    for (key, value) in rows {
        emit_setting(engine, conn, &key, Some(&value));
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::op_log::OpLogEngine;
    use crate::test_helpers::{insert_lineage, insert_page, insert_pin, test_db};
    use std::sync::Arc;

    fn make_engine(db: &Db) -> OpLog {
        Arc::new(OpLogEngine::load(&db.lock().unwrap()).unwrap())
    }

    fn count_op_log(db: &Db) -> i64 {
        db.lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM op_log", [], |r| r.get(0))
            .unwrap()
    }

    fn count_meta(db: &Db, key: &str) -> Option<String> {
        db.lock()
            .unwrap()
            .query_row(
                "SELECT value FROM op_log_meta WHERE key = ?",
                params![key],
                |r| r.get(0),
            )
            .ok()
    }

    #[test]
    fn empty_db_backfill_marks_complete_with_zero_ops() {
        let db = test_db();
        let engine = make_engine(&db);

        let emitted = run(&db, &engine).unwrap();
        assert_eq!(emitted, 0);
        assert_eq!(count_op_log(&db), 0);
        assert_eq!(count_meta(&db, BACKFILL_FLAG).as_deref(), Some("true"));
    }

    #[test]
    fn seeded_db_backfill_emits_one_op_per_row_and_only_once() {
        let db = test_db();
        let engine = make_engine(&db);

        {
            let conn = db.lock().unwrap();
            let lin = insert_lineage(&conn, "morning pages", "discrete");
            let p1 = insert_page(&conn, "2026-05-01", 1);
            let _p2 = insert_page(&conn, "2026-05-02", 1);
            insert_pin(&conn, &lin, &p1, "note", "hello");
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('lock_timeout_minutes', '30')",
                [],
            )
            .unwrap();
        }

        let emitted = run(&db, &engine).unwrap();
        // 1 lineage + 2 pages + 1 pin + 1 setting = 5
        assert_eq!(emitted, 5);
        assert_eq!(count_op_log(&db), 5);

        let conn = db.lock().unwrap();
        let by_kind: std::collections::HashMap<String, i64> = {
            let mut stmt = conn
                .prepare("SELECT op_kind, COUNT(*) FROM op_log GROUP BY op_kind")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert_eq!(by_kind.get("lineage_op"), Some(&1));
        assert_eq!(by_kind.get("page_blob"), Some(&2));
        assert_eq!(by_kind.get("pin_op"), Some(&1));
        assert_eq!(by_kind.get("setting_op"), Some(&1));
        drop(conn);

        let emitted_again = run(&db, &engine).unwrap();
        assert_eq!(emitted_again, 0);
        assert_eq!(count_op_log(&db), 5);
    }

    /// Chunked semantics: with a small batch size, run_batch processes
    /// only that many rows per call, persists the cursor, and resumes
    /// on the next call. The DB lock is released between batches.
    #[test]
    fn run_batch_chunks_and_persists_cursor() {
        let db = test_db();
        let engine = make_engine(&db);

        {
            let conn = db.lock().unwrap();
            for i in 0..5 {
                let _ = insert_lineage(&conn, &format!("lin-{i}"), "discrete");
            }
            for i in 0..7 {
                let _ = insert_page(&conn, "2026-05-15", i + 1);
            }
        }

        // First batch: 3 lineages
        let s1 = run_batch(&db, &engine, 3).unwrap();
        assert_eq!(s1.processed, 3);
        assert_eq!(s1.done, false);
        assert_eq!(count_meta(&db, BACKFILL_CURSOR).as_deref(), Some("lineages"));

        // Second batch: 2 remaining lineages, advances cursor to pages
        let s2 = run_batch(&db, &engine, 3).unwrap();
        assert_eq!(s2.processed, 2);
        assert_eq!(s2.done, false);
        assert_eq!(count_meta(&db, BACKFILL_CURSOR).as_deref(), Some("pages"));

        // Third batch: 3 pages
        let s3 = run_batch(&db, &engine, 3).unwrap();
        assert_eq!(s3.processed, 3);
        assert_eq!(s3.done, false);

        // Drive remaining batches to completion.
        let mut total = s1.processed + s2.processed + s3.processed;
        loop {
            let s = run_batch(&db, &engine, 3).unwrap();
            total += s.processed;
            if s.done {
                break;
            }
        }
        assert_eq!(total, 12, "5 lineages + 7 pages");
        assert_eq!(count_meta(&db, BACKFILL_FLAG).as_deref(), Some("true"));
    }

    /// Resume after crash: simulate a partial backfill by manually
    /// setting the cursor to pages with only 3/5 lineages emitted.
    /// The presence check (`doc_id NOT IN op_log`) must skip the 3
    /// already-emitted ones on resume — no duplicates.
    #[test]
    fn run_batch_resumes_without_duplicates_after_partial() {
        let db = test_db();
        let engine = make_engine(&db);

        let mut lineage_ids: Vec<String> = Vec::new();
        {
            let conn = db.lock().unwrap();
            for i in 0..5 {
                lineage_ids.push(insert_lineage(&conn, &format!("lin-{i}"), "discrete"));
            }
        }

        // Crash mid-lineages — emit 3 ops manually, leave cursor on lineages.
        let s = run_batch(&db, &engine, 3).unwrap();
        assert_eq!(s.processed, 3);
        assert_eq!(count_op_log(&db), 3);

        // Resume: next batch processes the remaining 2, advances to pages.
        let s2 = run_batch(&db, &engine, 10).unwrap();
        assert_eq!(s2.processed, 2);
        // Each lineage emitted exactly once — no duplicates.
        let conn = db.lock().unwrap();
        for id in &lineage_ids {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM op_log WHERE doc_id = ?",
                    params![id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "each lineage backfilled exactly once");
        }
    }
}
