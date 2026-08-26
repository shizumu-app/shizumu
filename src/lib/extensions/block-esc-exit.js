// BlockEscExit — Esc walks up to the nearest "frame" depth and
// moves the cursor to a sibling-after paragraph (creating one if
// needed). Frame node types: list, blockquote, codeBlock,
// recipeBlock, decisionBlock, qaBlock. A top-level paragraph or
// heading is NOT a frame; Esc there returns false so other Esc
// handlers (slash menu close, bubble menu close, etc.) can run.
import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

const FRAME_TYPES = new Set([
  "list",
  "blockquote",
  "codeBlock",
  "recipeBlock",
  "decisionBlock",
  "qaBlock",
]);

function findFrameDepth($from) {
  // Walk from the current depth toward the doc root. Return the
  // depth at which a frame node sits, or null if none found.
  for (let d = $from.depth; d > 0; d--) {
    if (FRAME_TYPES.has($from.node(d).type.name)) return d;
  }
  return null;
}

export const BlockEscExit = Extension.create({
  name: "blockEscExit",

  addCommands() {
    return {
      blockEscExit: () => ({ state, dispatch }) => {
        const { $from } = state.selection;
        const frameDepth = findFrameDepth($from);
        if (frameDepth == null) return false;

        const afterFrame = $from.after(frameDepth);
        const $afterFrame = state.doc.resolve(afterFrame);
        const parentAtAfter = $afterFrame.parent;
        const indexAfter = $afterFrame.index();
        const sibling = indexAfter < parentAtAfter.childCount
          ? parentAtAfter.child(indexAfter)
          : null;

        let tr = state.tr;

        if (sibling && sibling.isTextblock) {
          const cursorAt = afterFrame + 1;
          try {
            tr = tr.setSelection(TextSelection.create(tr.doc, cursorAt));
          } catch {
            return false;
          }
        } else {
          const paragraph = state.schema.nodes.paragraph.create();
          tr = tr.insert(afterFrame, paragraph);
          const cursorAt = afterFrame + 1;
          try {
            tr = tr.setSelection(TextSelection.create(tr.doc, cursorAt));
          } catch {
            return false;
          }
        }

        if (dispatch) dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      Escape: () => this.editor.commands.blockEscExit(),
    };
  },
});
