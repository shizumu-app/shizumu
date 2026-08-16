// dispatch-block-actions.js — the one place that names and shapes the
// `shizumu-block-actions` and `shizumu-block-insert` events. Two separate
// DOM owners fire the former (the block-shell chip and the table chip) and
// TipTapEditor.svelte listens for it once, on the editor root, and routes
// it to openBlockActionSheet(detail.block). Sharing this call keeps the
// event name/shape from drifting between the dispatch sites.
//
// shizumu-block-insert is the same shape, fired by the chip-less touch
// handle (touch-block-handle.js) when its block is EMPTY — routed to the
// identical slash-insert path the desktop `+` handle already calls
// (TipTapEditor.svelte's handleBlockHandleClick / insertSlashAtBlock). A
// chip-less block that already HAS content fires neither event: its
// pin/copy/delete controls are revealed directly by TipTapEditor.svelte's
// own touch pointerdown handling (the `.block-handles` column, same as
// desktop hover), not through a dispatched CustomEvent.

export const BLOCK_ACTIONS_EVENT = "shizumu-block-actions";
export const BLOCK_INSERT_EVENT = "shizumu-block-insert";

/**
 * dispatchBlockActionsEvent(source, block)
 *
 * @param {EventTarget} source - the element the tap landed on (chip or
 *   synthetic handle) — the event is dispatched from here and bubbles.
 * @param {Element} block - the top-level block DOM node the sheet should
 *   act on (what TipTapEditor.svelte's openBlockActionSheet expects).
 */
export function dispatchBlockActionsEvent(source, block) {
  source.dispatchEvent(new CustomEvent(BLOCK_ACTIONS_EVENT, {
    bubbles: true,
    detail: { block },
  }));
}

/**
 * dispatchBlockInsertEvent(source, block)
 *
 * @param {EventTarget} source - the element the tap landed on (the
 *   chip-less touch handle, rendered "+" for an empty block) — the event
 *   is dispatched from here and bubbles.
 * @param {Element} block - the empty top-level block DOM node the slash
 *   menu should open inside.
 */
export function dispatchBlockInsertEvent(source, block) {
  source.dispatchEvent(new CustomEvent(BLOCK_INSERT_EVENT, {
    bubbles: true,
    detail: { block },
  }));
}
