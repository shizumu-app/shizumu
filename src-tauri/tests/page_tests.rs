use shizumu_lib::test_helpers::*;
use shizumu_lib::commands::{delete_focus_inner, save_page_content_inner};
use rusqlite::params;

// Helper: insert a fresh page and return its id without holding the lock
// (the *_inner functions lock the Db themselves, and std Mutex is not
// reentrant — holding the guard across an inner call would deadlock).
fn fresh_page(db: &shizumu_lib::db::Db, date: &str) -> String {
    let conn = db.lock().unwrap();
    insert_page(&conn, date, 1)
}

fn content_json(db: &shizumu_lib::db::Db, page_id: &str) -> String {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT content_json FROM pages WHERE id = ?",
        params![page_id],
        |r| r.get::<_, Option<String>>(0).map(|v| v.unwrap_or_default()),
    )
    .unwrap()
}

fn fts_match_count(db: &shizumu_lib::db::Db, term: &str) -> i64 {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT COUNT(*) FROM pages_fts WHERE pages_fts MATCH ?",
        params![term],
        |r| r.get(0),
    )
    .unwrap()
}

/// INV-DATA-2: page content_json round-trips byte-identically through
/// save → load → save when no edits occur.
#[test]
fn test_content_json_roundtrip() {
    let db = test_db();
    let page_id = fresh_page(&db, "2026-05-20");
    let content = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"alpha bravo"}]}]}"#;

    save_page_content_inner(&db, &page_id, content, None).unwrap();
    let loaded = content_json(&db, &page_id);
    assert_eq!(loaded, content, "INV-DATA-2 violated: save → load is not identity");

    // Re-saving the loaded content must not mutate it.
    save_page_content_inner(&db, &page_id, &loaded, None).unwrap();
    assert_eq!(
        content_json(&db, &page_id),
        content,
        "INV-DATA-2 violated: save → load → save is not byte-identical"
    );
}

/// INV-DATA-3: pages_fts stays in sync with pages.content_json across a
/// save and a delete — content is searchable after save and gone after
/// the page is deleted.
#[test]
fn test_fts_sync_after_save_and_delete() {
    let db = test_db();
    let page_id = fresh_page(&db, "2026-05-20");
    let content = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"alpha bravo charlie"}]}]}"#;

    save_page_content_inner(&db, &page_id, content, None).unwrap();
    assert_eq!(
        fts_match_count(&db, "bravo"),
        1,
        "INV-DATA-3 violated: saved content not indexed in pages_fts"
    );

    delete_focus_inner(&db, &page_id).unwrap();
    assert_eq!(
        fts_match_count(&db, "bravo"),
        0,
        "INV-DATA-3 violated: pages_fts row survived page deletion"
    );
    let conn = db.lock().unwrap();
    let pages: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pages WHERE id = ?",
            params![&page_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pages, 0, "page row must be removed on delete");
}

/// INV-DATA-8: dayMarker nodes carry their focus text in `attrs`, not as
/// a text node, so they never enter the FTS index. Real body text on the
/// same page still indexes.
#[test]
fn test_daymarker_excluded_from_fts() {
    let db = test_db();
    let page_id = fresh_page(&db, "2026-05-20");
    let content = r#"{"type":"doc","content":[{"type":"dayMarker","attrs":{"date":"2026-05-20","whatMatters":"secretmarkerfocus"}},{"type":"paragraph","content":[{"type":"text","text":"realbodytext"}]}]}"#;

    save_page_content_inner(&db, &page_id, content, None).unwrap();
    assert_eq!(
        fts_match_count(&db, "realbodytext"),
        1,
        "body paragraph text should be indexed"
    );
    assert_eq!(
        fts_match_count(&db, "secretmarkerfocus"),
        0,
        "INV-DATA-8 violated: dayMarker focus text leaked into pages_fts"
    );
}

#[test]
fn test_insert_and_query_page() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let page_id = insert_page(&conn, "2024-04-06", 1);

    let (id, date, page_number): (String, String, i64) = conn
        .query_row(
            "SELECT id, date, page_number FROM pages WHERE id = ?",
            params![&page_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();

    assert_eq!(id, page_id);
    assert_eq!(date, "2024-04-06");
    assert_eq!(page_number, 1);
}

#[test]
fn test_multiple_pages_same_date() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let id1 = insert_page(&conn, "2024-04-06", 1);
    let id2 = insert_page(&conn, "2024-04-06", 2);

    let mut stmt = conn
        .prepare("SELECT id FROM pages WHERE date = ? ORDER BY page_number ASC")
        .unwrap();
    let rows: Vec<String> = stmt
        .query_map(params!["2024-04-06"], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0], id1);
    assert_eq!(rows[1], id2);
}

#[test]
fn test_save_and_load_content_json() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let page_id = insert_page(&conn, "2024-04-06", 1);

    let content = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
    conn.execute(
        "UPDATE pages SET content_json = ? WHERE id = ?",
        params![content, &page_id],
    )
    .unwrap();

    let row: Option<String> = conn
        .query_row(
            "SELECT content_json FROM pages WHERE id = ?",
            params![&page_id],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(row, Some(content.to_string()));
}

#[test]
fn test_page_is_open_default() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let page_id = insert_page(&conn, "2024-04-06", 1);

    let is_open: bool = conn
        .query_row(
            "SELECT is_open FROM pages WHERE id = ?",
            params![&page_id],
            |row| row.get(0),
        )
        .unwrap();

    assert!(is_open, "New pages should be open by default");
}

#[test]
fn test_page_parent_id_chain() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let parent = insert_page(&conn, "2024-04-05", 1);
    let child = insert_page(&conn, "2024-04-06", 1);

    conn.execute(
        "UPDATE pages SET parent_id = ? WHERE id = ?",
        params![&parent, &child],
    )
    .unwrap();

    let parent_id: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM pages WHERE id = ?",
            params![&child],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(parent_id, Some(parent));
}

#[test]
fn test_delete_page_cascades_lines() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let page_id = insert_page(&conn, "2024-04-06", 1);

    // Insert a line
    conn.execute(
        "INSERT INTO lines (id, page_id, position, text, state, created_at) VALUES ('l1', ?, 0, 'hello', 'settled', '2024-04-06')",
        params![&page_id],
    )
    .unwrap();

    // Verify line exists
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM lines WHERE page_id = ?",
            params![&page_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);

    // Delete page — lines should cascade (or we delete manually as the app does)
    conn.execute(
        "DELETE FROM lines WHERE page_id = ?",
        params![&page_id],
    )
    .unwrap();
    conn.execute("DELETE FROM pages WHERE id = ?", params![&page_id])
        .unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM lines WHERE page_id = ?",
            params![&page_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pages WHERE id = ?",
            params![&page_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn test_what_matters_now() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let page_id = insert_page(&conn, "2024-04-06", 1);

    conn.execute(
        "UPDATE pages SET what_matters_now = ? WHERE id = ?",
        params!["thinking about architecture", &page_id],
    )
    .unwrap();

    let wmn: Option<String> = conn
        .query_row(
            "SELECT what_matters_now FROM pages WHERE id = ?",
            params![&page_id],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(wmn, Some("thinking about architecture".to_string()));
}
