// Static doc → HTML renderer. Wraps TipTap's `generateHTML` with the
// canonical READONLY_EXTENSIONS so previews never drift from the live
// editor's schema, and memoizes by (page_id, updated_at) so Memory can
// re-render its visible cards on scroll/sort without reparsing 100 docs.
//
// Output: a string of HTML. Callers wrap it in a `<div class="prose">`
// (or use ProseHTML.svelte) so the global prose.css rules apply.
import { generateHTML } from "@tiptap/html";
import { READONLY_EXTENSIONS } from "./shared-extensions.js";

// Memo cache. Bounded by trimming oldest entries when it grows past LIMIT;
// in practice Memory's working set is the 100 visible cards, so 200 covers
// scroll + filter cycles without growing unbounded.
const CACHE_LIMIT = 200;
const cache = new Map();

/**
 * @param {object|string} docJson TipTap doc as JSON (or stringified JSON).
 * @param {object} [opts]
 * @param {number} [opts.maxNodes] truncate the doc to its first N top-level nodes.
 * @param {string} [opts.cacheKey] memoization key (typically `${pageId}:${updatedAt}:${maxNodes}`).
 * @returns {string} HTML string.
 */
export function renderDocHTML(docJson, { maxNodes, cacheKey } = {}) {
  if (!docJson) return "";

  // String → JSON: tolerate either shape from the Rust side.
  let doc;
  try {
    doc = typeof docJson === "string" ? JSON.parse(docJson) : docJson;
  } catch {
    return "";
  }
  if (!doc || doc.type !== "doc") return "";

  // Memo lookup
  if (cacheKey && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  // Optional top-level truncation for previews.
  const truncated =
    typeof maxNodes === "number" && Array.isArray(doc.content)
      ? { ...doc, content: doc.content.slice(0, maxNodes) }
      : doc;

  let html;
  try {
    html = generateHTML(truncated, READONLY_EXTENSIONS);
  } catch {
    return "";
  }

  if (cacheKey) {
    cache.set(cacheKey, html);
    // FIFO trim — Map preserves insertion order.
    if (cache.size > CACHE_LIMIT) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
  }

  return html;
}

/** Test/dev helper — purge the memo cache. */
export function clearRenderCache() {
  cache.clear();
}

/** Build the canonical cache key for a Memory card preview. */
export function cardCacheKey(page, maxNodes) {
  return `${page.id}:${page.updated_at ?? ""}:${maxNodes ?? "all"}`;
}
