use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub type Db = Arc<Mutex<Connection>>;

pub fn init_db(app_data_dir: PathBuf, passphrase: Option<&str>) -> Result<Db, String> {
    std::fs::create_dir_all(&app_data_dir).ok();

    // historically named settles.db — kept for backward compatibility
    let db_path = app_data_dir.join("settles.db");

    let conn = if db_path.exists() {
        // Try to open existing database
        match passphrase {
            Some(key) => {
                // Try encrypted first
                match crate::crypto::open_encrypted(&db_path, key) {
                    Ok(c) => c,
                    Err(_) => {
                        // Fall back to unencrypted (legacy db or failed migration)
                        log::info!("encrypted open failed, falling back to unencrypted");
                        let c = crate::crypto::open_unencrypted(&db_path)
                            .map_err(|e| format!("failed to open database: {e}"))?;
                        // Clean stale keyring entry since db is actually unencrypted
                        let _ = crate::crypto::delete_key();
                        c
                    }
                }
            }
            None => {
                // No passphrase — try unencrypted, if that fails it might be encrypted
                match crate::crypto::open_unencrypted(&db_path) {
                    Ok(c) => c,
                    Err(e) => {
                        return Err(format!(
                            "database appears to be encrypted — passphrase required: {e}"
                        ));
                    }
                }
            }
        }
    } else {
        // New database — create it as plain SQLite (no cipher pragmas)
        rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("failed to create database: {e}"))?
    };

    // Enable WAL mode for better concurrent read performance
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("failed to set WAL mode: {e}"))?;

    // Run migrations
    run_migrations(&conn)?;

    Ok(Arc::new(Mutex::new(conn)))
}

fn run_migrations(conn: &Connection) -> Result<(), String> {
    let migrations = [
        include_str!("../migrations/001_initial.sql"),
        include_str!("../migrations/002_settings.sql"),
        include_str!("../migrations/003_focus_model.sql"),
        include_str!("../migrations/004_session_markers.sql"),
        include_str!("../migrations/005_blocks.sql"),
        include_str!("../migrations/006_lineage.sql"),
        include_str!("../migrations/007_content_json.sql"),
        include_str!("../migrations/008_shared_objects.sql"),
        include_str!("../migrations/009_shukonin_sessions.sql"),
        include_str!("../migrations/010_trail_modes.sql"),
        include_str!("../migrations/011_global_pins.sql"),
        include_str!("../migrations/012_pin_auto_insert.sql"),
        include_str!("../migrations/013_pin_pointer_semantics.sql"),
        include_str!("../migrations/014_page_refs.sql"),
        include_str!("../migrations/015_pin_refs.sql"),
        include_str!("../migrations/016_op_log.sql"),
        include_str!("../migrations/017_sync_state.sql"),
        include_str!("../migrations/018_applied_hlc_ts.sql"),
        include_str!("../migrations/019_pages_yjs_state.sql"),
        include_str!("../migrations/020_pin_diverged.sql"),
        include_str!("../migrations/021_op_log_merge_error.sql"),
        include_str!("../migrations/022_sync_error_history.sql"),
        include_str!("../migrations/023_attachments.sql"),
        include_str!("../migrations/024_epochs.sql"),
        include_str!("../migrations/025_attachment_object_key.sql"),
        include_str!("../migrations/026_attachment_object_epoch.sql"),
        include_str!("../migrations/027_attachment_gc_swept.sql"),
        include_str!("../migrations/028_attachment_upload_backoff.sql"),
    ];

    for migration_sql in migrations {
        // execute_batch handles multi-statement scripts including
        // multi-line CREATE TABLE and SQL line comments natively.
        // ALTER TABLE may fail if column already exists — that's OK.
        let result = conn.execute_batch(migration_sql);
        if let Err(e) = result {
            let msg = e.to_string();
            if msg.contains("duplicate column") || msg.contains("already exists") {
                continue;
            }
            return Err(format!("migration error: {msg}"));
        }
    }

    // Migration 013: make shared_objects.source_page_id nullable.
    // SQLite does not support ALTER COLUMN, so we recreate the table only if
    // the column is still NOT NULL (i.e. this migration has not yet run).
    let needs_013 = conn
        .prepare("PRAGMA table_info(shared_objects)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| {
                let name: String = row.get(1)?;
                let notnull: i32 = row.get(3)?;
                Ok((name, notnull))
            })
            .and_then(|rows| {
                Ok(rows
                    .filter_map(|r| r.ok())
                    .any(|(name, notnull)| name == "source_page_id" && notnull == 1))
            })
        })
        .unwrap_or(false);

    if needs_013 {
        // Preserve applied_hlc_ts (migration 018) through the recreate
        // on a fresh DB. On an already-recreated DB, needs_013 is false
        // and this branch is skipped.
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             BEGIN;
             CREATE TABLE shared_objects_new (
                 id TEXT PRIMARY KEY,
                 lineage_id TEXT REFERENCES lineages(id),
                 source_page_id TEXT REFERENCES pages(id),
                 object_type TEXT NOT NULL,
                 title TEXT,
                 content TEXT NOT NULL,
                 status TEXT NOT NULL DEFAULT 'open',
                 position INTEGER NOT NULL DEFAULT 0,
                 auto_insert INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL,
                 applied_hlc_ts INTEGER NOT NULL DEFAULT 0
             );
             INSERT INTO shared_objects_new
                 SELECT id, lineage_id, source_page_id, object_type, title, content,
                        status, position, auto_insert, created_at, updated_at,
                        applied_hlc_ts
                 FROM shared_objects;
             DROP TABLE shared_objects;
             ALTER TABLE shared_objects_new RENAME TO shared_objects;
             CREATE INDEX IF NOT EXISTS idx_shared_objects_lineage ON shared_objects(lineage_id);
             CREATE INDEX IF NOT EXISTS idx_shared_objects_page ON shared_objects(source_page_id);
             COMMIT;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(|e| format!("migration 013 error: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_helpers::{insert_lineage, insert_page, insert_pin, test_db};
    use rusqlite::Connection;

    #[test]
    fn all_migrations_apply_cleanly() {
        let db = test_db();
        let conn = db.lock().unwrap();

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        for expected in &[
            "lineages",
            "lines",
            "pages",
            "shared_objects",
            "op_log",
            "op_log_meta",
            "hlc_state",
        ] {
            assert!(
                tables.iter().any(|t| t == expected),
                "missing table after migrations: {expected}"
            );
        }
    }

    /// Verifies that migration 016 (op_log foundation) applies cleanly on
    /// top of the v0.2.x schema (migrations 001-015) without disturbing
    /// existing pages / lineages / pins / lines data.
    ///
    /// Mirrors the upgrade path a real v0.2.16 user takes when they install
    /// v0.3.0 for the first time.
    #[test]
    fn op_log_migration_round_trip() {
        let conn = Connection::open_in_memory().expect("in-memory conn");

        // Apply migrations 001-015 only — this is the v0.2.x state right
        // before phase 13 lands.
        let pre_op_log = [
            include_str!("../migrations/001_initial.sql"),
            include_str!("../migrations/002_settings.sql"),
            include_str!("../migrations/003_focus_model.sql"),
            include_str!("../migrations/004_session_markers.sql"),
            include_str!("../migrations/005_blocks.sql"),
            include_str!("../migrations/006_lineage.sql"),
            include_str!("../migrations/007_content_json.sql"),
            include_str!("../migrations/008_shared_objects.sql"),
            include_str!("../migrations/009_shukonin_sessions.sql"),
            include_str!("../migrations/010_trail_modes.sql"),
            include_str!("../migrations/011_global_pins.sql"),
            include_str!("../migrations/012_pin_auto_insert.sql"),
            include_str!("../migrations/013_pin_pointer_semantics.sql"),
            include_str!("../migrations/014_page_refs.sql"),
            include_str!("../migrations/015_pin_refs.sql"),
        ];
        for sql in pre_op_log {
            for statement in sql.split(';') {
                let trimmed = statement.trim();
                if !trimmed.is_empty() {
                    let result = conn.execute_batch(trimmed);
                    if let Err(e) = result {
                        let msg = e.to_string();
                        if msg.contains("duplicate column") || msg.contains("already exists") {
                            continue;
                        }
                        panic!("pre-op_log migration failed: {msg}");
                    }
                }
            }
        }

        // Seed with realistic-looking v0.2.x data.
        let lineage_id = insert_lineage(&conn, "project alpha", "continuous");
        let page_a = insert_page(&conn, "2026-05-01", 1);
        let page_b = insert_page(&conn, "2026-05-02", 1);
        let _pin_id = insert_pin(&conn, &lineage_id, &page_a, "note", "json only — no xml");
        conn.execute(
            "UPDATE pages SET lineage_id = ? WHERE id IN (?, ?)",
            rusqlite::params![&lineage_id, &page_a, &page_b],
        )
        .expect("attach pages to lineage");

        // Snapshot row counts so we can verify nothing is disturbed.
        let pages_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0))
            .unwrap();
        let lineages_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM lineages", [], |r| r.get(0))
            .unwrap();
        let pins_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM shared_objects", [], |r| r.get(0))
            .unwrap();

        // Apply migration 016 — the op_log foundation.
        let op_log_sql = include_str!("../migrations/016_op_log.sql");
        for statement in op_log_sql.split(';') {
            let trimmed = statement.trim();
            if !trimmed.is_empty() {
                conn.execute_batch(trimmed)
                    .unwrap_or_else(|e| panic!("016_op_log.sql failed on: {trimmed}\n{e}"));
            }
        }

        // New tables exist.
        for table in &["op_log", "op_log_meta", "hlc_state"] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?",
                    rusqlite::params![table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "table {table} should exist after migration 016");
        }

        // Existing data untouched.
        let pages_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0))
            .unwrap();
        let lineages_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM lineages", [], |r| r.get(0))
            .unwrap();
        let pins_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM shared_objects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(pages_before, pages_after, "pages row count drifted");
        assert_eq!(lineages_before, lineages_after, "lineages row count drifted");
        assert_eq!(pins_before, pins_after, "shared_objects row count drifted");

        // op_log starts empty — eager backfill is 13.7's job, not the
        // migration's. The migration only adds the table.
        let op_log_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM op_log", [], |r| r.get(0))
            .unwrap();
        assert_eq!(op_log_rows, 0, "op_log should start empty after migration");

        // Migration 016 must be idempotent (running it twice is a no-op,
        // not an error — important for repeated app launches).
        for statement in op_log_sql.split(';') {
            let trimmed = statement.trim();
            if !trimmed.is_empty() {
                conn.execute_batch(trimmed)
                    .expect("016 should be idempotent on re-apply");
            }
        }
    }
}
