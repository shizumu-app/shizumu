// The top-level block holding the caret wears `block-caret` while the
// editor has focus, so the laptop's CSS can show that block's type chip
// (its actions) to a keyboard writer. The rule it replaces,
// `.block-shell:focus-within`, never matched: inside one contenteditable the
// focused element is the editor around every block, never the block
// (found with the A16 run of 2026-11-07, J4.3).
//
// A node decoration, so ProseMirror itself sets and clears the class: a
// class stamped by hand on a NodeView's element reads to its observer as a
// foreign change and rebuilds the view (TipTapEditor.svelte's hover note).
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** The top-level block holding the selection, or null for one that spans
 *  blocks (a range over two belongs to neither). */
export function caretBlockRange(doc, selection) {
  const { $from, $to } = selection;
  if ($from.depth < 1 || $to.depth < 1) return null;
  const from = $from.before(1);
  if ($to.before(1) !== from) return null;
  const node = doc.nodeAt(from);
  return node ? { from, to: from + node.nodeSize } : null;
}

const key = new PluginKey("caretBlock");

export const CaretBlock = Extension.create({
  name: "caretBlock",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: () => false,
          apply: (tr, focused) => {
            const meta = tr.getMeta(key);
            return typeof meta === "boolean" ? meta : focused;
          },
        },
        props: {
          decorations(state) {
            if (!key.getState(state)) return null;
            const r = caretBlockRange(state.doc, state.selection);
            if (!r) return null;
            return DecorationSet.create(state.doc, [Decoration.node(r.from, r.to, { class: "block-caret" })]);
          },
          handleDOMEvents: {
            focus: (view) => { view.dispatch(view.state.tr.setMeta(key, true)); return false; },
            blur: (view) => { view.dispatch(view.state.tr.setMeta(key, false)); return false; },
          },
        },
      }),
    ];
  },
});
