use shizumu_lib::commands::search_pages_for_mention_inner;
use shizumu_lib::test_helpers::*;
use rusqlite::params;

fn set_focus(conn: &rusqlite::Connection, page_id: &str, focus: &str) {
    conn.execute(
        "UPDATE pages SET what_matters_now = ? WHERE id = ?",
        params![focus, page_id],
    )
    .unwrap();
}

fn touch_page_at(conn: &rusqlite::Connection, page_id: &str, ts: &str) {
    conn.execute(
        "UPDATE pages SET updated_at = ? WHERE id = ?",
        params![ts, page_id],
    )
    .unwrap();
}

#[test]
fn empty_query_returns_recent_first() {
    let db = test_db();
    let conn = db.lock().unwrap();

    let p_old = insert_page(&conn, "2026-04-10", 1);
    let p_mid = insert_page(&conn, "2026-04-15", 1);
    let p_new = insert_page(&conn, "2026-04-20", 1);
    touch_page_at(&conn, &p_old, "2026-04-10T10:00:00Z");
    touch_page_at(&conn, &p_mid, "2026-04-15T10:00:00Z");
    touch_page_at(&conn, &p_new, "2026-04-20T10:00:00Z");

    let rows = search_pages_for_mention_inner(&conn, "", 10).unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].page_id, p_new);
    assert_eq!(rows[1].page_id, p_mid);
    assert_eq!(rows[2].page_id, p_old);
}

#[test]
fn query_matches_lineage_name() {
    let db = test_db();
    let conn = db.lock().unwrap();

    let lineage = insert_lineage(&conn, "launch", "discrete");
    let unrelated = insert_lineage(&conn, "morning thinking", "discrete");
    let p_match = insert_page(&conn, "2026-04-20", 1);
    let p_skip = insert_page(&conn, "2026-04-21", 1);
    set_page_lineage(&conn, &p_match, &lineage);
    set_page_lineage(&conn, &p_skip, &unrelated);

    let rows = search_pages_for_mention_inner(&conn, "launch", 10).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].page_id, p_match);
}

#[test]
fn query_matches_what_matters_now() {
    let db = test_db();
    let conn = db.lock().unwrap();

    let p_match = insert_page(&conn, "2026-04-20", 1);
    let p_skip = insert_page(&conn, "2026-04-21", 1);
    set_focus(&conn, &p_match, "ship branching trails");
    set_focus(&conn, &p_skip, "morning ramble");

    let rows = search_pages_for_mention_inner(&conn, "BRANCHING", 10).unwrap();
    assert_eq!(rows.len(), 1, "case-insensitive substring match");
    assert_eq!(rows[0].page_id, p_match);
    assert_eq!(rows[0].what_matters_now.as_deref(), Some("ship branching trails"));
}

#[test]
fn limit_respected() {
    let db = test_db();
    let conn = db.lock().unwrap();

    for i in 0..10 {
        let pid = insert_page(&conn, &format!("2026-04-{:02}", 10 + i), 1);
        set_focus(&conn, &pid, "common token");
    }

    let rows = search_pages_for_mention_inner(&conn, "common", 3).unwrap();
    assert_eq!(rows.len(), 3, "limit caps the result set");
}

#[test]
fn untrailed_page_included() {
    let db = test_db();
    let conn = db.lock().unwrap();

    let p = insert_page(&conn, "2026-04-20", 1);
    set_focus(&conn, &p, "free thought");
    // No lineage set — it's untrailed.

    let rows = search_pages_for_mention_inner(&conn, "free", 10).unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].lineage_id.is_none());
    assert!(rows[0].lineage_mode.is_none());
}

#[test]
fn continuous_trail_canonical_returned_once() {
    let db = test_db();
    let conn = db.lock().unwrap();

    let lineage = insert_lineage(&conn, "journal", "continuous");
    // Continuous-trail invariant: at most one page per lineage. The canonical
    // is that single page. Empty-query should return it once with mode set.
    let canonical = insert_page(&conn, "2026-04-20", 1);
    set_page_lineage(&conn, &canonical, &lineage);
    set_focus(&conn, &canonical, "ongoing");

    let rows = search_pages_for_mention_inner(&conn, "journal", 10).unwrap();
    assert_eq!(rows.len(), 1, "one row per continuous trail");
    assert_eq!(rows[0].page_id, canonical);
    assert_eq!(rows[0].lineage_mode.as_deref(), Some("continuous"));
}

#[test]
fn empty_query_with_zero_limit_defaults_to_50() {
    let db = test_db();
    let conn = db.lock().unwrap();

    for i in 0..3 {
        insert_page(&conn, &format!("2026-04-{:02}", 10 + i), 1);
    }

    // limit <= 0 should default to 50 (not crash, not return everything).
    let rows = search_pages_for_mention_inner(&conn, "", 0).unwrap();
    assert_eq!(rows.len(), 3, "all three pages returned, capped by default 50");
}
