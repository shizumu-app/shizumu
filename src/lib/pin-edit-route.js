// WHERE DOES AN EDIT TO A PIN LAND, AND WHICH MODAL MAKES IT?
//
// A pin is a pointer plus a frozen snapshot (CLAUDE.md). While its node is
// on a page, the node is the pin: every save of that page runs
// refresh_pin_caches, which rewrites the pin row from the node. So an edit
// made only to the row lasts until the page is next saved, and is then
// overwritten by the text it replaced. Sync journey J2.14 measured exactly
// that: a pin edited in the note modal lost the edit on the laptop when the
// laptop left the page, while the phone kept it.
//
// Two decisions follow, and both live here so a test can reach them.
//
// 1. The modal. The note modal is a textarea; it can only write the row.
//    When the pin's node is in the open editor, the panel must open the
//    artifact modal, whose save splices the node back into the editor. The
//    content's shape (pinModalKind) decides only for a pin whose node is not
//    here — and then the edit is written where the node is (2).
//
// 2. The write. In order, the first that takes it:
//      "editor" — the open editor holds the node: splice it there. The
//                 page's own save then refreshes the row.
//      "source" — the stored copy of the page the pin points to holds the
//                 node: splice it there and save that page (the same
//                 refresh runs). Memory has no editor, so its edits start
//                 here. This is also where an edit goes when the
//                 editor was expected to hold the node and did not — the
//                 splice returned false — which used to drop the edit
//                 without a word (J2.8).
//      "row"    — no page holds the node any more: the snapshot is all the
//                 pin is, so the edit is the snapshot.
//    If none of them takes it, the panel says so on screen.
import { pinModalKind } from "./pin-display.js";
import { holdsPin } from "./pin-node.js";
import { findPinRun, withPinRun, pinContentNodes } from "./pin-run.js";

/**
 * @param {any} pin - the pin row
 * @param {any} liveNode - the pin's node in the open editor, or null/undefined
 * @returns {"artifact"|"note"}
 */
export function pinModalFor(pin, liveNode) {
  if (liveNode) return "artifact";
  return pinModalKind(pin);
}

/**
 * The pin as the modal should show it: the live node when the open editor
 * holds it (what the page shows, and what the splice will replace), the row
 * otherwise.
 * @param {any} pin
 * @param {any} liveNode
 */
export function pinForModal(pin, liveNode) {
  if (!pin || !liveNode) return pin;
  // A pin over several blocks is already a doc of them (findPinNode).
  const doc = liveNode.type === "doc" ? liveNode : { type: "doc", content: [liveNode] };
  return { ...pin, content: JSON.stringify(doc) };
}

/**
 * The places to try, in order, for an edit to this pin's node.
 * @param {object} args
 * @param {boolean} args.liveHere - the open editor holds the pin's node
 * @param {string|null|undefined} args.sourcePageId - the page the pin points to
 * @returns {Array<"editor"|"source"|"row">}
 */
export function pinEditRoute({ liveHere, sourcePageId }) {
  const route = [];
  if (liveHere) route.push("editor");
  if (sourcePageId) route.push("source");
  route.push("row");
  return route;
}

/**
 * What a page holds of this pin, at any depth, or null: the stamped node
 * itself, or — for a pin made over several blocks — a doc of all of them,
 * the shape the pin's row stores (pin-run.js).
 * @param {any} doc
 * @param {string} pinId
 */
export function findPinNode(doc, pinId) {
  if (!doc || !pinId) return null;
  if (holdsPin(doc, pinId)) return doc;
  const run = findPinRun(doc, pinId);
  if (run.length === 0) return null;
  return run.length === 1 ? run[0] : { type: "doc", content: run };
}

/**
 * The doc with the pin's blocks replaced by `newNode` — one node, or a doc
 * of several — once, where the first of them was (pin-run.js).
 * @param {any} doc
 * @param {string} pinId
 * @param {any} newNode
 */
export function splicePinNode(doc, pinId, newNode) {
  if (holdsPin(doc, pinId)) return newNode;
  return withPinRun(doc, pinId, pinContentNodes(newNode));
}

const TEXTBLOCKS = new Set(["paragraph", "heading"]);

/**
 * A note modal's plain text written into the node it edits: same type,
 * same attrs (the pinId stamp among them), the text as its content, line
 * breaks as hardBreaks. Only a paragraph or a heading holds plain text
 * this way; anything else returns null, and the edit is not written
 * rather than written somewhere the node will overwrite. Inline marks in
 * the old text do not survive — the note modal is a textarea and never
 * had them.
 * @param {any} node
 * @param {string} text
 */
export function textIntoNode(node, text) {
  if (!node || !TEXTBLOCKS.has(node.type)) return null;
  const content = [];
  String(text).split("\n").forEach((line, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    if (line) content.push({ type: "text", text: line });
  });
  const out = { ...node, content };
  if (content.length === 0) delete out.content;
  return out;
}

/**
 * Write a pin edit where the pin lives, trying each place pinEditRoute
 * names in turn. Shared by the pins panel and memory, so an edit made in
 * either reaches the node while a page holds it — a row-only edit is
 * overwritten by that page's next save, and since that save also sends the
 * pin to the other devices (commands.rs emit_pin_cache_changes), the old
 * text would win there too.
 *
 * @param {object} a
 * @param {{id: string, source_page_id?: string|null}} a.pin
 * @param {any} a.liveNode - the pin's node in an open editor, or null
 * @param {(node: any) => any} a.nodeFor - the edited node, built from the node a place holds; null when it cannot be
 * @param {string} a.rowContent - what the row holds when no page holds the node
 * @param {string|null} a.rowTitle
 * @param {object} a.deps
 * @param {(pinId: string, node: any) => boolean} [a.deps.spliceInEditor]
 * @param {(pageId: string) => Promise<void>|void} [a.deps.beforeSourceWrite] - settle an open editor's pending save on that page first
 * @param {(pageId: string) => Promise<string|null>} a.deps.loadPage
 * @param {(pageId: string, json: string) => Promise<any>} a.deps.savePage
 * @param {(pinId: string, content: string, title: string|null) => Promise<any>} a.deps.updateRow
 * @param {(pageId: string) => void} [a.deps.onPageWritten]
 * @returns {Promise<"editor"|"source"|"row"|null>} where it landed, or null
 */
export async function writePinEdit({ pin, liveNode, nodeFor, rowContent, rowTitle, deps }) {
  for (const step of pinEditRoute({ liveHere: !!liveNode, sourcePageId: pin.source_page_id })) {
    try {
      if (step === "editor") {
        const node = nodeFor(liveNode);
        if (node && deps.spliceInEditor && deps.spliceInEditor(pin.id, node) === true) return step;
        console.warn("pin edit: the open editor did not take it; writing the stored page");
      } else if (step === "source") {
        // An editor open on this page with a save pending would write its
        // copy over this one a moment later; let it land first, then read.
        if (deps.beforeSourceWrite) await deps.beforeSourceWrite(pin.source_page_id);
        const doc = JSON.parse((await deps.loadPage(pin.source_page_id)) || '{"type":"doc","content":[]}');
        const held = findPinNode(doc, pin.id);
        if (!held) continue;
        const node = nodeFor(held);
        // The page holds the node but the edit cannot be put into it: a
        // row write would be overwritten by the page's next save.
        if (!node) return null;
        await deps.savePage(pin.source_page_id, JSON.stringify(splicePinNode(doc, pin.id, node)));
        if (deps.onPageWritten) deps.onPageWritten(pin.source_page_id);
        return step;
      } else {
        await deps.updateRow(pin.id, rowContent, rowTitle);
        return step;
      }
    } catch (err) {
      console.error(`pin edit: writing to ${step} failed:`, err);
    }
  }
  return null;
}
