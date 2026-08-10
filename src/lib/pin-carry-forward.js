// Pin row -> the TipTap JSON nodes that represent it inside a page.
//
// Two callers share this: the carry-forward sweep (Page.svelte, after a
// discrete trail is assigned for the first time) and the panel's "inject
// here" button (SharedObjectsPanel.svelte). They used to have separate
// implementations, and each broke exactly the case the other handled —
// because TipTapEditor stores a note pin's content in TWO shapes:
//
//   `pinContent = blockText`                        -> plain text
//   `pinContent = JSON.stringify({type:"doc",…})`   -> a serialized doc
//
// Both land in the same row with object_type "note". Carry-forward assumed
// JSON and dropped the pin outright when the parse failed, so plain-text
// notes vanished from a freshly-trailed page. Inject assumed plain text and
// pasted the raw JSON in as visible characters, and never applied the title
// to a note at all. One function, shape detected rather than assumed.
import { stripPinIdsFromJSON } from "./extensions/pin-id.js";
import { isBoardType } from "./extensions/block-title.js";

/**
 * @param {{object_type?:string, title?:string|null, content?:string|null}|null} pin
 * @returns {Array<object>} TipTap JSON nodes, ready to append to a doc
 */
export function pinToNodes(pin) {
  if (!pin) return [];
  const nodes = contentNodes(pin.content);
  if (nodes.length === 0) return [];
  return withTitle(nodes, pin.title);
}

/**
 * A pin's stored content as nodes, whichever shape it was written in.
 * Unparseable content is plain text — that's a real pin, not a broken one.
 */
function contentNodes(raw) {
  if (typeof raw !== "string") return [];
  const text = raw.trim();
  if (!text) return [];

  // Only attempt a parse when it could plausibly be one; `JSON.parse` on
  // prose is a thrown exception per pin otherwise.
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.content) ? parsed.content
        : null;
      // A doc that parsed but holds nothing is empty, not plain text —
      // returning the JSON as prose would be worse than returning nothing.
      if (arr) return arr.map(stripPinIdsFromJSON);
    } catch {
      // Not JSON after all. Fall through and treat it as what it reads as.
    }
  }
  return [{ type: "paragraph", content: [{ type: "text", text }] }];
}

/**
 * Put the pin's title where the content can actually hold it.
 *
 * The authoritative title lives on the pin row; the cached content node may
 * carry a stale or null blockTitle. Board-type nodes have a blockTitle slot
 * to stamp. Everything else — a paragraph, a heading, a list — does not, so
 * the title becomes its own label line rather than being dropped. Untitled
 * identical blocks also share a shape, and appendNodesToDoc dedupes by
 * shape, so a lost title can silently merge two distinct pins into one.
 */
function withTitle(nodes, title) {
  const t = (title || "").trim();
  if (!t) return nodes;

  const idx = nodes.findIndex((n) => n && isBoardType(n.type));
  if (idx >= 0) {
    // Copy rather than mutate: the caller's array may be a parsed cache.
    const out = nodes.slice();
    out[idx] = { ...nodes[idx], attrs: { ...(nodes[idx].attrs || {}), blockTitle: t } };
    return out;
  }

  return [
    { type: "paragraph", content: [{ type: "text", text: t, marks: [{ type: "bold" }] }] },
    ...nodes,
  ];
}

/**
 * Carry-forward pin rows (shared_objects with auto_insert=1) -> the nodes
 * injectCarryForwardPins appends to a freshly-trailed page.
 *
 * @param {Array<{id:string, object_type:string, title:string|null, content:string}>} pins
 * @returns {Array<object>}
 */
export function buildCarryForwardNodes(pins) {
  const nodes = [];
  for (const pin of pins || []) nodes.push(...pinToNodes(pin));
  return nodes;
}
