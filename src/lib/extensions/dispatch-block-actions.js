// dispatch-block-actions.js — the one place that names and shapes the
// `shizumu-block-actions` event. Three separate DOM owners fire it (the
// block-shell chip, the table chip, and the chip-less touch handle) and
// TipTapEditor.svelte listens for it once, on the editor root, and routes
// it to openBlockActionSheet(detail.block). Sharing this call keeps the
// event name/shape from drifting between the three dispatch sites.

export const BLOCK_ACTIONS_EVENT = "shizumu-block-actions";

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
