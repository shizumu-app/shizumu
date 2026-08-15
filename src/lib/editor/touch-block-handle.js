// touch-block-handle.js — decides which top-level block types need a
// synthetic touch-only "block actions" handle because they render no
// `.block-type-chip` of their own.
//
// block-shell.js only builds a chip for board NodeViews (list, blockquote,
// qaBlock, recipeBlock, codeBlock); table gets one from ShellTableView;
// chart gets one from the BlockTypeChip widget plugin. Plain paragraphs and
// headings get none of those — on desktop that's fine (the hover pill
// covers them), but on touch there is no hover, and after the chip became
// the tap target for block actions (touch-actions redesign) a phone would
// otherwise have NO way to reach a plain paragraph's actions — including
// pin, the app's core verb.
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
 *   handle to reach its block-actions sheet.
 */
export function needsTouchHandle(typeName) {
  return CHIPLESS_HANDLE_TYPES.has(typeName);
}
