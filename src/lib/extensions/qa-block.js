import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

/**
 * `qaBlock` — container for one or more Q/A pairs. Each pair lives in
 * its own `qaPair` node (paragraph paragraph). The block grows by
 * appending another qaPair when the user finishes an A.
 *
 * Keyboard contract (matches the unified "Enter adds a sibling" idiom):
 *   - Enter in Q: jump cursor to the A paragraph of the same pair.
 *   - Enter in A: insert a new qaPair as a sibling below the current
 *     pair; cursor lands in the new Q after the "Q: " prefix.
 *   - Backspace at start of an empty Q on the FIRST qaPair when the
 *     qaBlock has only that one pair: unwrap the qaBlock entirely.
 *   - Backspace at start of empty Q on a non-first pair is handled by
 *     qa-pair.js (delete pair, cursor moves to end of previous A).
 *   - Escape exit is handled by the shared BlockEscExit extension.
 */

// D-8 (QA sweep): the sole-pair unwrap used to call
// `editor.commands.lift("qaBlock")`, which silently no-ops here — `lift`
// needs a valid ancestor to lift the RANGE out INTO, but a bare qaPair
// isn't a member of the doc's "block+" content the way `lift` expects, so
// `liftTarget` finds nothing and the command returns false without
// dispatching. Fixed by building the unwrap transaction directly: replace
// the ENTIRE qaBlock (wrapper + its one qaPair + the now-empty A) with a
// single empty paragraph in its place, matching the documented intent
// ("drop the wrapper and the empty pair, keep the paragraph at the same
// position").
export function unwrapSoleQABlock(editor, $from, qaDepth) {
  const qaPos = $from.before(qaDepth);
  const qaNode = $from.node(qaDepth);
  const paragraph = editor.state.schema.nodes.paragraph.create();
  let tr = editor.state.tr.replaceWith(qaPos, qaPos + qaNode.nodeSize, paragraph);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(qaPos + 1), 1));
  editor.view.dispatch(tr);
  return true;
}

// Locate the qaBlock ancestor + the index of the qaPair child the
// cursor sits inside, and the inner childIndex within that qaPair.
function locateQAContext($from) {
  let qaDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "qaBlock") { qaDepth = d; break; }
  }
  if (qaDepth < 0) return null;
  const qaBlock = $from.node(qaDepth);
  // qaBlock content is qaPair+. The qaPair sits at qaDepth + 1.
  if ($from.depth < qaDepth + 1) return null;
  const pairIndex = $from.index(qaDepth);
  const qaPair = $from.node(qaDepth + 1);
  // The Q/A paragraph sits at qaDepth + 2.
  const innerIndex = $from.depth >= qaDepth + 2 ? $from.index(qaDepth + 1) : -1;
  return { qaDepth, qaBlock, pairIndex, qaPair, innerIndex };
}

export const QABlock = Node.create({
  name: "qaBlock",
  group: "block",
  content: "qaPair+",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="qa-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "qa-block", class: "qa-block" }), 0];
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { $from } = editor.state.selection;
        if (
          $from.parent.type.name === "paragraph" &&
          $from.parent.textContent === "" &&
          $from.depth > 1
        ) {
          const ctx = locateQAContext($from);
          if (!ctx) return false;
          // Empty Q on the first (only) pair, when there's only ONE pair
          // total AND the answer is also empty: unwrap the qaBlock (drop
          // the wrapper and the empty pair, keep the paragraph at the
          // same position). Coordinator branch-review fix: this used to
          // check only the Q side, so an empty Q + a FILLED A deleted the
          // whole block — including the answer — on a single Backspace.
          // qa-pair.js's mirror case (Backspace on empty A) already
          // guards both sides; match it here.
          const aEmpty = ctx.qaPair.child(1).textContent === "";
          if (ctx.pairIndex === 0 && ctx.qaBlock.childCount === 1 && ctx.innerIndex === 0 && aEmpty) {
            return unwrapSoleQABlock(editor, $from, ctx.qaDepth);
          }
        }
        return false;
      },

      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        const ctx = locateQAContext($from);
        if (!ctx) return false;
        // Cursor must sit inside a paragraph that's a direct child of a qaPair.
        if ($from.depth !== ctx.qaDepth + 2) return false;

        // Cursor in Q (innerIndex 0) → jump to A at offset 0.
        if (ctx.innerIndex === 0) {
          const pairPos = $from.before(ctx.qaDepth + 1);
          const qNode = ctx.qaPair.child(0);
          const aTextStart = pairPos + 1 + qNode.nodeSize + 1;
          const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(aTextStart)));
          editor.view.dispatch(tr);
          return true;
        }

        // Cursor in A (innerIndex 1) → insert a new empty qaPair as a
        // sibling below the current pair; cursor lands in the new Q.
        // The "Q:" / "A:" prefixes are rendered via CSS, so the new
        // paragraphs are empty in content.
        if (ctx.innerIndex === 1) {
          const pairPos = $from.before(ctx.qaDepth + 1);
          const after = pairPos + ctx.qaPair.nodeSize;
          const schema = state.schema;
          const qPara = schema.nodes.paragraph.create();
          const aPara = schema.nodes.paragraph.create();
          const newPair = schema.nodes.qaPair.create(null, [qPara, aPara]);
          let tr = state.tr.insert(after, newPair);
          // Cursor at start of new Q: after + 1 (qaPair open) + 1 (p open) = after + 2
          const cursorTarget = after + 2;
          tr = tr.setSelection(TextSelection.near(tr.doc.resolve(cursorTarget)));
          editor.view.dispatch(tr);
          return true;
        }

        return false;
      },

      "Shift-Enter": ({ editor }) => editor.commands.setHardBreak(),
    };
  },
});
