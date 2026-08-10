use shizumu_lib::test_helpers::*;
use shizumu_lib::commands;
use rusqlite::params;

#[test]
fn test_create_pin() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lineage_id = insert_lineage(&conn, "trail", "discrete");
    let page_id = insert_page(&conn, "2024-04-06", 1);
    let pin_id = insert_pin(&conn, &lineage_id, &page_id, "note", "remember this");

    let (obj_type, content, status): (String, String, String) = conn
        .query_row(
            "SELECT object_type, content, status FROM shared_objects WHERE id = ?",
            params![&pin_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();

    assert_eq!(obj_type, "note");
    assert_eq!(content, "remember this");
    assert_eq!(status, "open");
}

#[test]
fn test_get_pins_by_lineage() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lin1 = insert_lineage(&conn, "trail 1", "discrete");
    let lin2 = insert_lineage(&conn, "trail 2", "discrete");
    let page_id = insert_page(&conn, "2024-04-06", 1);

    insert_pin(&conn, &lin1, &page_id, "note", "pin a");
    insert_pin(&conn, &lin1, &page_id, "note", "pin b");
    insert_pin(&conn, &lin2, &page_id, "note", "pin c");

    let mut stmt = conn
        .prepare("SELECT content FROM shared_objects WHERE lineage_id = ?")
        .unwrap();
    let rows: Vec<String> = stmt
        .query_map(params![&lin1], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert_eq!(rows.len(), 2);
}

#[test]
fn test_update_pin_status() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lineage_id = insert_lineage(&conn, "trail", "discrete");
    let page_id = insert_page(&conn, "2024-04-06", 1);
    let pin_id = insert_pin(&conn, &lineage_id, &page_id, "note", "task");

    conn.execute(
        "UPDATE shared_objects SET status = 'closed' WHERE id = ?",
        params![&pin_id],
    )
    .unwrap();

    let status: String = conn
        .query_row(
            "SELECT status FROM shared_objects WHERE id = ?",
            params![&pin_id],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(status, "closed");
}

#[test]
fn test_update_pin_content() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lineage_id = insert_lineage(&conn, "trail", "discrete");
    let page_id = insert_page(&conn, "2024-04-06", 1);
    let pin_id = insert_pin(&conn, &lineage_id, &page_id, "note", "original");

    conn.execute(
        "UPDATE shared_objects SET content = ?, title = ? WHERE id = ?",
        params!["updated content", "updated", &pin_id],
    )
    .unwrap();

    let (content, title): (String, Option<String>) = conn
        .query_row(
            "SELECT content, title FROM shared_objects WHERE id = ?",
            params![&pin_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert_eq!(content, "updated content");
    assert_eq!(title, Some("updated".to_string()));
}

#[test]
fn test_delete_pin() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lineage_id = insert_lineage(&conn, "trail", "discrete");
    let page_id = insert_page(&conn, "2024-04-06", 1);
    let pin_id = insert_pin(&conn, &lineage_id, &page_id, "note", "delete me");

    conn.execute(
        "DELETE FROM shared_objects WHERE id = ?",
        params![&pin_id],
    )
    .unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM shared_objects WHERE id = ?",
            params![&pin_id],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(count, 0);
}

#[test]
fn test_pin_types() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lineage_id = insert_lineage(&conn, "trail", "discrete");
    let page_id = insert_page(&conn, "2024-04-06", 1);

    insert_pin(&conn, &lineage_id, &page_id, "note", "a note");
    insert_pin(&conn, &lineage_id, &page_id, "board", "{}");
    insert_pin(&conn, &lineage_id, &page_id, "table", "{}");

    let mut stmt = conn
        .prepare("SELECT content FROM shared_objects WHERE lineage_id = ? AND object_type = 'note'")
        .unwrap();
    let notes: Vec<String> = stmt
        .query_map(params![&lineage_id], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(notes.len(), 1);

    let mut stmt = conn
        .prepare("SELECT content FROM shared_objects WHERE lineage_id = ? AND object_type IN ('board', 'table')")
        .unwrap();
    let boards: Vec<String> = stmt
        .query_map(params![&lineage_id], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(boards.len(), 2);
}

#[test]
fn refresh_pin_caches_updates_cache_for_present_pin() {
    let db = test_db();
    let (page_id, pin_id) = {
        let conn = db.lock().unwrap();
        let lineage_id = insert_lineage(&conn, "trail", "discrete");
        let page_id = insert_page(&conn, "2024-04-06", 1);
        let pin_id = insert_pin(&conn, &lineage_id, &page_id, "board", r#"{"type":"list","attrs":{"pinId":"PIN1"},"content":[]}"#);
        conn.execute(
            "UPDATE shared_objects SET id = 'PIN1', title = 'old title' WHERE id = ?",
            params![&pin_id],
        )
        .unwrap();
        (page_id, pin_id.clone())
    };
    let _ = pin_id;

    let new_content = r#"{"type":"doc","content":[{"type":"list","attrs":{"pinId":"PIN1","blockTitle":"new title"},"content":[{"type":"listItem","attrs":{"marker":"task","checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"hi"}]}]}]}]}"#;
    commands::save_page_content_inner(&db, &page_id, new_content, None).unwrap();

    let conn = db.lock().unwrap();
    let (title, content): (Option<String>, String) = conn
        .query_row(
            "SELECT title, content FROM shared_objects WHERE id = 'PIN1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert_eq!(title.as_deref(), Some("new title"));
    assert!(content.contains("\"blockTitle\":\"new title\""), "content was: {content}");
    assert!(content.contains("\"checked\":true"), "content was: {content}");
}

#[test]
fn refresh_pin_caches_orphans_missing_pin() {
    let db = test_db();
    let (page_id, pin_id) = {
        let conn = db.lock().unwrap();
        let lineage_id = insert_lineage(&conn, "trail", "discrete");
        let page_id = insert_page(&conn, "2024-04-06", 1);
        let pin_id = insert_pin(&conn, &lineage_id, &page_id, "board", r#"{"type":"list","attrs":{"pinId":"PIN1"}}"#);
        conn.execute(
            "UPDATE shared_objects SET id = 'PIN1', title = 'kept', status = 'open' WHERE id = ?",
            params![&pin_id],
        )
        .unwrap();
        (page_id, pin_id.clone())
    };
    let _ = pin_id;

    let new_content = r#"{"type":"doc","content":[{"type":"paragraph","content":[]}]}"#;
    commands::save_page_content_inner(&db, &page_id, new_content, None).unwrap();

    let conn = db.lock().unwrap();
    let (status, title, _content): (String, Option<String>, String) = conn
        .query_row(
            "SELECT status, title, content FROM shared_objects WHERE id = 'PIN1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(status, "orphaned");
    assert_eq!(title.as_deref(), Some("kept"));
}

#[test]
fn deleting_a_page_orphans_its_pins_does_not_delete_them() {
    let db = test_db();
    let (page_id, pin_id) = {
        let conn = db.lock().unwrap();
        let lineage_id = insert_lineage(&conn, "test trail", "discrete");
        let page_id = insert_page(&conn, "2026-05-10", 1);
        let pin_id = insert_pin(&conn, &lineage_id, &page_id, "board", r#"{"type":"list"}"#);
        (page_id, pin_id)
    };

    commands::delete_focus_inner(&db, &page_id).unwrap();

    let conn = db.lock().unwrap();
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT status, content FROM shared_objects WHERE id = ?",
            rusqlite::params![&pin_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    assert_eq!(row.as_ref().map(|r| r.0.as_str()), Some("orphaned"));
    // Cache (content) is frozen at the previous state; the row is not deleted.
    assert!(row.is_some());
}

#[test]
fn deleting_a_page_does_not_orphan_already_closed_pins() {
    let db = test_db();
    let (page_id, pin_id) = {
        let conn = db.lock().unwrap();
        let lineage_id = insert_lineage(&conn, "test trail 2", "discrete");
        let page_id = insert_page(&conn, "2026-05-10", 2);
        let pin_id = insert_pin(&conn, &lineage_id, &page_id, "board", r#"{"type":"list"}"#);
        conn.execute(
            "UPDATE shared_objects SET status = 'closed' WHERE id = ?",
            rusqlite::params![&pin_id],
        )
        .unwrap();
        (page_id, pin_id)
    };

    commands::delete_focus_inner(&db, &page_id).unwrap();

    let conn = db.lock().unwrap();
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM shared_objects WHERE id = ?",
            rusqlite::params![&pin_id],
            |row| row.get(0),
        )
        .ok();
    // Closed pins are preserved as-is; the WHERE status != 'closed' clause protects them.
    assert_eq!(status.as_deref(), Some("closed"));
}

#[test]
fn save_trail_content_also_refreshes_pin_caches() {
    let db = test_db();
    let (page_id, pin_id) = {
        let conn = db.lock().unwrap();
        let lineage_id = insert_lineage(&conn, "continuous trail", "continuous");
        let page_id = insert_page(&conn, "2026-05-10", 1);
        let pin_id = insert_pin(
            &conn,
            &lineage_id,
            &page_id,
            "board",
            r#"{"type":"list","attrs":{"pinId":"PIN_TRAIL"},"content":[]}"#,
        );
        conn.execute(
            "UPDATE shared_objects SET id = 'PIN_TRAIL', title = 'old from trail' WHERE id = ?",
            params![&pin_id],
        )
        .unwrap();
        (page_id, pin_id.clone())
    };
    let _ = pin_id;

    let new_content = r#"{"type":"doc","content":[{"type":"list","attrs":{"pinId":"PIN_TRAIL","blockTitle":"new from trail"},"content":[{"type":"listItem","attrs":{"marker":"task","checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"x"}]}]}]}]}"#;
    commands::save_trail_content_inner(&db, "fake-lineage", &page_id, new_content).unwrap();

    let conn = db.lock().unwrap();
    let (title, content): (Option<String>, String) = conn
        .query_row(
            "SELECT title, content FROM shared_objects WHERE id = 'PIN_TRAIL'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert_eq!(title.as_deref(), Some("new from trail"));
    assert!(
        content.contains("\"blockTitle\":\"new from trail\""),
        "content was: {content}"
    );
}

/// Phase 9.3 — `reorder_pins` atomically rewrites the `position` column for
/// every id in the given list in 1-based order. Same scope is the caller's
/// responsibility; the command just trusts the list shape.
#[test]
fn test_reorder_persists() {
    let db = test_db();

    // Seed three pins in a known starting order (positions 1, 2, 3 assigned
    // by insert_pin's MAX(position)+1 logic).
    let (a_id, b_id, c_id) = {
        let conn = db.lock().unwrap();
        let lineage_id = insert_lineage(&conn, "trail", "discrete");
        let page_id = insert_page(&conn, "2024-04-06", 1);
        let a = insert_pin(&conn, &lineage_id, &page_id, "note", "first");
        let b = insert_pin(&conn, &lineage_id, &page_id, "note", "second");
        let c = insert_pin(&conn, &lineage_id, &page_id, "note", "third");
        (a, b, c)
    };

    // Reverse the order: c, b, a → positions 1, 2, 3 respectively.
    commands::reorder_pins_inner(&db, vec![c_id.clone(), b_id.clone(), a_id.clone()]).unwrap();

    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, position FROM shared_objects ORDER BY position ASC")
        .unwrap();
    let rows: Vec<(String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].0, c_id, "after reorder, c should be position 1");
    assert_eq!(rows[0].1, 1);
    assert_eq!(rows[1].0, b_id);
    assert_eq!(rows[1].1, 2);
    assert_eq!(rows[2].0, a_id);
    assert_eq!(rows[2].1, 3);
}

/// Phase 9.6 — saving a page whose content contains `pinRef` nodes
/// populates `pin_refs` for every distinct target pin id. Saving again
/// without those refs clears the rows (DELETE+INSERT sweep).
#[test]
fn test_pin_refs_index_maintained() {
    let db = test_db();

    let (source_page_id, pin_x, pin_y) = {
        let conn = db.lock().unwrap();
        let lineage_id = insert_lineage(&conn, "trail", "discrete");
        let target_page = insert_page(&conn, "2024-04-06", 1);
        let x = insert_pin(&conn, &lineage_id, &target_page, "note", "pin x");
        let y = insert_pin(&conn, &lineage_id, &target_page, "note", "pin y");
        let source = insert_page(&conn, "2024-04-07", 1);
        (source, x, y)
    };

    // Save a doc that references both pin_x and pin_y.
    let with_refs = format!(
        r#"{{"type":"doc","content":[{{"type":"paragraph","content":[
            {{"type":"text","text":"see "}},
            {{"type":"pinRef","attrs":{{"pinId":"{pin_x}","labelSnapshot":"pin x"}}}},
            {{"type":"text","text":" and "}},
            {{"type":"pinRef","attrs":{{"pinId":"{pin_y}","labelSnapshot":"pin y"}}}}
        ]}}]}}"#,
        pin_x = pin_x,
        pin_y = pin_y,
    );
    commands::save_page_content_inner(&db, &source_page_id, &with_refs, None).unwrap();

    let conn = db.lock().unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pin_refs WHERE source_page_id = ?",
            params![&source_page_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 2, "two pinRef nodes → two rows");
    drop(conn);

    // Save again without the refs. Sweep should clear them.
    let empty = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
    commands::save_page_content_inner(&db, &source_page_id, empty, None).unwrap();
    let conn = db.lock().unwrap();
    let after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pin_refs WHERE source_page_id = ?",
            params![&source_page_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(after, 0, "removing the refs should clear pin_refs rows");
}
