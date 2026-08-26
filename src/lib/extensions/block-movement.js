import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

const BOARD_TYPES = new Set(["list", "blockquote", "qaBlock", "table"]);
const ITEM_TYPES = new Set(["listItem"]);
const ROW_TYPES = new Set(["tableRow"]);

function findMovableUnit($pos) {
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (!node) continue;
    if (ROW_TYPES.has(node.type.name)) return makeUnit($pos, d, node, "row");
    if (ITEM_TYPES.has(node.type.name)) return makeUnit($pos, d, node, "item");
    if (BOARD_TYPES.has(node.type.name) && d > 0) return makeUnit($pos, d, node, "board");
  }
  if ($pos.depth >= 1) {
    const node = $pos.node(1);
    if (node) return makeUnit($pos, 1, node, "top");
  }
  return null;
}

function makeUnit($pos, depth, node, kind) {
  const pos = depth > 0 ? $pos.before(depth) : -1;
  return { depth, node, pos, kind };
}

function findParentUnit($pos, child) {
  for (let d = child.depth - 1; d >= 1; d--) {
    const node = $pos.node(d);
    if (!node) continue;
    if (BOARD_TYPES.has(node.type.name)) return makeUnit($pos, d, node, "board");
    if (ITEM_TYPES.has(node.type.name)) return makeUnit($pos, d, node, "item");
  }
  return null;
}

function swapWithSibling(state, dispatch, unit, direction) {
  if (!unit || unit.depth === 0 || unit.pos < 0) return false;
  const $from = state.selection.$from;
  const idx = $from.index(unit.depth - 1);
  const parent = $from.node(unit.depth - 1);
  if (direction === "up" && idx <= 0) return false;
  if (direction === "down" && idx >= parent.childCount - 1) return false;
  const sibling = direction === "up" ? parent.child(idx - 1) : parent.child(idx + 1);
  const cursorOffset = state.selection.from - unit.pos;
  let tr = state.tr;
  if (direction === "up") {
    const targetPos = unit.pos - sibling.nodeSize;
    tr = tr.delete(unit.pos, unit.pos + unit.node.nodeSize);
    tr = tr.insert(targetPos, unit.node);
    if (dispatch) {
      const $cursor = tr.doc.resolve(targetPos + cursorOffset);
      dispatch(tr.setSelection(TextSelection.near($cursor, 1)));
    }
  } else {
    const targetEnd = unit.pos + unit.node.nodeSize + sibling.nodeSize;
    tr = tr.insert(targetEnd, unit.node);
    tr = tr.delete(unit.pos, unit.pos + unit.node.nodeSize);
    const newPos = targetEnd - unit.node.nodeSize;
    if (dispatch) {
      const $cursor = tr.doc.resolve(newPos + cursorOffset);
      dispatch(tr.setSelection(TextSelection.near($cursor, 1)));
    }
  }
  return true;
}

/**
 * Move the block AT A GIVEN POSITION one slot up or down among its
 * siblings, without consulting — or disturbing — the selection.
 *
 * `moveUnit` cannot serve this case. It finds what to move by walking up
 * from `state.selection.$from`, which assumes the caret is inside the thing
 * being moved. A board's title is an `<input>` the NodeView renders as
 * chrome OUTSIDE the contenteditable (and its `stopEvent` deliberately
 * keeps ProseMirror away from it), so while the user is typing a title the
 * PM selection is wherever it was last left — in some other block, or
 * nowhere. Alt+Arrow from the title therefore either did nothing or would
 * have moved the wrong block. The title handler says which block by
 * position instead; see `title-slot.js`.
 *
 * The selection is deliberately left untouched for the same reason: moving
 * the caret into the moved block would pull focus out of the title input
 * the user is typing in.
 *
 * @param {import("@tiptap/pm/state").EditorState} state
 * @param {Function|null} dispatch
 * @param {number} pos - document position of the block to move.
 * @param {"up"|"down"} direction
 * @returns {number|null} the block's new position, or null if it could not
 *   move (already at that end, or no node at `pos`). Null rather than -1 or
 *   a boolean because 0 is a valid position and the caller needs to tell
 *   "moved to the front" from "did not move".
 */
export function moveBlockAtPos(state, dispatch, pos, direction) {
  if (typeof pos !== "number" || pos < 0 || pos > state.doc.content.size) return null;
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  let $pos;
  try { $pos = state.doc.resolve(pos); } catch { return null; }
  const parent = $pos.parent;
  const idx = $pos.index();
  if (direction === "up" && idx <= 0) return null;
  if (direction === "down" && idx >= parent.childCount - 1) return null;
  const sibling = direction === "up" ? parent.child(idx - 1) : parent.child(idx + 1);

  let tr = state.tr;
  let newPos;
  if (direction === "up") {
    newPos = pos - sibling.nodeSize;
    tr = tr.delete(pos, pos + node.nodeSize);
    tr = tr.insert(newPos, node);
  } else {
    const targetEnd = pos + node.nodeSize + sibling.nodeSize;
    tr = tr.insert(targetEnd, node);
    tr = tr.delete(pos, pos + node.nodeSize);
    newPos = targetEnd - node.nodeSize;
  }
  if (dispatch) dispatch(tr);
  return newPos;
}

export const BlockMovement = Extension.create({
  name: "blockMovement",

  addCommands() {
    return {
      moveUnit: (direction) => ({ state, dispatch }) => {
        const unit = findMovableUnit(state.selection.$from);
        return swapWithSibling(state, dispatch, unit, direction);
      },
      moveBlockAt: (pos, direction) => ({ state, dispatch }) =>
        moveBlockAtPos(state, dispatch, pos, direction) !== null,
      moveParentUnit: (direction) => ({ state, dispatch }) => {
        const child = findMovableUnit(state.selection.$from);
        if (!child) return false;
        const parent = findParentUnit(state.selection.$from, child);
        return swapWithSibling(state, dispatch, parent, direction);
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Alt-ArrowUp": () => this.editor.commands.moveUnit("up"),
      "Alt-ArrowDown": () => this.editor.commands.moveUnit("down"),
      "Alt-Shift-ArrowUp": () => this.editor.commands.moveParentUnit("up"),
      "Alt-Shift-ArrowDown": () => this.editor.commands.moveParentUnit("down"),
    };
  },
});
