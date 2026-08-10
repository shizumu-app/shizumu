//! op_log_audit — phase 13.8 soak-audit binary.
//!
//! Open a shizumu v0.3.0 database and report on op_log health:
//!
//!  - per-table source row counts vs per-kind op_log counts
//!  - bootstrap flags (backfill_complete, hlc_state)
//!  - silent-engine gaps: rows that exist in the source tables but
//!    have zero op_log entries pointing at them
//!  - replay-consistency check: derive each page's latest
//!    `content_json` from the op_log, compare to the actual `pages`
//!    row, count divergences
//!
//! Designed to run from a shell against the running db copy. Exits 0
//! if healthy, 1 if any warnings, 2 on usage/IO errors.
//!
//! Usage:
//!   op_log_audit <path/to/settles.db>
//!
//! v0.3 considers the source tables the source of truth — op_log is
//! the silent audit trail. v0.4 will invert this once the relay
//! streams ops from a peer; until then, this binary's job is to flag
//! drift so the bake week catches missing emission paths.

use rusqlite::Connection;
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: op_log_audit <path/to/settles.db>");
        return ExitCode::from(2);
    }

    let db_path = PathBuf::from(&args[1]);
    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("failed to open {}: {e}", db_path.display());
            return ExitCode::from(2);
        }
    };

    match audit(&conn, &db_path) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(e) => {
            eprintln!("audit failed: {e}");
            ExitCode::from(2)
        }
    }
}

fn audit(conn: &Connection, db_path: &PathBuf) -> Result<bool, rusqlite::Error> {
    let pages: i64 = conn.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0))?;
    let lineages: i64 = conn.query_row("SELECT COUNT(*) FROM lineages", [], |r| r.get(0))?;
    let pins: i64 = conn.query_row("SELECT COUNT(*) FROM shared_objects", [], |r| r.get(0))?;
    let settings: i64 = conn.query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))?;

    let op_log_total: i64 = conn.query_row("SELECT COUNT(*) FROM op_log", [], |r| r.get(0))?;
    let by_kind: Vec<(String, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT op_kind, COUNT(*) FROM op_log GROUP BY op_kind ORDER BY op_kind",
        )?;
        let rows: Vec<(String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        rows
    };

    let backfill_done: Option<String> = conn
        .query_row(
            "SELECT value FROM op_log_meta WHERE key = 'backfill_complete'",
            [],
            |r| r.get(0),
        )
        .ok();

    let hlc: Option<(i64, i64)> = conn
        .query_row(
            "SELECT physical_ms, logical FROM hlc_state WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    println!("=== shizumu op_log audit ===");
    println!("source DB: {}", db_path.display());
    println!();
    println!("source rows:");
    println!("  pages    {pages}");
    println!("  lineages {lineages}");
    println!("  pins     {pins}");
    println!("  settings {settings}");
    println!();
    println!("op_log: {op_log_total} total rows");
    for (kind, n) in &by_kind {
        println!("  {kind:<14} {n}");
    }
    println!();
    println!(
        "backfill_complete: {}",
        backfill_done.as_deref().unwrap_or("(unset)")
    );
    match hlc {
        Some((p, l)) => println!("hlc_state: physical_ms={p} logical={l}"),
        None => println!("hlc_state: (not yet emitted)"),
    }
    println!();

    // ------- silent-engine gap checks -------
    let mut warnings: Vec<String> = Vec::new();

    let pages_with_no_op: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pages p
         WHERE NOT EXISTS (SELECT 1 FROM op_log WHERE doc_id = p.id)",
        [],
        |r| r.get(0),
    )?;
    if pages_with_no_op > 0 {
        warnings.push(format!(
            "{pages_with_no_op} pages have no op_log entry — silent-engine gap"
        ));
    }

    let lineages_with_no_op: i64 = conn.query_row(
        "SELECT COUNT(*) FROM lineages l
         WHERE NOT EXISTS (SELECT 1 FROM op_log WHERE doc_id = l.id)",
        [],
        |r| r.get(0),
    )?;
    if lineages_with_no_op > 0 {
        warnings.push(format!(
            "{lineages_with_no_op} lineages have no op_log entry"
        ));
    }

    let pins_with_no_op: i64 = conn.query_row(
        "SELECT COUNT(*) FROM shared_objects p
         WHERE NOT EXISTS (SELECT 1 FROM op_log WHERE doc_id = p.id)",
        [],
        |r| r.get(0),
    )?;
    if pins_with_no_op > 0 {
        warnings.push(format!(
            "{pins_with_no_op} pins have no op_log entry"
        ));
    }

    // ------- replay-consistency check: page content_json -------
    //
    // For each page, find the latest page_blob op (by hlc_ts DESC) and
    // pull its content_json out of the payload. If the source page's
    // current content_json doesn't match, the engine missed an emission
    // somewhere. Drift here would mean v0.4 can't rebuild a peer device
    // from the log — that's the critical invariant.
    let mut stmt = conn.prepare(
        "SELECT p.id, p.content_json,
                (SELECT payload_blob FROM op_log
                 WHERE doc_id = p.id AND op_kind = 'page_blob'
                 ORDER BY hlc_ts DESC LIMIT 1) AS latest_blob
         FROM pages p",
    )?;
    let rows: Vec<(String, Option<String>, Option<Vec<u8>>)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let mut content_drift = 0i64;
    let mut content_compared = 0i64;
    for (page_id, source_content, latest_blob) in rows {
        let Some(blob) = latest_blob else {
            continue;
        };
        let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&blob) else {
            continue;
        };
        let Some(log_content) = payload
            .get("fields")
            .and_then(|f| f.get("content_json"))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        content_compared += 1;
        let source = source_content.as_deref().unwrap_or("");
        if log_content != source {
            content_drift += 1;
            if content_drift <= 3 {
                warnings.push(format!(
                    "page {page_id} content_json diverges from latest page_blob op"
                ));
            }
        }
    }
    println!(
        "content replay: {content_compared} pages compared, {content_drift} divergences"
    );
    if content_drift > 3 {
        warnings.push(format!(
            "{} additional content_json divergences (only first 3 listed)",
            content_drift - 3
        ));
    }

    println!();
    if warnings.is_empty() {
        println!("health: ok");
        Ok(true)
    } else {
        println!("health: WARN");
        for w in &warnings {
            println!("  ! {w}");
        }
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use std::fs;

    fn migrate(conn: &Connection) {
        let migrations: &[&str] = &[
            include_str!("../../migrations/001_initial.sql"),
            include_str!("../../migrations/002_settings.sql"),
            include_str!("../../migrations/003_focus_model.sql"),
            include_str!("../../migrations/004_session_markers.sql"),
            include_str!("../../migrations/005_blocks.sql"),
            include_str!("../../migrations/006_lineage.sql"),
            include_str!("../../migrations/007_content_json.sql"),
            include_str!("../../migrations/008_shared_objects.sql"),
            include_str!("../../migrations/009_shukonin_sessions.sql"),
            include_str!("../../migrations/010_trail_modes.sql"),
            include_str!("../../migrations/011_global_pins.sql"),
            include_str!("../../migrations/012_pin_auto_insert.sql"),
            include_str!("../../migrations/013_pin_pointer_semantics.sql"),
            include_str!("../../migrations/014_page_refs.sql"),
            include_str!("../../migrations/015_pin_refs.sql"),
            include_str!("../../migrations/016_op_log.sql"),
        ];
        for sql in migrations {
            for stmt in sql.split(';') {
                let trimmed = stmt.trim();
                if !trimmed.is_empty() {
                    let _ = conn.execute_batch(trimmed);
                }
            }
        }
    }

    /// Round-trip: empty migrated db is healthy (no rows means no
    /// drift). Establishes the audit() function's happy path so a
    /// future regression to the row counts or replay check shows up
    /// without requiring a real user db.
    #[test]
    fn empty_migrated_db_is_healthy() {
        let path = std::env::temp_dir().join("op_log_audit_smoke_empty.db");
        let _ = fs::remove_file(&path);
        let conn = Connection::open(&path).unwrap();
        migrate(&conn);
        assert_eq!(audit(&conn, &path).unwrap(), true);
        let _ = fs::remove_file(&path);
    }

    /// Seed a page + a matching page_blob op whose content_json
    /// matches the page row. Should be healthy (no drift).
    #[test]
    fn page_with_matching_log_is_healthy() {
        let path = std::env::temp_dir().join("op_log_audit_smoke_match.db");
        let _ = fs::remove_file(&path);
        let conn = Connection::open(&path).unwrap();
        migrate(&conn);

        let content = r#"{"type":"doc","content":[]}"#;
        conn.execute(
            "INSERT INTO pages (id, date, page_number, content_json, created_at, updated_at)
             VALUES ('p1', '2026-05-15', 1, ?, '2026-05-15T00:00:00Z', '2026-05-15T00:00:00Z')",
            params![content],
        )
        .unwrap();
        let payload =
            serde_json::json!({"op": "save_page_content", "fields": {"content_json": content}})
                .to_string();
        conn.execute(
            "INSERT INTO op_log
             (op_id, op_kind, doc_id, stream_id, payload_blob, hlc_ts, state, applied_at, created_at)
             VALUES ('op1', 'page_blob', 'p1', 1, ?, 1000, 'local_only', 0, 0)",
            params![payload.as_bytes()],
        )
        .unwrap();

        assert_eq!(audit(&conn, &path).unwrap(), true);
        let _ = fs::remove_file(&path);
    }

    /// Seed a page whose content_json has drifted from the latest
    /// page_blob op. Audit must flag the divergence (returns false).
    #[test]
    fn content_drift_is_flagged() {
        let path = std::env::temp_dir().join("op_log_audit_smoke_drift.db");
        let _ = fs::remove_file(&path);
        let conn = Connection::open(&path).unwrap();
        migrate(&conn);

        conn.execute(
            "INSERT INTO pages (id, date, page_number, content_json, created_at, updated_at)
             VALUES ('p1', '2026-05-15', 1, 'CURRENT', '2026-05-15T00:00:00Z', '2026-05-15T00:00:00Z')",
            [],
        )
        .unwrap();
        let payload = serde_json::json!({
            "op": "save_page_content",
            "fields": {"content_json": "STALE"}
        })
        .to_string();
        conn.execute(
            "INSERT INTO op_log
             (op_id, op_kind, doc_id, stream_id, payload_blob, hlc_ts, state, applied_at, created_at)
             VALUES ('op1', 'page_blob', 'p1', 1, ?, 1000, 'local_only', 0, 0)",
            params![payload.as_bytes()],
        )
        .unwrap();

        assert_eq!(audit(&conn, &path).unwrap(), false);
        let _ = fs::remove_file(&path);
    }
}

