// touch-block-handle.js — decides which top-level block types need a
// synthetic touch-only "+" handle because they render no `.block-type-chip`
// of their own.
//
// block-shell.js only builds a chip for board NodeViews (list, blockquote,
// qaBlock, recipeBlock, codeBlock); table gets one from ShellTableView;
// chart gets one from the BlockTypeChip widget plugin. Plain paragraphs and
// headings get none of those — on desktop that's fine (the hover pill
// covers them), but on touch there is no hover, and after the chip became
// the tap target for block actions (touch-actions redesign) a phone would
// otherwise have NO way to reach a plain, EMPTY paragraph's insert menu.
//
// A chip-less block that already has content is a different case, handled
// entirely outside this module: TipTapEditor.svelte reveals that block's
// own pin/copy/delete controls (the same `.block-handles` column desktop
// shows on hover) directly from the touch tap that lands on it — no
// ProseMirror decoration involved, so no predicate belongs here for that
// half. This module only ever answers "does this EMPTY block need the
// synthetic + handle at all."
//
// CLAUDE.md's testing rule: "decisions go in pure modules, not inside
// components." This is that decision, extracted so it can be unit-tested
// without spinning up a ProseMirror editor.

const CHIPLESS_HANDLE_TYPES = new Set(["paragraph", "heading"]);

/**
 * needsTouchHandle(typeName) -> boolean
 *
 * @param {string} typeName - a ProseMirror node's `type.name`
 * @returns {boolean} true when this top-level block type renders no
 *   `.block-type-chip` of its own and so needs the synthetic touch-only
 *   "+" handle when it's empty.
 */
export function needsTouchHandle(typeName) {
  return CHIPLESS_HANDLE_TYPES.has(typeName);
}
