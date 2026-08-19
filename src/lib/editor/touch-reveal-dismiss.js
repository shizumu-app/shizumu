// May a blur put the touch-revealed block toolbar away?
//
// Extracted because the inline version answered this by reading
// `document.activeElement` one animation frame after the blur, and on a
// real phone that is the wrong question asked at the wrong time. The event
// order for a tap on one of the toolbar's own buttons is:
//
//     mousedown   activeElement = the editor
//     focusout    activeElement = BODY        <- the blur handler runs here
//     mouseup     activeElement = the button
//     click       activeElement = the button  <- the handler finally fires
//
// The button does not take focus until mouseup, which is AFTER the blur.
// So at the only moment the guard could run, the honest answer to "did
// focus land on the toolbar?" is always no. It appeared to work only
// because a synthetic tap dispatches mouseup and click in the same task as
// touchend, so the requestAnimationFrame landed after them and read the
// post-click activeElement. On a device there is a real gap between
// touchend and click, the frame lands inside it, the guard says "clear",
// and the toolbar unmounts out from under the finger — the tap never
// becomes a click on a button that still exists. Tapping again works,
// because the editor is no longer focused so there is no second blur.
// That is the "you have to tap many times" report.
//
// The fix is to stop inferring intent from focus and record it instead:
// the pointerdown that started the gesture already knows whether it landed
// on the toolbar (handleEditorPointerDown returns early for exactly that
// case). This function consumes that fact.
//
// Same failure family as the four-second auto-hide removed in 64f7d91 —
// chrome that removes itself between the tap and the click, indistinguishable
// from a dead button — and the same lesson: a guard that only holds because
// of harness timing is not a guard.

/**
 * @param {object} o
 * @param {boolean} o.pointerDownOnToolbar
 *   Did the gesture in progress start on the toolbar? Set by the editor's
 *   own pointerdown handler, cleared when the gesture ends.
 * @param {boolean} o.coarsePointer
 *   Touch-like input. On a mouse the toolbar is hover-driven and mouseleave
 *   already governs it, so blur must never be what dismisses it.
 * @returns {boolean} true if the blur should clear the touch reveal.
 */
export function shouldDismissOnBlur({ pointerDownOnToolbar, coarsePointer }) {
  if (!coarsePointer) return false;
  if (pointerDownOnToolbar) return false;
  return true;
}

/**
 * Should this pointer event be treated as "the user is addressing the
 * toolbar / an affordance", rather than "the user is addressing a block"?
 *
 * handleEditorPointerDown grew a list of these early-outs one bug at a
 * time; handleEditorPointerUp never got the same list, which is its own
 * defect — a tap that starts on a toolbar button also ENDS on one, and
 * pointerup was re-resolving that tap to whatever block happens to sit
 * under the button. On a block shorter than the toolbar (a two-item task
 * list, say) the lower buttons hang past their own block, so the tap
 * reassigned the active block to a different one, which moves an in-flow
 * title reveal, which reflows the page between pointerup and click — the
 * button leaves from under the finger and the click misses.
 *
 * Shared by both handlers so they cannot drift apart again.
 *
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
export function isAffordanceTarget(target) {
  if (!target || typeof (/** @type {any} */ (target).closest) !== "function") return false;
  const el = /** @type {Element} */ (target);
  return !!el.closest(".block-handles, .block-type-chip, .touch-block-handle, .board-title-slot");
}
