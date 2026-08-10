// block-delete.js — resolves a block NodeView's outer wrapper DOM element to
// the doc position of the TOP-LEVEL block it represents, then deletes that
// block. Extracted from TipTapEditor.svelte's handleDeleteBlock (the ×
// block-handle) so the resolution logic can be covered by a real
// editor-mounted test (see __tests__/block-delete.test.js) without rendering
// the whole Svelte component.
//
// Why this exists: `view.posAtDOM(hoveredBlock, 0)` resolves to a position
// INSIDE hoveredBlock's first DOM child, not to hoveredBlock's own boundary.
// For a table, that first child is the `.table-title-caption` div inserted
// before the <table> (table-shell-view.js); for a board (recipe/qa/list/
// blockquote), it's the title `<input>` inserted before the content
// (block-shell.js). `doc.nodeAt(inside)` at that position therefore returns
// the WRONG node — a tableRow instead of the table, or a paragraph deep
// inside the board instead of the board itself — and deleting around it
// removes the wrong range (or nothing at all).
//
// The fix: resolve `inside` to a ProseMirror position, then walk back out
// to the start of its depth-1 ancestor — the actual top-level block
// hoveredBlock represents. `$pos.depth === 0` means `inside` already sits at
// a top-level boundary (some atom NodeViews resolve there directly), so no
// further walk is needed.

export function resolveBlockPos(view, hoveredBlock) {
  const inside = view.posAtDOM(hoveredBlock, 0);
  const $pos = view.state.doc.resolve(inside);
  return $pos.depth ? $pos.before(1) : inside;
}

/**
 * Delete the top-level block that `hoveredBlock` (a NodeView's outer
 * wrapper DOM element) represents. Mirrors TipTapEditor.svelte's
 * handleDeleteBlock: if it's the last remaining top-level block, replace it
 * with an empty paragraph (the schema requires at least one block) rather
 * than leaving the doc empty.
 *
 * @returns {boolean} true if a delete/replace transaction was dispatched.
 */
export function deleteBlockAt(editor, hoveredBlock) {
  if (!editor || !hoveredBlock) return false;
  let pos;
  try {
    pos = resolveBlockPos(editor.view, hoveredBlock);
  } catch {
    return false;
  }
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const from = pos;
  const to = pos + node.nodeSize;
  if (editor.state.doc.childCount <= 1) {
    editor.view.dispatch(
      editor.state.tr.replaceWith(from, to, editor.state.schema.nodes.paragraph.create())
    );
  } else {
    editor.chain().deleteRange({ from, to }).run();
  }
  return true;
}
