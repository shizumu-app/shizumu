//! Full-text search: what gets indexed, and how a typed query reaches FTS5.
//!
//! Both halves used to live inline in `commands.rs`, and both were wrong in
//! ways that were invisible from the call site:
//!
//! **Indexing.** `extract_text_from_tiptap` collects `text` nodes and
//! nothing else. A block's title is not a text node — it is a node
//! ATTRIBUTE (`attrs.blockTitle`, see `extensions/block-title.js`), and an
//! attachment's filename likewise. So the one string a user writes
//! specifically to name a thing was the one string search could never find.
//! [`extract_search_text`] is the indexing-only companion that reads both.
//!
//! It is deliberately NOT the same function `is_page_empty` uses. Emptiness
//! decides whether `cleanup_orphan_pages` deletes a page, and widening what
//! counts as content there is a separate decision with a delete on the end
//! of it. Two callers, two questions, two functions.
//!
//! **Querying.** `search_pages` passed the user's raw keystrokes straight
//! into `pages_fts MATCH ?`. FTS5's query language treats `-` as NOT, `"`
//! as a phrase delimiter, `*` as a prefix, `:` as a column filter, and
//! `AND`/`OR`/`NOT`/`NEAR` as operators — so typing `don't` or `re-read` or
//! a lone `"` raised an FTS5 syntax error, which became `Err` from the
//! command, which Memory.svelte swallowed in a bare `catch {}`. The search
//! box simply stopped returning anything, with nothing shown and nothing
//! logged. [`fts_match_query`] takes the keystrokes as literal words.

use rusqlite::{params, Connection};
use serde_json::Value;

/// The settings key marking that the one-shot reindex has run. Bumping the
/// suffix re-runs it for every install — do that whenever
/// [`extract_search_text`] learns to index something new, or old pages keep
/// the narrower index they were written with.
pub const REINDEX_MARKER_KEY: &str = "fts_reindex_v2_block_titles";

// ─── indexing ────────────────────────────────────────────────────────────

/// Plain text for the FTS index: every text node, plus the strings that
/// live in node attributes and would otherwise never be searchable.
///
/// Returns `None` for a doc with nothing indexable, matching the shape the
/// FTS writers already expect.
pub fn extract_search_text(value: &Value) -> Option<String> {
    let mut out = Vec::new();
    collect(value, &mut out);
    if out.is_empty() {
        None
    } else {
        Some(out.join("\n"))
    }
}

/// Attributes holding user-visible strings. `blockTitle` is the title a
/// user types on a list / outline / q&a / code block; `filename` and `alt`
/// are how a user recognises an attached file or image, and are the only
/// words a picture contributes to a search at all.
///
/// An ALLOWLIST, not "every string attribute", and that is load-bearing:
/// INV-DATA-8 (see `tests/page_tests.rs`) requires that a dayMarker's
/// focus text — which lives in `attrs.whatMatters` — never enters the FTS
/// index. Indexing attributes wholesale would break that invariant
/// silently, so a new searchable attribute is an explicit decision made
/// here rather than something a new node type inherits by accident.
const INDEXED_ATTRS: &[&str] = &["blockTitle", "filename", "alt"];

fn collect(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(|v| v.as_str()) {
                out.push(text.to_string());
            }
            if let Some(attrs) = map.get("attrs").and_then(|v| v.as_object()) {
                for key in INDEXED_ATTRS {
                    if let Some(s) = attrs.get(*key).and_then(|v| v.as_str()) {
                        let s = s.trim();
                        if !s.is_empty() {
                            out.push(s.to_string());
                        }
                    }
                }
            }
            if let Some(content) = map.get("content").and_then(|v| v.as_array()) {
                for item in content {
                    collect(item, out);
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                collect(item, out);
            }
        }
        _ => {}
    }
}

// ─── querying ────────────────────────────────────────────────────────────

/// Turn what the user typed into an FTS5 MATCH expression that cannot
/// raise a syntax error.
///
/// Every run of alphanumeric characters becomes one double-quoted token —
/// quoting is what makes FTS5 read it as a literal string rather than as
/// syntax, and any `"` inside is doubled per FTS5's own escaping. Tokens
/// are ANDed, so more words narrow the result the way a search box should.
///
/// The LAST token gets a `*` prefix wildcard, and only the last one. This
/// is the search-as-you-type contract: the word still being typed should
/// match what it is becoming (`trai` finds `trail`), while the words
/// already finished are taken at face value. Prefixing every token instead
/// would make a two-letter word match most of the library and turn a
/// common stop word into a full-index scan.
///
/// Returns `None` when nothing survives tokenisation (empty input, or only
/// punctuation) — the caller should return no results rather than run a
/// query that means nothing.
pub fn fts_match_query(raw: &str) -> Option<String> {
    let tokens: Vec<String> = raw
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect();
    if tokens.is_empty() {
        return None;
    }
    let last = tokens.len() - 1;
    let parts: Vec<String> = tokens
        .iter()
        .enumerate()
        .map(|(i, t)| {
            // FTS5 escapes a double quote inside a quoted string by
            // doubling it. Tokenisation above already dropped every `"`,
            // so this is belt-and-braces against a future tokenizer that
            // keeps more characters.
            let escaped = t.replace('"', "\"\"");
            if i == last {
                format!("\"{escaped}\"*")
            } else {
                format!("\"{escaped}\"")
            }
        })
        .collect();
    Some(parts.join(" AND "))
}

// ─── one-shot reindex ────────────────────────────────────────────────────

/// Rewrite every page's FTS row from its stored `content_json` using
/// [`extract_search_text`].
///
/// Needed because `pages_fts` is a plain FTS5 table, not an
/// external-content one: the rows written before block titles were indexed
/// keep the narrower text they were written with forever, so a user's whole
/// existing library stays unsearchable by title until something rewrites
/// it. A SQL-only migration cannot do this — the text lives inside a JSON
/// blob only Rust parses.
///
/// Returns how many pages were reindexed.
pub fn reindex_all(conn: &Connection) -> Result<usize, String> {
    let rows: Vec<(String, Option<String>, Option<String>, Option<String>, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, content_json, what_matters_now, what_shifted, voice_memo_transcript
                 FROM pages",
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut done = 0usize;
    for (id, content_json, wmn, shifted, transcript) in rows {
        let text = content_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .and_then(|v| extract_search_text(&v))
            .unwrap_or_default();
        conn.execute("DELETE FROM pages_fts WHERE page_id = ?", params![&id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO pages_fts (page_id, content, what_matters_now, what_shifted, voice_memo_transcript)
             VALUES (?, ?, ?, ?, ?)",
            params![&id, &text, &wmn, &shifted, &transcript],
        )
        .map_err(|e| e.to_string())?;
        done += 1;
    }
    Ok(done)
}

/// Run [`reindex_all`] once per install, guarded by [`REINDEX_MARKER_KEY`].
/// Cheap enough to do inline at startup — it is one JSON parse per page and
/// no file I/O — but it is a no-op on every launch after the first.
pub fn reindex_once(conn: &Connection) -> Result<Option<usize>, String> {
    let already: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            params![REINDEX_MARKER_KEY],
            |row| row.get(0),
        )
        .ok();
    if already.is_some() {
        return Ok(None);
    }
    let n = reindex_all(conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        params![REINDEX_MARKER_KEY, "done"],
    )
    .map_err(|e| e.to_string())?;
    Ok(Some(n))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn text_of(v: Value) -> String {
        extract_search_text(&v).unwrap_or_default()
    }

    #[test]
    fn indexes_plain_text_nodes() {
        let doc = json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "hello world" }] }]
        });
        assert_eq!(text_of(doc), "hello world");
    }

    #[test]
    fn indexes_a_block_title_that_is_not_a_text_node() {
        // The regression this module exists for. `blockTitle` is a node
        // attribute, so the text-node-only walk never saw it and a user
        // could not find the block by the name they gave it.
        let doc = json!({
            "type": "doc",
            "content": [{
                "type": "list",
                "attrs": { "blockTitle": "reading list" },
                "content": [{
                    "type": "listItem",
                    "attrs": { "marker": "task" },
                    "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "finish chapter 3" }] }]
                }]
            }]
        });
        let out = text_of(doc);
        assert!(out.contains("reading list"), "block title missing from {out:?}");
        assert!(out.contains("finish chapter 3"));
    }

    #[test]
    fn indexes_a_titled_block_that_has_no_body_text_yet() {
        // A board named but not yet filled in is exactly the case where the
        // title is the ONLY thing to find it by.
        let doc = json!({
            "type": "doc",
            "content": [{ "type": "blockquote", "attrs": { "blockTitle": "open questions" }, "content": [] }]
        });
        assert_eq!(text_of(doc), "open questions");
    }

    #[test]
    fn indexes_attachment_filenames() {
        let doc = json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{
                    "type": "attachment",
                    "attrs": { "kind": "file", "filename": "lease-agreement.pdf", "blob_hash": "h" }
                }]
            }]
        });
        assert!(text_of(doc).contains("lease-agreement.pdf"));
    }

    #[test]
    fn ignores_blank_and_non_string_attrs() {
        let doc = json!({
            "type": "doc",
            "content": [{
                "type": "list",
                "attrs": { "blockTitle": "   ", "filename": null, "alt": 7 },
                "content": []
            }]
        });
        // Empty rather than a run of whitespace or a stringified 7: an
        // untitled block contributes nothing, and must not pad the index
        // with tokens the user never wrote.
        assert_eq!(extract_search_text(&doc), None);
    }

    #[test]
    fn returns_none_for_a_doc_with_nothing_indexable() {
        assert_eq!(extract_search_text(&json!({ "type": "doc", "content": [] })), None);
    }

    // ─── fts_match_query ────────────────────────────────────────────────

    #[test]
    fn quotes_a_single_word_and_prefixes_it() {
        assert_eq!(fts_match_query("trail").unwrap(), "\"trail\"*");
    }

    #[test]
    fn ands_words_and_prefixes_only_the_last() {
        // Search-as-you-type: the word still being typed should match what
        // it is becoming; the finished ones are taken at face value.
        assert_eq!(
            fts_match_query("reading li").unwrap(),
            "\"reading\" AND \"li\"*"
        );
    }

    #[test]
    fn survives_the_punctuation_that_used_to_raise_an_fts5_error() {
        // Each of these made `pages_fts MATCH ?` throw, which became an
        // Err the search box swallowed silently. They must now all be
        // literal words.
        assert_eq!(fts_match_query("don't").unwrap(), "\"don\" AND \"t\"*");
        assert_eq!(fts_match_query("re-read").unwrap(), "\"re\" AND \"read\"*");
        assert_eq!(fts_match_query("\"quoted\"").unwrap(), "\"quoted\"*");
        assert_eq!(fts_match_query("a:b").unwrap(), "\"a\" AND \"b\"*");
        assert_eq!(fts_match_query("(paren)").unwrap(), "\"paren\"*");
    }

    #[test]
    fn treats_fts5_operators_as_words_not_syntax() {
        // "NOT" typed in a search box means the word "not", not an operator
        // — and a bare trailing operator is itself an FTS5 syntax error.
        assert_eq!(fts_match_query("cats NOT").unwrap(), "\"cats\" AND \"NOT\"*");
        assert_eq!(fts_match_query("OR").unwrap(), "\"OR\"*");
    }

    #[test]
    fn returns_none_when_nothing_survives_tokenising() {
        // The caller returns an empty result set rather than running a
        // query that means nothing. Asserted as None (not as an empty
        // string) so a caller cannot mistake it for a match-everything.
        assert_eq!(fts_match_query(""), None);
        assert_eq!(fts_match_query("   "), None);
        assert_eq!(fts_match_query("--"), None);
        assert_eq!(fts_match_query("\"\""), None);
    }

    #[test]
    fn keeps_unicode_words_whole() {
        // `is_alphanumeric` is Unicode-aware; a Japanese or accented query
        // must not be shredded into single characters.
        assert_eq!(fts_match_query("沈む").unwrap(), "\"沈む\"*");
        assert_eq!(fts_match_query("café").unwrap(), "\"café\"*");
    }
}
