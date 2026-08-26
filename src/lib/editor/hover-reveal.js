// hover-reveal.js — when the block chrome (title slot + handle column) may
// appear, move, and go away under a moving mouse.
//
// The complaint this exists for: "just moving the mouse around makes the
// block title and toolbar appear and disappear fast". Three separate
// timings were behind it, and only one of them was ever a timing at all:
//
//   1. The TITLE reveal had NO delay. `hoveredMouseBlock` was assigned on
//      every single mousemove, so the title slot flickered on and off with
//      the cursor's every crossing — including a cursor merely travelling
//      across the page to reach something else.
//   2. The HANDLE column debounced only when coming from hidden. Once one
//      block had it, moving to the next applied instantly, so sweeping
//      down a page strobed the column from block to block.
//   3. Leaving a block while staying inside the editor cleared both
//      instantly. Only leaving the editor entirely got a grace period.
//
// A hover reveal is a statement about INTENT — "I am looking at this
// block" — and intent is not established by a cursor passing through. So
// all three cases route through one decision here, and the component holds
// exactly one timer for it.
//
// The delays are deliberately asymmetric:
//   - showing costs the most (SHOW): nothing is on screen yet, so a wrong
//     guess paints chrome over text the user is reading.
//   - moving between blocks costs less (SWITCH): chrome is already up, the
//     user has already shown intent, and only its position is in question.
//     Still delayed, because a sweep crosses many blocks on its way.
//   - hiding costs the least in surprise but the most in usability if it
//     is wrong (HIDE): the user is often moving toward the very control
//     that is about to vanish. This is why the column already had a hide
//     grace on leaving the editor — it now applies inside it too.

/** Hidden → revealed. The cursor must settle before anything appears. */
export const HOVER_SHOW_DELAY_MS = 450;

/** Revealed on block A → revealed on block B. Chrome is already up. */
export const HOVER_SWITCH_DELAY_MS = 260;

/**
 * Revealed → hidden. Long enough to cross the gap between a block and its
 * own handle column, which sits in the gutter outside the block's box.
 */
export const HOVER_HIDE_DELAY_MS = 320;

/**
 * hoverIntent — the single decision. Pure: given what is revealed now and
 * what the cursor is over, say what should happen and how long to wait
 * before it does.
 *
 * Returns `action: "none"` for the two steady states (nothing revealed and
 * nothing under the cursor; or the right block already revealed). "none"
 * means *leave every timer alone* — not "cancel pending work" — because a
 * mousemove that lands on the block already being waited for must not
 * restart its own wait, or a slowly-drifting cursor would never settle.
 *
 * @param {object} args
 * @param {any} args.revealed - the block currently revealed, or null.
 * @param {any} args.found - the block under the cursor, or null.
 * @returns {{action: "none"|"reveal"|"clear", delayMs: number}}
 */
export function hoverIntent({ revealed, found }) {
  if (!found) {
    if (!revealed) return { action: "none", delayMs: 0 };
    return { action: "clear", delayMs: HOVER_HIDE_DELAY_MS };
  }
  if (revealed === found) return { action: "none", delayMs: 0 };
  return {
    action: "reveal",
    delayMs: revealed ? HOVER_SWITCH_DELAY_MS : HOVER_SHOW_DELAY_MS,
  };
}

/**
 * shouldRearmTimer — may this mousemove restart the pending timer?
 *
 * mousemove fires per pixel of travel. Without this, every event would
 * clear and re-set the timer for the same target and the delay would never
 * elapse while the cursor kept drifting — the reveal would land only after
 * the mouse came to a dead stop, which is not the same promise.
 *
 * Re-arm only when the pending target actually changed.
 *
 * @param {any} pendingTarget - what the live timer is waiting to apply
 *   (a block for "reveal", null for "clear"), or `undefined` when no timer
 *   is running.
 * @param {any} nextTarget - what this mousemove wants to apply.
 * @returns {boolean}
 */
export function shouldRearmTimer(pendingTarget, nextTarget) {
  if (pendingTarget === undefined) return true;
  return pendingTarget !== nextTarget;
}

/**
 * hoverPlan — the whole decision for one mousemove, in one call.
 *
 * Combines [`hoverIntent`] (what the world should become) with
 * [`shouldRearmTimer`] (may this event restart the wait), and adds the
 * case neither covers on its own: a mousemove that lands back on the
 * already-revealed block while a CLEAR is pending. `hoverIntent` calls
 * that a steady state and says "none" — correct about the world, wrong
 * about the timer, because the armed clear would still fire and hide
 * chrome from under a cursor that is sitting on the block. Coming back
 * has to cancel it.
 *
 * @param {object} args
 * @param {any} args.revealed - the block currently revealed, or null.
 * @param {any} args.found - the block under the cursor, or null.
 * @param {any} args.pendingTarget - what a live timer will apply (a block,
 *   or null for "hide"), or `undefined` when no timer is running.
 * @returns {{action: "none"|"cancel"|"arm", target: any, delayMs: number}}
 *   "arm": cancel any live timer and start one for `target` after
 *   `delayMs`. "cancel": stop the live timer, change nothing else.
 *   "none": leave everything alone.
 */
export function hoverPlan({ revealed, found, pendingTarget }) {
  const intent = hoverIntent({ revealed, found });
  if (intent.action === "none") {
    // The world is already right. Any timer still running is aiming at a
    // state we have since moved away from — a clear armed when the cursor
    // dipped off the block, or a reveal for a block already left.
    return pendingTarget === undefined
      ? { action: "none", target: undefined, delayMs: 0 }
      : { action: "cancel", target: undefined, delayMs: 0 };
  }
  const target = intent.action === "reveal" ? found : null;
  if (!shouldRearmTimer(pendingTarget, target)) {
    return { action: "none", target: undefined, delayMs: 0 };
  }
  return { action: "arm", target, delayMs: intent.delayMs };
}
