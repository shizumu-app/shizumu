// A pin's blocks, as one run.
//
// A pin made from a selection over several blocks stamps its id on each
// of them (EditorCore `confirmPin`), and `refresh_pin_caches`
// (commands.rs) stores every node carrying the id, in document order. So
// a pin is not "the node with this id" but "the nodes with this id".
//
// Every writer that puts an edited pin back into a page used to replace
// the FIRST stamped node and leave the others: the edit landed, the old
// second and third blocks stayed below it still stamped, and the next
// save made them part of the pin again (found 2026-10-28, "select
// multiple blocks with text, pin is not working"). The rule here is the
// one all of them now share:
//
//   the edited blocks go where the first stamped block was, every one of
//   them carries the pin's id, and every other block carrying it is gone.
//
// Every edited block is stamped, not only the first: what the writer
// sees on the pin screen is the pin, and a block left unstamped would
// drop out of the pin at the next save while staying on the page.

import { holdsPin } from "./pin-node.js";

/** The id rides on every block that replaces the pin's. A doc rebuilt by
 *  a serializer can come back without the attr, and a page spliced with
 *  no pinId in it is a pin orphaned by its own save.
 *  @param {any[]} nodes  @param {string} pinId */
export function stampPinRun(nodes, pinId) {
  return trimScaffolding(Array.isArray(nodes) ? nodes.filter(Boolean) : []).map((n) => ({
    ...n,
    attrs: { ...(n.attrs || {}), pinId },
  }));
}

/** An empty paragraph at either END of an edited pin is the editor's, not
 *  the writer's: a ProseMirror doc that closes on a list grows one after it,
 *  and stamped and spliced it became an extra block of the pin and a blank
 *  line in the page (J12.6 on the A16, 2026-10-29). Empty paragraphs
 *  between blocks are the writer's and stay. */
function trimScaffolding(nodes) {
  const empty = (n) => n?.type === "paragraph" && !(Array.isArray(n.content) && n.content.length);
  let a = 0;
  let b = nodes.length;
  while (a < b && empty(nodes[a])) a += 1;
  while (b > a && empty(nodes[b - 1])) b -= 1;
  return nodes.slice(a, b);
}

/** The blocks a pin's content stands for: a doc's children, or one node.
 *  @param {any} content */
export function pinContentNodes(content) {
  if (!content || typeof content !== "object") return [];
  if (Array.isArray(content)) return content.filter(Boolean);
  if (content.type === "doc") return Array.isArray(content.content) ? content.content : [];
  return typeof content.type === "string" ? [content] : [];
}

/**
 * Every node stamped with `pinId`, outermost only, in document order. A
 * node inside a stamped node is part of it, not a second block.
 * @param {any} doc  @param {string} pinId  @returns {any[]}
 */
export function findPinRun(doc, pinId) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (holdsPin(n, pinId)) {
      out.push(n);
      return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  if (pinId) walk(doc);
  return out;
}

/**
 * `doc` with the pin's run replaced by `nodes` (see the header). An empty
 * replacement leaves the doc alone: removing a pinned block is unpin's
 * job, not a save's. A doc holding no such pin comes back as it was.
 * @param {any} doc  @param {string} pinId  @param {any[]} nodes
 * @returns {any} a new tree; the input is not mutated
 */
export function withPinRun(doc, pinId, nodes) {
  const replacement = stampPinRun(nodes, pinId);
  if (!doc || typeof doc !== "object" || replacement.length === 0) return doc;
  let placed = false;
  const walk = (n) => {
    if (!Array.isArray(n?.content)) return n;
    const out = [];
    let changed = false;
    for (const child of n.content) {
      if (holdsPin(child, pinId)) {
        changed = true;
        if (!placed) {
          placed = true;
          out.push(...replacement);
        }
        continue;
      }
      const next = walk(child);
      if (next !== child) changed = true;
      out.push(next);
    }
    return changed ? { ...n, content: out } : n;
  };
  return walk(doc);
}

/**
 * The same rule on a live ProseMirror doc: the [from, to) ranges of the
 * pin's run, outermost only, in document order. EditorCore deletes every
 * range but the first and replaces the first with the edited blocks.
 * @param {any} pmDoc  @param {string} pinId  @returns {Array<{from: number, to: number}>}
 */
export function pinRunRanges(pmDoc, pinId) {
  const ranges = [];
  if (!pmDoc || !pinId) return ranges;
  pmDoc.descendants((node, pos) => {
    if (holdsPin(node, pinId)) {
      ranges.push({ from: pos, to: pos + node.nodeSize });
      return false;
    }
    return true;
  });
  return ranges;
}

/**
 * Put `nodes` in place of the pin's run in a live editor, as one
 * transaction. Returns false when the doc holds no such pin or the nodes
 * do not fit the schema; the caller then writes the stored page instead.
 * @param {any} editor  a TipTap Editor  @param {string} pinId  @param {any[]|any} json
 */
export function replacePinRunInEditor(editor, pinId, json) {
  if (!editor || !pinId || !json) return false;
  // One node, a list, or a doc of several: the shapes the pin screen and
  // the desktop modal hand back.
  const replacement = stampPinRun(pinContentNodes(json), pinId);
  if (replacement.length === 0) return false;
  const ranges = pinRunRanges(editor.state.doc, pinId);
  if (ranges.length === 0) return false;
  try {
    const nodes = replacement.map((n) => editor.state.schema.nodeFromJSON(n));
    let tr = editor.state.tr;
    // Last first, so the earlier positions stay where they were.
    for (let i = ranges.length - 1; i >= 1; i--) tr = tr.delete(ranges[i].from, ranges[i].to);
    tr = tr.replaceWith(ranges[0].from, ranges[0].to, nodes);
    editor.view.dispatch(tr);
    return true;
  } catch (err) {
    console.error("replacePinRunInEditor failed:", err);
    return false;
  }
}
