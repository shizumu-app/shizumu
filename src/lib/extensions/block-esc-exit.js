// BlockEscExit — Esc walks up to the nearest "frame" depth and
// moves the cursor to a sibling-after paragraph (creating one if
// needed). Frame node types: list, blockquote, codeBlock,
// recipeBlock, decisionBlock, qaBlock. A top-level paragraph or
// heading is NOT a frame; Esc there returns false so other Esc
// handlers (slash menu close, bubble menu close, etc.) can run.
//
// A list nested in an item is left one level up, into a new item of the list
// around it: an empty paragraph inside the item above was a line nobody asked
// for, and it stayed there whenever the writer moved on. An empty item the
// caret leaves goes with it, rather than staying behind as an empty bullet.
import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { liftListItem } from "@tiptap/pm/schema-list";

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

function isEmptyItem(item) {
  return item.childCount === 1 && item.firstChild.isTextblock && item.firstChild.content.size === 0;
}

/** Leave a list nested inside an item. Returns null when this is not that. */
function leaveNestedList(state, dispatch, frameDepth) {
  const { $from } = state.selection;
  const itemType = state.schema.nodes.listItem;
  const outerItem = $from.node(frameDepth - 1);
  if (outerItem?.type !== itemType || $from.depth <= frameDepth) return null;
  const item = $from.node(frameDepth + 1);
  if (item.type !== itemType) return null;
  if (isEmptyItem(item)) return liftListItem(itemType)(state, dispatch);
  const at = $from.after(frameDepth - 1);
  const fresh = itemType.create(
    { marker: outerItem.attrs.marker },
    state.schema.nodes.paragraph.create(),
  );
  const tr = state.tr.insert(at, fresh);
  tr.setSelection(TextSelection.create(tr.doc, at + 2));
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

export const BlockEscExit = Extension.create({
  name: "blockEscExit",

  addCommands() {
    return {
      blockEscExit: () => ({ state, dispatch }) => {
        const { $from } = state.selection;
        const frameDepth = findFrameDepth($from);
        if (frameDepth == null) return false;

        if ($from.node(frameDepth).type.name === "list") {
          const left = leaveNestedList(state, dispatch, frameDepth);
          if (left != null) return left;
        }

        let tr = state.tr;
        // A top-level list's empty item stays behind no longer. The only item
        // of a list stays: removing it would take the list, and its title.
        const frame = $from.node(frameDepth);
        if (frame.type.name === "list" && frame.childCount > 1 && $from.depth > frameDepth
            && isEmptyItem($from.node(frameDepth + 1))) {
          tr = tr.delete($from.before(frameDepth + 1), $from.after(frameDepth + 1));
        }

        const afterFrame = tr.mapping.map($from.after(frameDepth));
        const $afterFrame = tr.doc.resolve(afterFrame);
        const parentAtAfter = $afterFrame.parent;
        const indexAfter = $afterFrame.index();
        const sibling = indexAfter < parentAtAfter.childCount
          ? parentAtAfter.child(indexAfter)
          : null;

        if (sibling && sibling.isTextblock) {
          const cursorAt = afterFrame + 1;
          try {
            tr.setSelection(TextSelection.create(tr.doc, cursorAt));
          } catch {
            return false;
          }
        } else {
          const paragraph = state.schema.nodes.paragraph.create();
          tr.insert(afterFrame, paragraph);
          const cursorAt = afterFrame + 1;
          try {
            tr.setSelection(TextSelection.create(tr.doc, cursorAt));
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
