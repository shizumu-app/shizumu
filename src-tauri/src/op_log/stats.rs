//! Soak instrumentation — phase 13.9.
//!
//! `collect` reads a snapshot of the op-log engine's state out of
//! SQLite: total row count, count-by-kind, backfill flag, and HLC
//! cursor. The Tauri command `op_log_stats` exposes this to the
//! frontend (call from devtools during the bake week); the same
//! struct also lands in app logs at startup so bake-week monitoring
//! has a baseline without having to open the app.

use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct OpLogStats {
    pub total: i64,
    pub by_kind: Vec<KindCount>,
    pub backfill_complete: bool,
    pub hlc_physical_ms: Option<i64>,
    pub hlc_logical: Option<i64>,
    pub local_only: i64,
    /// Rows the merge path tried to apply but bounced (merge_error
    /// IS NOT NULL). Surfaces in the settings UI as a "replay"
    /// affordance so the user can re-run them after fixing the
    /// underlying schema mismatch.
    pub failed: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct KindCount {
    pub kind: String,
    pub count: i64,
}

pub fn collect(conn: &Connection) -> Result<OpLogStats, rusqlite::Error> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM op_log", [], |r| r.get(0))?;
    let local_only: i64 = conn.query_row(
        "SELECT COUNT(*) FROM op_log WHERE state = 'local_only'",
        [],
        |r| r.get(0),
    )?;
    let failed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM op_log WHERE merge_error IS NOT NULL",
        [],
        |r| r.get(0),
    )?;

    let by_kind: Vec<KindCount> = {
        let mut stmt = conn.prepare(
            "SELECT op_kind, COUNT(*) FROM op_log GROUP BY op_kind ORDER BY op_kind",
        )?;
        let rows: Vec<KindCount> = stmt
            .query_map([], |r| {
                Ok(KindCount {
                    kind: r.get(0)?,
                    count: r.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        rows
    };

    let backfill_complete: bool = conn
        .query_row(
            "SELECT value FROM op_log_meta WHERE key = 'backfill_complete'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "true")
        .unwrap_or(false);

    let (hlc_physical_ms, hlc_logical): (Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT physical_ms, logical FROM hlc_state WHERE id = 1",
            [],
            |r| Ok((Some(r.get(0)?), Some(r.get(1)?))),
        )
        .unwrap_or((None, None));

    Ok(OpLogStats {
        total,
        by_kind,
        backfill_complete,
        hlc_physical_ms,
        hlc_logical,
        local_only,
        failed,
    })
}

/// Format the stats as a single log-friendly line. Used at app boot
/// so the bake captures a baseline without needing the frontend
/// open.
pub fn format_log_line(stats: &OpLogStats) -> String {
    let kinds = stats
        .by_kind
        .iter()
        .map(|kc| format!("{}={}", kc.kind, kc.count))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "op_log_stats total={} local_only={} failed={} backfill={} hlc={:?}/{:?} kinds=[{}]",
        stats.total,
        stats.local_only,
        stats.failed,
        stats.backfill_complete,
        stats.hlc_physical_ms,
        stats.hlc_logical,
        kinds
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::op_log::OpLogEngine;
    use crate::test_helpers::{insert_lineage, insert_page, insert_pin, test_db};
    use std::sync::Arc;

    #[test]
    fn empty_db_returns_zeros() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let stats = collect(&conn).unwrap();
        assert_eq!(stats.total, 0);
        assert_eq!(stats.local_only, 0);
        assert!(stats.by_kind.is_empty());
        assert!(!stats.backfill_complete);
        assert!(stats.hlc_physical_ms.is_none());
    }

    #[test]
    fn after_backfill_returns_expected_shape() {
        let db = test_db();
        // Seed before backfill: 1 lineage, 1 page, 1 pin, 1 setting.
        {
            let conn = db.lock().unwrap();
            let lin = insert_lineage(&conn, "x", "discrete");
            let p = insert_page(&conn, "2026-05-15", 1);
            insert_pin(&conn, &lin, &p, "note", "hi");
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('k', 'v')",
                [],
            )
            .unwrap();
        }

        let engine = Arc::new(OpLogEngine::load(&db.lock().unwrap()).unwrap());
        crate::op_log::backfill::run(&db, &engine).unwrap();

        let conn = db.lock().unwrap();
        let stats = collect(&conn).unwrap();
        assert_eq!(stats.total, 4);
        assert!(stats.backfill_complete);
        assert!(stats.hlc_physical_ms.is_some());

        let by_kind: std::collections::HashMap<String, i64> = stats
            .by_kind
            .iter()
            .map(|kc| (kc.kind.clone(), kc.count))
            .collect();
        assert_eq!(by_kind.get("lineage_op"), Some(&1));
        assert_eq!(by_kind.get("page_blob"), Some(&1));
        assert_eq!(by_kind.get("pin_op"), Some(&1));
        assert_eq!(by_kind.get("setting_op"), Some(&1));
    }

    #[test]
    fn log_line_is_single_line_and_contains_totals() {
        let stats = OpLogStats {
            total: 7,
            by_kind: vec![
                KindCount {
                    kind: "page_blob".into(),
                    count: 5,
                },
                KindCount {
                    kind: "pin_op".into(),
                    count: 2,
                },
            ],
            backfill_complete: true,
            hlc_physical_ms: Some(1_700_000_000_000),
            hlc_logical: Some(3),
            local_only: 7,
            failed: 0,
        };
        let line = format_log_line(&stats);
        assert!(!line.contains('\n'), "must fit one log line");
        assert!(line.contains("total=7"));
        assert!(line.contains("backfill=true"));
        assert!(line.contains("page_blob=5"));
        assert!(line.contains("pin_op=2"));
    }
}
