use shizumu_lib::commands::{get_backlinks_for_page_inner, refresh_page_refs};
use shizumu_lib::test_helpers::*;
use rusqlite::params;

fn doc_with_refs(refs: &[&str]) -> String {
    let mut content = vec![serde_json::json!({
        "type": "paragraph",
        "content": [{ "type": "text", "text": "hello" }]
    })];
    for r in refs {
        content.push(serde_json::json!({
            "type": "pageRef",
            "attrs": { "targetId": r, "labelSnapshot": "snap" }
        }));
    }
    serde_json::json!({ "type": "doc", "content": content }).to_string()
}

#[test]
fn refresh_inserts_refs() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let source = insert_page(&conn, "2026-05-10", 1);
    let t1 = insert_page(&conn, "2026-05-11", 1);
    let t2 = insert_page(&conn, "2026-05-12", 1);

    let doc = doc_with_refs(&[&t1, &t2]);
    refresh_page_refs(&conn, &source, &doc).unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM page_refs WHERE source_page_id = ?",
            params![&source],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn refresh_replaces_previous_refs() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let source = insert_page(&conn, "2026-05-10", 1);
    let t1 = insert_page(&conn, "2026-05-11", 1);
    let t2 = insert_page(&conn, "2026-05-12", 1);

    refresh_page_refs(&conn, &source, &doc_with_refs(&[&t1, &t2])).unwrap();
    // Remove t1, add nothing. Final state: only t2.
    refresh_page_refs(&conn, &source, &doc_with_refs(&[&t2])).unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM page_refs WHERE source_page_id = ?",
            params![&source],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);

    let only_target: String = conn
        .query_row(
            "SELECT target_page_id FROM page_refs WHERE source_page_id = ?",
            params![&source],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(only_target, t2);
}

#[test]
fn self_refs_ignored() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let source = insert_page(&conn, "2026-05-10", 1);

    refresh_page_refs(&conn, &source, &doc_with_refs(&[&source])).unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM page_refs WHERE source_page_id = ?",
            params![&source],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0, "self-reference must not be stored");
}

#[test]
fn dedupes_multiple_refs_to_same_target() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let source = insert_page(&conn, "2026-05-10", 1);
    let t1 = insert_page(&conn, "2026-05-11", 1);

    refresh_page_refs(&conn, &source, &doc_with_refs(&[&t1, &t1, &t1])).unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM page_refs WHERE source_page_id = ?",
            params![&source],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "same target multiple times = one row");
}

#[test]
fn get_backlinks_returns_referencing_pages() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let target = insert_page(&conn, "2026-05-12", 1);
    let source_a = insert_page(&conn, "2026-05-10", 1);
    let source_b = insert_page(&conn, "2026-05-11", 1);
    let unrelated = insert_page(&conn, "2026-05-13", 1);

    refresh_page_refs(&conn, &source_a, &doc_with_refs(&[&target])).unwrap();
    refresh_page_refs(&conn, &source_b, &doc_with_refs(&[&target])).unwrap();
    refresh_page_refs(&conn, &unrelated, &doc_with_refs(&[])).unwrap();

    let rows = get_backlinks_for_page_inner(&conn, &target).unwrap();
    assert_eq!(rows.len(), 2);
    let ids: std::collections::HashSet<String> = rows.iter().map(|r| r.page_id.clone()).collect();
    assert!(ids.contains(&source_a));
    assert!(ids.contains(&source_b));
    assert!(!ids.contains(&unrelated));
}

#[test]
fn get_backlinks_with_no_refs_is_empty() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let target = insert_page(&conn, "2026-05-10", 1);
    let rows = get_backlinks_for_page_inner(&conn, &target).unwrap();
    assert!(rows.is_empty());
}

#[test]
fn malformed_json_is_a_noop() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let source = insert_page(&conn, "2026-05-10", 1);
    refresh_page_refs(&conn, &source, "not json at all").unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM page_refs WHERE source_page_id = ?",
            params![&source],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}
