// Where a pin's title lives.
//
// A pin has two possible homes for its title and they are not
// interchangeable:
//
//   the NODE — board types (list, blockquote, table, code, chart, q&a,
//     recipe, decision) declare a `blockTitle` attr and render it as a
//     visible title slot on the page. The title IS page content there, so
//     the doc is authoritative and `refresh_pin_caches` keeps the row in
//     step with it on every save.
//
//   the ROW — everything else. A paragraph, a heading, or the paragraph
//     that holds a file chip declares no `blockTitle` attr, so the schema
//     silently discards one written into its JSON. For those the title is
//     pin metadata, it lives on `shared_objects.title`, and nothing in the
//     doc may overwrite it.
//
// Issue #1 was this distinction going unmade in three places at once: every
// rename route wrote the title onto the node, and the save that followed
// derived a null back out of a node that had never been able to hold it.
// Routing on the pin's `object_type` is NOT a substitute — the panel groups
// "file" with the boards, and a file pin's node is a paragraph.
import { isBoardType } from "./extensions/block-title.js";

/**
 * The type name of the node a pin's content describes, or null when the
 * content is not a node at all (older note pins cache plain prose).
 *
 * A pin's cached content arrives in the same three shapes pinToNodes
 * documents: a doc wrapper (what confirmPin writes), a bare node (what
 * refresh_pin_caches re-caches on every save), or plain text.
 *
 * @param {{content?: string}|null} pin
 * @param {{type?: string}|null} liveNode - this page's live node for the
 *   pin, when it has one. Preferred: the user may have converted the block
 *   since it was cached.
 * @returns {string|null}
 */
export function pinNodeType(pin, liveNode = null) {
  if (liveNode && typeof liveNode.type === "string") return liveNode.type;
  const raw = pin?.content;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text.startsWith("{")) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed?.type === "doc") {
    const first = Array.isArray(parsed.content) ? parsed.content[0] : null;
    return typeof first?.type === "string" ? first.type : null;
  }
  return typeof parsed?.type === "string" ? parsed.type : null;
}

/**
 * "node" when a rename must be written into the doc, "row" when it must be
 * written to the pin row. Callers must do one or the other, never both:
 * writing the row for a board would race the page save that re-derives it.
 *
 * @returns {"node"|"row"}
 */
export function pinTitleAuthority(pin, liveNode = null) {
  return isBoardType(pinNodeType(pin, liveNode)) ? "node" : "row";
}
