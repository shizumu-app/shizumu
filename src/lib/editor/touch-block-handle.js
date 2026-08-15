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

/**
 * touchHandleKind(typeName, hasContent) -> "insert" | "actions" | null
 *
 * The gutter restoration (mobile-stability sweep) gave the synthetic touch
 * handle a second job: on an EMPTY chip-less block it now offers the same
 * insert/slash entry the desktop `+` handle gives (glyph "+"), and only
 * falls back to the block-actions sheet (glyph "⋯") once the block has
 * content — mirroring the desktop hover column's own insert-vs-act split
 * (`handleShowPlus && !handleHasContent`) without needing hover to expose
 * it. Kept as one decision here, not two `if`s duplicated in the
 * ProseMirror plugin and the CSS, so the glyph shown and the event
 * dispatched can never disagree about which state a block is in.
 *
 * @param {string} typeName - a ProseMirror node's `type.name`
 * @param {boolean} hasContent - whether the block has any text content
 * @returns {"insert" | "actions" | null} which handle to render — null
 *   when the block type needs no synthetic handle at all (needsTouchHandle
 *   is false for it, e.g. every board type already has its own chip).
 */
export function touchHandleKind(typeName, hasContent) {
  if (!needsTouchHandle(typeName)) return null;
  return hasContent ? "actions" : "insert";
}
