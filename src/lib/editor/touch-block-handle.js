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

/**
 * showsGutterCard(...) -> boolean
 *
 * The other half of "which insert affordance does this block get". Two
 * things render a "+" into the SAME gutter on a coarse pointer: the widget
 * decoration above (bare glyph, anchored to the block) and TipTapEditor's
 * `.block-handles` card. For an empty chip-less block they both fire, which
 * is the reported "why are there two + buttons" — one of them a card several
 * times the size of the glyph beside it.
 *
 * The reveal used to exclude this case; c912aae widened it to every
 * top-level block (fixing "tapping a list reveals nothing") and dropped the
 * exclusion wholesale instead of narrowing it. This narrows it properly.
 *
 * Withheld ONLY where the decoration actually stands in:
 *   - coarse pointer — prose.css hides .touch-block-handle outside
 *     `(pointer: coarse)`, so on desktop this card is the only way in and
 *     must stay;
 *   - empty — a filled block's card carries pin/copy/delete, which the
 *     decoration never offers;
 *   - chip-less and not a board — a board's card still offers delete.
 *
 * @param {object} o
 * @param {boolean} o.coarsePointer
 * @param {boolean} o.canInsert  chip-less block type (paragraph/heading) —
 *   the DOM-side mirror of needsTouchHandle, which the caller computes from
 *   the live element's tag rather than a ProseMirror node.
 * @param {boolean} o.hasContent
 * @param {boolean} o.isBoard
 * @returns {boolean} true when `.block-handles` should be revealed.
 */
export function showsGutterCard({ coarsePointer, canInsert, hasContent, isBoard }) {
  const decorationCoversIt = coarsePointer && canInsert && !hasContent && !isBoard;
  return !decorationCoversIt;
}
