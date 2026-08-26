// block-actions.js — which actions apply to a given block, and in what
// order, for the touch long-press action sheet (TipTapEditor.svelte).
//
// CLAUDE.md's testing rule: "decisions go in pure modules, not inside
// components." The floating .block-handles pill decided this inline,
// scattered across handleShowPlus/handleHasContent/handleIsBoard booleans
// in TipTapEditor.svelte — nothing could unit-test it. This is the same
// decision, extracted and testable, for the sheet that replaces the pill
// on touch.

/** Ordered action ids the sheet can ever show, and their sheet labels
 * (brand voice: lowercase, no exclamation marks, fewest words). */
export const BLOCK_ACTION_LABELS = {
  pin: "pin",
  copy: "copy",
  title: "title",
  convert: "convert to…",
  "insert-below": "insert below",
  delete: "delete",
};

/**
 * blockActionsFor({ isBoard, hasTitle, canPin, isEmpty, canConvert }) -> string[]
 *
 * @param {object}  args
 * @param {boolean} args.isBoard   block is a board type (list, table,
 *                                 blockquote, qaBlock, recipeBlock,
 *                                 decisionBlock, chart, codeBlock) —
 *                                 mirrors the old pill's `handleIsBoard`.
 *                                 Boards without content can still be
 *                                 deleted.
 * @param {boolean} args.hasTitle  this block instance actually renders a
 *                                 `.board-title-slot` element to focus.
 *                                 Since Plan 1c a table does: ShellTableView
 *                                 wires a real `<input>` slot by hand
 *                                 (table-shell-view.js), which is what makes
 *                                 `hasTitle` true for one at all — it is NOT
 *                                 a CSS pseudo-element, and table is still
 *                                 outside block-title.js's NODEVIEW_TYPES.
 *                                 The flag stays a DOM fact rather than a
 *                                 type lookup precisely so this comment
 *                                 going stale cannot change behaviour: callers
 *                                 read this straight off the DOM rather
 *                                 than re-deriving it from block type here,
 *                                 so a future board type with no title
 *                                 slot doesn't need this module updated.
 * @param {boolean} args.canPin    block has real text content — mirrors
 *                                 the old pill's `handleHasContent` gate
 *                                 on the pin/copy buttons.
 * @param {boolean} args.isEmpty   block is an insertable, empty text block
 *                                 (paragraph/heading with no content) —
 *                                 mirrors the old `+` button's
 *                                 `handleShowPlus && !handleHasContent`
 *                                 gate. Never true for a board — a board
 *                                 already has other ways to add content.
 * @param {boolean} args.canConvert  this block's type has at least one
 *                                 offered conversion target right now — a
 *                                 boolean fact, same as every other gate
 *                                 here, NOT the block's type name. Keeping
 *                                 this module type-agnostic means the one
 *                                 place that knows which types convert
 *                                 (block-convert.js's CONVERTIBLE_TYPES) is
 *                                 the only place that needs updating when a
 *                                 new convertible board type ships. The
 *                                 caller computes it as
 *                                 `isBoard && !readonly &&
 *                                 CONVERTIBLE_TYPES.includes(block.dataset.board)`.
 * @returns {string[]} ordered action ids, a subset of pin/copy/title/
 *                      convert/insert-below/delete
 */
export function blockActionsFor({
  isBoard = false,
  hasTitle = false,
  canPin = false,
  isEmpty = false,
  canConvert = false,
} = {}) {
  const actions = [];
  if (canPin) actions.push("pin");
  if (canPin) actions.push("copy");
  if (hasTitle) actions.push("title");
  if (canConvert) actions.push("convert");
  if (isEmpty) actions.push("insert-below");
  if (canPin || isBoard) actions.push("delete");
  return actions;
}
