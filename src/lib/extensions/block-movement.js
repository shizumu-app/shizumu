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

export const BlockMovement = Extension.create({
  name: "blockMovement",

  addCommands() {
    return {
      moveUnit: (direction) => ({ state, dispatch }) => {
        const unit = findMovableUnit(state.selection.$from);
        return swapWithSibling(state, dispatch, unit, direction);
      },
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
