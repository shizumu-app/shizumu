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
 * @param {{id?:string, object_type?:string, title?:string|null, content?:string|null}|null} pin
 * @param {{keepPinIds?:boolean}} [opts]  keep the pinId attrs on the returned
 *   nodes, so the injected block IS the pin rather than a copy of it. Off by
 *   default: carry-forward appends a fresh day's working copy and must not
 *   claim ownership of the pin it came from.
 * @returns {Array<object>} TipTap JSON nodes, ready to append to a doc
 */
export function pinToNodes(pin, opts = {}) {
  if (!pin) return [];
  const nodes = contentNodes(pin.content, opts);
  if (nodes.length === 0) return [];
  return withTitle(nodes, pin.title);
}

/**
 * A pin's stored content as nodes, whichever shape it was written in.
 * Unparseable content is plain text — that's a real pin, not a broken one.
 */
function contentNodes(raw, { keepPinIds = false } = {}) {
  if (typeof raw !== "string") return [];
  const text = raw.trim();
  if (!text) return [];

  // Only attempt a parse when it could plausibly be one; `JSON.parse` on
  // prose is a thrown exception per pin otherwise.
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      // A pin's content reaches us in THREE shapes, and they must not be
      // conflated:
      //   [a, b]                          -> a bare node array
      //   {type:"doc", content:[a, b]}    -> a doc wrapper (confirmPin writes this)
      //   {type:"list", content:[li, li]} -> a SINGLE node (refresh_pin_caches
      //                                      re-caches the bare pinned node on
      //                                      every save)
      // The trap: reading `.content` off the third shape returns the list's
      // OWN children (listItems), dropping the `list` wrapper that carries the
      // blockTitle slot — so withTitle saw no board and stamped a bold title
      // line instead. Only a `doc` node's `.content` is a top-level node list;
      // any other single node IS the top-level node.
      const arr = Array.isArray(parsed) ? parsed
        : parsed?.type === "doc" && Array.isArray(parsed.content) ? parsed.content
        : parsed?.type ? [parsed]
        : Array.isArray(parsed?.content) ? parsed.content
        : null;
      // A doc that parsed but holds nothing is empty, not plain text —
      // returning the JSON as prose would be worse than returning nothing.
      // Stripping is the default because most callers want a copy. Inject
      // asks to keep them: without the id the injected block is inert —
      // refresh_pin_caches has nothing to match, so every edit to it updates
      // the page and never the pin, which is the whole complaint.
      if (arr) return keepPinIds ? arr : arr.map(stripPinIdsFromJSON);
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
    // The block's OWN blockTitle wins when it has one — that is the title the
    // user typed into the slot. Only fill the slot from `t` when it is empty.
    // Without this, injecting with a fallback title (the first content line,
    // when the pin's title column is blank) would overwrite a perfectly good
    // slot title with a line of body text.
    const existing = (nodes[idx].attrs?.blockTitle || "").trim();
    // Copy rather than mutate: the caller's array may be a parsed cache.
    const out = nodes.slice();
    out[idx] = { ...nodes[idx], attrs: { ...(nodes[idx].attrs || {}), blockTitle: existing || t } };
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
