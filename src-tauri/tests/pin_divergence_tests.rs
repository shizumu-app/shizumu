//! Pin divergence (migration 020, `shared_objects.diverged`).
//!
//! A pin is a pointer into a page. When the page's content changes so the
//! pin's captured text no longer appears in the page, the pin has
//! *diverged* — the snapshot the user pinned and the live page have drifted
//! apart. `check_pin_divergence` (run on every page save via merge::apply)
//! sets the `diverged` flag so the UI can surface the drift and offer a
//! resolve action. These tests pin that contract (design:
//! docs/superpowers/plans/2026-05-28-pin-divergence.md).

use rusqlite::params;
use serde_json::json;
use shizumu_lib::sync::merge::{apply, MergeOutcome};
use shizumu_lib::test_helpers::*;

/// Build a `save_page_content` op blob for the merge engine.
fn save_page_op(page_id: &str, content_json: &str, hlc: i64) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "op": "save_page_content",
        "page_id": page_id,
        "fields": { "content_json": content_json },
        "hlc_ts": hlc,
    }))
    .unwrap()
}

fn doc_with_text(text: &str) -> String {
    json!({
        "type": "doc",
        "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }]
    })
    .to_string()
}

fn doc_with_pin(text: &str, pin_id: &str) -> String {
    json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "attrs": { "pinId": pin_id },
            "content": [{ "type": "text", "text": text }]
        }]
    })
    .to_string()
}

fn diverged_flag(conn: &rusqlite::Connection, pin_id: &str) -> i64 {
    conn.query_row(
        "SELECT diverged FROM shared_objects WHERE id = ?",
        params![pin_id],
        |r| r.get(0),
    )
    .unwrap()
}

/// A pin whose captured text no longer appears in the page is flagged
/// `diverged = 1` after the page is saved without it.
#[test]
fn pin_marked_diverged_when_page_drops_its_text() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lineage = insert_lineage(&conn, "trail", "discrete");
    let page = insert_page(&conn, "2026-05-20", 1);
    set_page_lineage(&conn, &page, &lineage);

    // Seed: page has a paragraph tagged with the pin's id.
    conn.execute(
        "UPDATE pages SET content_json = ?, applied_hlc_ts = 0 WHERE id = ?",
        params![doc_with_text("keepme please"), &page],
    )
    .unwrap();
    let pin = insert_pin(&conn, &lineage, &page, "note", "keepme");
    conn.execute(
        "UPDATE pages SET content_json = ?, applied_hlc_ts = 0 WHERE id = ?",
        params![doc_with_pin("keepme please", &pin), &page],
    )
    .unwrap();
    assert_eq!(diverged_flag(&conn, &pin), 0, "pin starts converged");

    // Save the page without the pin's id node → divergence.
    let out = apply(
        &conn,
        "page_blob",
        &save_page_op(&page, &doc_with_text("totally different now"), 100),
    )
    .unwrap();
    assert_eq!(out, MergeOutcome::Applied);
    assert_eq!(
        diverged_flag(&conn, &pin),
        1,
        "pin whose id node is removed from the doc must be marked diverged"
    );
}

/// A pin whose text is still present after a save stays converged
/// (`diverged = 0`) — and a previously-diverged pin re-converges when the
/// text comes back, since the flag is recomputed on every save.
#[test]
fn pin_stays_converged_and_can_reconverge() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lineage = insert_lineage(&conn, "trail", "discrete");
    let page = insert_page(&conn, "2026-05-20", 1);
    set_page_lineage(&conn, &page, &lineage);
    conn.execute(
        "UPDATE pages SET content_json = ?, applied_hlc_ts = 0 WHERE id = ?",
        params![doc_with_text("keepme please"), &page],
    )
    .unwrap();
    let pin = insert_pin(&conn, &lineage, &page, "note", "keepme");
    conn.execute(
        "UPDATE pages SET content_json = ?, applied_hlc_ts = 0 WHERE id = ?",
        params![doc_with_pin("keepme please", &pin), &page],
    )
    .unwrap();

    // Save with the pin's id node still present → stays converged.
    apply(
        &conn,
        "page_blob",
        &save_page_op(&page, &doc_with_pin("keepme and more", &pin), 100),
    )
    .unwrap();
    assert_eq!(diverged_flag(&conn, &pin), 0, "pin id node present → converged");

    // Drop the pin's id node → diverges.
    apply(
        &conn,
        "page_blob",
        &save_page_op(&page, &doc_with_text("gone"), 200),
    )
    .unwrap();
    assert_eq!(diverged_flag(&conn, &pin), 1, "pin id node dropped → diverged");

    // Bring the pin's id node back → re-converges (flag recomputed each save).
    apply(
        &conn,
        "page_blob",
        &save_page_op(&page, &doc_with_pin("keepme returns", &pin), 300),
    )
    .unwrap();
    assert_eq!(
        diverged_flag(&conn, &pin),
        0,
        "pin re-converges when its id node reappears in the doc"
    );
}
