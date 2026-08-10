use shizumu_lib::test_helpers::test_db;

#[test]
fn test_all_migrations_run_cleanly() {
    let db = test_db();
    let conn = db.lock().unwrap();

    // Verify core tables exist by querying them
    let page_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM pages", [], |row| row.get(0))
        .expect("pages table should exist");
    assert_eq!(page_count, 0);

    let lineage_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM lineages", [], |row| row.get(0))
        .expect("lineages table should exist");
    assert_eq!(lineage_count, 0);

    let pin_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM shared_objects", [], |row| row.get(0))
        .expect("shared_objects table should exist");
    assert_eq!(pin_count, 0);
}

#[test]
fn test_migrations_are_idempotent() {
    // test_db() runs all migrations; calling it succeeds means first run is fine.
    // To test idempotency we run the migration SQL a second time on the same connection.
    let db = test_db();
    let conn = db.lock().unwrap();

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
    ];

    for migration_sql in migrations {
        for statement in migration_sql.split(';') {
            let trimmed = statement.trim();
            if !trimmed.is_empty() {
                let result = conn.execute_batch(trimmed);
                if let Err(e) = result {
                    let msg = e.to_string();
                    if msg.contains("duplicate column") || msg.contains("already exists") {
                        continue;
                    }
                    panic!("Second migration run failed: {msg}");
                }
            }
        }
    }
}

#[test]
fn test_lineage_mode_column_exists() {
    let db = test_db();
    let conn = db.lock().unwrap();

    conn.execute(
        "INSERT INTO lineages (id, name, created_at, mode) VALUES ('t1', 'test', '2024-01-01', 'continuous')",
        [],
    )
    .expect("should be able to insert lineage with mode");

    let mode: String = conn
        .query_row("SELECT mode FROM lineages WHERE id = 't1'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(mode, "continuous");
}

#[test]
fn test_lineage_parent_id_column_exists() {
    let db = test_db();
    let conn = db.lock().unwrap();

    conn.execute(
        "INSERT INTO lineages (id, name, created_at, mode) VALUES ('parent', 'product', '2024-01-01', 'discrete')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO lineages (id, name, created_at, mode, parent_id) VALUES ('child', 'export api', '2024-01-01', 'continuous', 'parent')",
        [],
    )
    .expect("should be able to insert child lineage with parent_id");

    let parent_id: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM lineages WHERE id = 'child'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(parent_id, Some("parent".to_string()));
}
