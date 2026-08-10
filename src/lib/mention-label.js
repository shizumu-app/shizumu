// Label assembly for the `@`-mention popup and the inline `pageRef` node.
// Pure JS — no DOM, no API. Easy to unit-test in isolation.

const MAX_PATH_PARTS = 3; // keep at most this many names visible without collapse
const COLLAPSE_GLYPH = "...";

/**
 * Walk a lineage's parent chain and return its names from root to leaf.
 * Returns [] when lineage_id is null/missing.
 *
 *   trailPathFor("c", [
 *     { id: "a", name: "alpha", parent_id: null },
 *     { id: "b", name: "beta",  parent_id: "a" },
 *     { id: "c", name: "gamma", parent_id: "b" },
 *   ]) // ["alpha", "beta", "gamma"]
 */
export function trailPathFor(lineageId, lineages) {
  if (!lineageId) return [];
  const byId = lineages instanceof Map ? lineages : new Map(lineages.map((l) => [l.id, l]));
  const names = [];
  let current = byId.get(lineageId);
  let hops = 0;
  while (current && hops < 1000) {
    names.unshift(current.name);
    if (!current.parent_id) break;
    current = byId.get(current.parent_id);
    hops += 1;
  }
  return names;
}

/**
 * Join a trail-path array into the displayed string. Collapses the middle
 * when the path has more than `MAX_PATH_PARTS` parts.
 *
 *   ["a"]                       → "a"
 *   ["a", "b", "c"]             → "a:b:c"
 *   ["a", "b", "c", "d"]        → "a:...:c:d"
 *   ["a", "b", "c", "d", "e"]   → "a:...:d:e"
 */
export function formatTrailPath(parts) {
  if (!parts || parts.length === 0) return "";
  if (parts.length <= MAX_PATH_PARTS) return parts.join(":");
  return [parts[0], COLLAPSE_GLYPH, parts[parts.length - 2], parts[parts.length - 1]].join(":");
}

/**
 * Build the display label for a page in the `@` dropdown and the `pageRef`
 * node. Accepts a page row (shape compatible with the Rust `MentionRow` —
 * `{ page_id, date, what_matters_now, lineage_id, lineage_mode }` —
 * plus the full lineages array).
 *
 * Rules:
 * - **continuous-trail page** → just `<trail-path>` (the canonical IS the
 *   trail; daily focus rotates so it's not a stable handle).
 * - **discrete page with focus** → `<trail-path>:<focus>`.
 * - **discrete page without focus** → `<trail-path>:<date>` (date fallback).
 * - **untrailed page with focus** → `<date>:<focus>`.
 * - **untrailed page without focus** → `<date>`.
 *
 * Focus text is trimmed; empty / whitespace-only counts as missing.
 */
export function buildMentionLabel({ page, lineages }) {
  const focus = (page.what_matters_now ?? "").trim();
  const hasFocus = focus.length > 0;
  const path = trailPathFor(page.lineage_id, lineages);
  const trailLabel = formatTrailPath(path);

  // Untrailed page: no trail path; the date is the anchor.
  if (!page.lineage_id || path.length === 0) {
    return hasFocus ? `${page.date}:${focus}` : page.date;
  }

  // Continuous trail: one row per trail, trail-path only.
  if (page.lineage_mode === "continuous") {
    return trailLabel;
  }

  // Discrete page: trail-path + focus (or date fallback).
  return hasFocus ? `${trailLabel}:${focus}` : `${trailLabel}:${page.date}`;
}
