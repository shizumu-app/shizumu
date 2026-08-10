// Extract a search-result snippet from a TipTap content_json blob.
// Used by Memory's ThreadCard to render `…before <strong>match</strong> after…`
// for the first occurrence of the query in the page body.
//
// Returns `null` when there's no content_json, no query, or no match — the
// caller falls back to whatever it was rendering before (preview_lines etc).

const DEFAULT_CONTEXT = 60; // chars before AND after the match

/**
 * Walk a TipTap doc and collect text nodes into a single string. Skips
 * structural decorators that aren't prose (dayMarkers, pinned blocks).
 */
export function flattenDocText(doc) {
  if (!doc || typeof doc !== "object") return "";
  const parts = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "dayMarker") return;
    if (node.attrs && node.attrs.pinId) return;
    if (typeof node.text === "string") {
      parts.push(node.text);
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
      // Newline between blocks so word boundaries stay clean.
      parts.push("\n");
    }
  }
  walk(doc);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/**
 * Find the first case-insensitive occurrence of `query` in the body text
 * extracted from `contentJson`, and return a window of context around it.
 *
 * Result shape: { before, match, after } where `match` carries the exact
 * casing as it appears in the source. Callers render `match` bolded.
 *
 * Returns `null` if no match.
 */
export function extractSnippetWithMatch(contentJson, query, contextChars = DEFAULT_CONTEXT) {
  if (!contentJson || !query) return null;
  const needle = (query || "").trim();
  if (!needle) return null;

  let doc;
  try {
    doc = typeof contentJson === "string" ? JSON.parse(contentJson) : contentJson;
  } catch {
    return null;
  }

  const text = flattenDocText(doc);
  if (!text) return null;

  const lowerHay = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const idx = lowerHay.indexOf(lowerNeedle);
  if (idx < 0) return null;

  const matchLen = needle.length;
  const beforeStart = Math.max(0, idx - contextChars);
  const afterEnd = Math.min(text.length, idx + matchLen + contextChars);
  const before = text.slice(beforeStart, idx);
  const match = text.slice(idx, idx + matchLen);
  const after = text.slice(idx + matchLen, afterEnd);

  return {
    before: beforeStart > 0 ? "…" + before : before,
    match,
    after: afterEnd < text.length ? after + "…" : after,
  };
}
