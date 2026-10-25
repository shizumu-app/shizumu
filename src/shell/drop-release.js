// Did this stroke end in a drop or a cancel, and which cancel.
//
// One question, asked once, at the moment the finger comes off a block it
// has been carrying. NOT the drag's lifecycle: whether a press armed, when
// the hold fired, whether the slop was left, and when the geometry was
// measured all stay in PageScreen, where the DOM they are read from lives.
// Task 1 looked at a module for that lifecycle and declined it — at the
// time it would have held one `if` whose two terms were already pure and
// already tested — and recorded that Task 3's two cancels were the answer
// worth extracting. This is that extraction, and it is deliberately no
// wider than the sentence above.
//
// WHY THIS IS NOT A MEASUREMENT. Task 2 kept five new variables in the
// component on the grounds that a measurement is not a decision: rects, an
// index and two coordinates are numbers a pure function was already
// answering questions about. This is the other kind. Nothing here reads a
// box or a doc; it takes four numbers and returns one of four answers, and
// every one of those answers is a rule from spec §3 rather than a fact
// about the screen.
//
// AND WHY IT HAD TO LEAVE THE COMPONENT, which is the argument that
// actually decided it. Both cancels leave the document byte-identical, and
// so does one of the two DROPS — `moveNodeToIndex` (block-movement.js:85)
// returns false when the target index equals the block's own index, so a
// component that ignored the origin rule entirely and called moveBlock
// anyway would produce exactly the same document as one that obeyed it.
// The doc is the only witness a component test has, and on that case it
// cannot tell the rule from its absence. This module's own tests can: they
// assert the ANSWER — "origin", not "drop" — which is the one place the
// shell's rule is distinguishable from the command's coincidence. That is
// two mechanisms hiding each other, the trap this workstream has now met
// four times, caught before it was written rather than after.
//
// A NOTE ON THE INDEX, because it passes straight through. `dropIndex` is
// whatever `dropTargetIndex` answered, which is already POST-removal — the
// index `moveBlockTo` expects — and nothing here adjusts it. The plan's
// standing warning is against double-correcting it in the caller, and a
// module in the middle of the path is exactly where a second correction
// would be easiest to hide.

/** Reasons, spelled out so a caller can assert which cancel it got rather
 *  than only that it got one. Two of them are §3's ("returning to origin or
 *  leaving the canvas cancels"); `no-target` is not, and says so below. */

/**
 * @param {object} release
 * @param {number|null} release.dropIndex  the post-removal index the drop
 *   would use — what `dropTargetIndex` last answered, or null if the drag
 *   never had geometry to answer from
 * @param {number} release.fromIndex       the block's own sibling index at lift
 * @param {number} release.pointerY        where the finger came off, viewport px
 * @param {{top: number, bottom: number}|null} release.bounds  the box the
 *   drag lives in — PageScreen passes the content band's, which is the
 *   scrolling viewport the canvas is seen through
 * @returns {{drop: boolean, toIndex: number|null, reason: "dropped"|"no-target"|"left-canvas"|"origin"}}
 */
export function releaseOutcome({ dropIndex, fromIndex, pointerY, bounds }) {
  // No usable pair of indices means the drag never had geometry — the
  // rects could not be measured, or the drop target was never asked. A
  // drop needs a number to move the block TO, and inventing one (0, say)
  // is the "silently moved to the top of the document" answer
  // drop-target.js's own header refuses. Not one of §3's two cancels; it
  // is the guard that keeps the two below from being asked a question
  // neither can answer.
  if (!Number.isInteger(dropIndex) || !Number.isInteger(fromIndex)) {
    return { drop: false, toIndex: null, reason: "no-target" };
  }
  // §3's second cancel, checked before the first because it is the
  // deliberate one: dragging the block out of the writing surface and
  // letting go is how a writer says "no" mid-drag, and it should report
  // itself as that even when the gap it happens to be over is the block's
  // own. Ordering changes only the reason, never the drop/cancel answer.
  if (leftTheBand(pointerY, bounds)) {
    return { drop: false, toIndex: null, reason: "left-canvas" };
  }
  // §3's first cancel. The document would be identical either way — see
  // the header's note on moveNodeToIndex — so this branch exists to make
  // the shell's rule VISIBLE and assertable, not to protect the doc from
  // a change the command would refuse anyway.
  if (dropIndex === fromIndex) {
    return { drop: false, toIndex: null, reason: "origin" };
  }
  return { drop: true, toIndex: dropIndex, reason: "dropped" };
}

/** Has the finger left the box the drag lives in.
 *
 *  VERTICAL ONLY, and that is a decision rather than an omission. The band
 *  spans the frame's full width — there is nothing to either side of it to
 *  leave to — so a horizontal test would guard nothing while adding a
 *  second box read to get wrong. Above the band is the nav header; below it
 *  is the bottom slot. Those are the two places a finger can be that are
 *  not the canvas.
 *
 *  A DEGENERATE BOX IS NOT EVIDENCE OF LEAVING, which is the opposite of
 *  the reflex and is worth the paragraph. `!(bottom > top)` catches a
 *  zero-height box, an inverted one read mid-reflow, and NaN together — the
 *  same three cases and the same guard shape autoScrollSpeed grew at its
 *  own first call, because every box in jsdom is 0x0 and a real browser
 *  hands out the same thing for a frame before layout. The tempting answer
 *  is to cancel on it: cancelling is this feature's safe default, since a
 *  block dropped in the wrong place is worse than one that does not move.
 *  But a box that measures nothing does not say the finger left the canvas;
 *  it says nobody knows where the canvas is. Cancelling on it would make
 *  the whole gesture silently inert for any frame that reads the band
 *  early, and it would do so to prevent a drop that is not wrong — the drop
 *  index comes from the block rects, which are measured on lift and are
 *  entirely unaffected by this box. The hairline was showing the writer
 *  that gap the whole time, so honouring it is the unsurprising answer.
 *  Written down because the trade is real and the other choice is
 *  defensible: what tips it is that the band decides only WHETHER to drop,
 *  never WHERE. */
function leftTheBand(pointerY, bounds) {
  if (!bounds) return false;
  if (!(bounds.bottom > bounds.top)) return false;
  return pointerY < bounds.top || pointerY > bounds.bottom;
}
