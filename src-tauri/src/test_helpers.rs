use rusqlite::Connection;
use std::sync::{Arc, Mutex};

/// Creates a fresh in-memory SQLite connection with all migrations applied.
/// Each call returns an isolated database — no shared state between tests.
pub fn test_db() -> Arc<Mutex<Connection>> {
    let conn = Connection::open_in_memory()
        .expect("failed to create in-memory connection");
    apply_migrations(conn)
}

/// File-backed sibling of [`test_db`], for tests that must prove data
/// survives a connection teardown — the closest a unit test gets to the
/// app restart the retired WDIO golden path exercised. Call twice on the
/// same path: the second call reopens the existing file (migrations are
/// idempotent) and sees whatever the first wrote.
pub fn test_db_at(path: &std::path::Path) -> Arc<Mutex<Connection>> {
    let conn = Connection::open(path).expect("failed to open file-backed test db");
    apply_migrations(conn)
}

fn apply_migrations(conn: Connection) -> Arc<Mutex<Connection>> {
    // Run migrations inline (same as db.rs but without the shared_objects drop)
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
        // multi-line CREATE TABLE. Comments and empty statements are fine.
        let result = conn.execute_batch(migration_sql);
        if let Err(e) = result {
            let msg = e.to_string();
            if msg.contains("duplicate column") || msg.contains("already exists") {
                continue;
            }
            panic!("migration error: {msg}");
        }
    }

    // Migration 013: make shared_objects.source_page_id nullable (mirrors db.rs).
    // The applied_hlc_ts column added by migration 018 is preserved through
    // the recreate so the receive-side HLC gate works in tests too.
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
             applied_hlc_ts INTEGER NOT NULL DEFAULT 0,
             diverged INTEGER NOT NULL DEFAULT 0
         );
         INSERT INTO shared_objects_new
             SELECT id, lineage_id, source_page_id, object_type, title, content,
                    status, position, auto_insert, created_at, updated_at,
                    applied_hlc_ts, diverged
             FROM shared_objects;
         DROP TABLE shared_objects;
         ALTER TABLE shared_objects_new RENAME TO shared_objects;
         CREATE INDEX IF NOT EXISTS idx_shared_objects_lineage ON shared_objects(lineage_id);
         CREATE INDEX IF NOT EXISTS idx_shared_objects_page ON shared_objects(source_page_id);
         COMMIT;
         PRAGMA foreign_keys = ON;",
    )
    .expect("migration 013 failed");

    Arc::new(Mutex::new(conn))
}

/// Helper: insert a page and return its id
pub fn insert_page(conn: &Connection, date: &str, page_number: i64) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO pages (id, date, page_number, is_open, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
        rusqlite::params![&id, date, page_number, &now, &now],
    )
    .expect("failed to insert page");
    id
}

/// Helper: insert a lineage and return its id
pub fn insert_lineage(conn: &Connection, name: &str, mode: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO lineages (id, name, created_at, mode) VALUES (?, ?, ?, ?)",
        rusqlite::params![&id, name, &now, mode],
    )
    .expect("failed to insert lineage");
    id
}

/// Helper: insert a lineage with an explicit parent_id (for tree-shape tests).
pub fn insert_lineage_with_parent(
    conn: &Connection,
    name: &str,
    mode: &str,
    parent_id: &str,
) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO lineages (id, name, created_at, mode, parent_id) VALUES (?, ?, ?, ?, ?)",
        rusqlite::params![&id, name, &now, mode, parent_id],
    )
    .expect("failed to insert lineage with parent");
    id
}

/// Helper: assign a page to a lineage
pub fn set_page_lineage(conn: &Connection, page_id: &str, lineage_id: &str) {
    conn.execute(
        "UPDATE pages SET lineage_id = ? WHERE id = ?",
        rusqlite::params![lineage_id, page_id],
    )
    .expect("failed to set page lineage");
}

/// Helper: insert a pin and return its id
pub fn insert_pin(conn: &Connection, lineage_id: &str, page_id: &str, obj_type: &str, content: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO shared_objects (id, lineage_id, source_page_id, object_type, title, content, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', 0, ?, ?)",
        rusqlite::params![&id, lineage_id, page_id, obj_type, content, content, &now, &now],
    )
    .expect("failed to insert pin");
    id
}
