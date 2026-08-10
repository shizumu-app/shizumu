use serde_json::{json, Value};
use shizumu_lib::commands::clean_empty_markers_in_doc;

// Sentinel "today" date used by tests that exercise non-today markers.
// Picked to never match any test marker so the today-preservation rule
// doesn't accidentally save markers we expect to remove.
const NOT_TODAY: &str = "2099-01-01";

#[test]
fn marker_followed_by_real_text_is_kept() {
    let mut doc: Value = json!({
        "type": "doc",
        "content": [
            { "type": "dayMarker", "attrs": { "date": "2026-05-15", "whatMatters": "" } },
            { "type": "paragraph", "content": [{ "type": "text", "text": "today" }] }
        ]
    });
    let removed = clean_empty_markers_in_doc(&mut doc, NOT_TODAY);
    assert_eq!(removed, 0);
    assert_eq!(doc["content"].as_array().unwrap().len(), 2);
}

#[test]
fn marker_with_no_following_content_is_removed() {
    let mut doc: Value = json!({
        "type": "doc",
        "content": [
            { "type": "dayMarker", "attrs": { "date": "2026-05-15", "whatMatters": "" } },
            { "type": "paragraph" }
        ]
    });
    let removed = clean_empty_markers_in_doc(&mut doc, NOT_TODAY);
    assert_eq!(removed, 1);
    assert_eq!(doc["content"].as_array().unwrap().len(), 1);
}

#[test]
fn empty_marker_followed_by_another_marker_is_removed() {
    let mut doc: Value = json!({
        "type": "doc",
        "content": [
            { "type": "dayMarker", "attrs": { "date": "2026-05-14", "whatMatters": "" } },
            { "type": "dayMarker", "attrs": { "date": "2026-05-15", "whatMatters": "yo" } },
            { "type": "paragraph", "content": [{ "type": "text", "text": "today" }] }
        ]
    });
    let removed = clean_empty_markers_in_doc(&mut doc, NOT_TODAY);
    assert_eq!(removed, 1);
    let content = doc["content"].as_array().unwrap();
    assert_eq!(content.len(), 2);
    assert_eq!(content[0]["attrs"]["date"], "2026-05-15");
}

#[test]
fn whitespace_only_paragraphs_count_as_empty() {
    let mut doc: Value = json!({
        "type": "doc",
        "content": [
            { "type": "dayMarker", "attrs": { "date": "2026-05-15", "whatMatters": "" } },
            { "type": "paragraph", "content": [{ "type": "text", "text": "   \n  " }] }
        ]
    });
    let removed = clean_empty_markers_in_doc(&mut doc, NOT_TODAY);
    assert_eq!(removed, 1);
}

#[test]
fn no_markers_in_doc_returns_zero() {
    let mut doc: Value = json!({
        "type": "doc",
        "content": [
            { "type": "paragraph", "content": [{ "type": "text", "text": "hi" }] }
        ]
    });
    let removed = clean_empty_markers_in_doc(&mut doc, NOT_TODAY);
    assert_eq!(removed, 0);
}

#[test]
fn nested_text_in_block_counts() {
    let mut doc: Value = json!({
        "type": "doc",
        "content": [
            { "type": "dayMarker", "attrs": { "date": "2026-05-15", "whatMatters": "" } },
            { "type": "blockquote", "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "nested" }] }
            ]}
        ]
    });
    let removed = clean_empty_markers_in_doc(&mut doc, NOT_TODAY);
    assert_eq!(removed, 0);
}

#[test]
fn todays_empty_marker_is_preserved() {
    // The user assigned a continuous trail today and hasn't written yet.
    // On same-day reopen, today's marker must NOT be cleaned up — it
    // represents the user's active session, and the trail should stay
    // on today's rail.
    let today = "2026-05-16";
    let mut doc: Value = json!({
        "type": "doc",
        "content": [
            { "type": "dayMarker", "attrs": { "date": today, "whatMatters": "" } },
            { "type": "paragraph" }
        ]
    });
    let removed = clean_empty_markers_in_doc(&mut doc, today);
    assert_eq!(removed, 0);
    let content = doc["content"].as_array().unwrap();
    assert_eq!(content.len(), 2);
    assert_eq!(content[0]["attrs"]["date"], today);
}

#[test]
fn yesterdays_empty_marker_removed_even_when_today_present() {
    // Mixed case: yesterday's empty marker (no content for that day) is
    // removed; today's empty marker is preserved. Both share the same
    // canonical, so both rules need to apply in one pass.
    let today = "2026-05-16";
    let mut doc: Value = json!({
        "type": "doc",
        "content": [
            { "type": "dayMarker", "attrs": { "date": "2026-05-15", "whatMatters": "" } },
            { "type": "dayMarker", "attrs": { "date": today, "whatMatters": "" } },
            { "type": "paragraph" }
        ]
    });
    let removed = clean_empty_markers_in_doc(&mut doc, today);
    assert_eq!(removed, 1);
    let content = doc["content"].as_array().unwrap();
    assert_eq!(content.len(), 2);
    assert_eq!(content[0]["attrs"]["date"], today);
}
