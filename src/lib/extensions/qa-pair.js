import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { unwrapSoleQABlock } from "./qa-block.js";

/**
 * `qaPair` — a single Q + A inside a `qaBlock`. Holds exactly two
 * paragraphs (the question paragraph and the answer paragraph). The
 * outer `qaBlock` contains one or more `qaPair` nodes, which is how
 * a single block can carry a sequence of pairs.
 *
 * Keyboard hooks live on qa-block.js (Enter Q→A, Enter A→new pair).
 * This node owns only the schema and a couple of edge-case keys:
 *   - Backspace at start of empty Q on a non-first pair: delete the
 *     pair and merge cursor to end of previous pair's A.
 */
export const QAPair = Node.create({
  name: "qaPair",
  group: "block",
  content: "paragraph paragraph",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="qa-pair"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "qa-pair", class: "qa-pair" }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        if ($from.parentOffset !== 0) return false;
        if ($from.parent.textContent !== "") return false;
        const ctx = locatePairContext($from);
        if (!ctx) return false;

        const $pair = state.doc.resolve($from.before(ctx.pairDepth));
        const qaBlockNode = $pair.node();
        if (!qaBlockNode || qaBlockNode.type.name !== "qaBlock") return false;
        const pairIndex = $pair.index();
        const pairStart = $pair.pos;
        const pairEnd = pairStart + ctx.qaPair.nodeSize;

        if (ctx.childIndex === 0) {
          // Empty Q. First pair → let qa-block handle unwrap. Otherwise
          // delete the entire pair and move cursor to end of previous A.
          if (pairIndex === 0) return false;
          const prevPair = qaBlockNode.child(pairIndex - 1);
          const prevPairStart = pairStart - prevPair.nodeSize;
          const prevA = prevPair.child(1);
          const prevATextEnd = prevPairStart + 1 + prevPair.child(0).nodeSize + 1 + prevA.content.size;
          let tr = state.tr.delete(pairStart, pairEnd);
          tr = tr.setSelection(TextSelection.near(tr.doc.resolve(prevATextEnd)));
          editor.view.dispatch(tr);
          return true;
        }

        if (ctx.childIndex === 1) {
          // Empty A. If Q is also empty, drop the whole pair (or unwrap the
          // qaBlock if it was the last pair). Otherwise jump cursor to end
          // of Q without deleting — qaPair's schema requires both paragraphs.
          const qNode = ctx.qaPair.child(0);
          const qEmpty = qNode.textContent === "";
          if (qEmpty) {
            if (qaBlockNode.childCount === 1) {
              // Same fix as qa-block.js's Backspace-on-empty-Q unwrap:
              // `lift("qaBlock")` finds no valid lift target here and
              // silently no-ops. Build the unwrap transaction directly.
              return unwrapSoleQABlock(editor, $from, ctx.pairDepth - 1);
            }
            // Multi-pair: delete this pair. Cursor goes to end of previous A.
            if (pairIndex === 0) {
              // First pair empty + still has more pairs below: delete it.
              let tr = state.tr.delete(pairStart, pairEnd);
              tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pairStart)));
              editor.view.dispatch(tr);
              return true;
            }
            const prevPair = qaBlockNode.child(pairIndex - 1);
            const prevPairStart = pairStart - prevPair.nodeSize;
            const prevA = prevPair.child(1);
            const prevATextEnd = prevPairStart + 1 + prevPair.child(0).nodeSize + 1 + prevA.content.size;
            let tr = state.tr.delete(pairStart, pairEnd);
            tr = tr.setSelection(TextSelection.near(tr.doc.resolve(prevATextEnd)));
            editor.view.dispatch(tr);
            return true;
          }
          // Q has content: just move cursor to end of Q.
          const qTextEnd = pairStart + 1 + 1 + qNode.content.size;
          const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(qTextEnd)));
          editor.view.dispatch(tr);
          return true;
        }

        return false;
      },
    };
  },
});

function locatePairContext($from) {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "qaPair") {
      return {
        pairDepth: d,
        childIndex: $from.index(d),
        qaPair: $from.node(d),
      };
    }
  }
  return null;
}
