// Where a dragged block would land, and when the canvas should scroll itself.
//
// Drag-to-reorder on touch is a shell-owned pointer interaction, not
// ProseMirror's or HTML5's — both are unreliable under a finger (§3). That
// leaves the shell holding the geometry, which is exactly the kind of
// arithmetic that rots inside a component where no test can reach it.
//
// The caller measures and passes rects for ONE container's children only:
// a board's blocks reorder inside the board, and a top-level block never
// drops into a board. Filtering the rects is the caller's job because only
// it knows the doc structure; this module's contract is that the index it
// returns is the index `EditorCore.moveBlock`/`moveBlockTo` expects, i.e.
// AFTER the dragged block is removed from its parent — not a raw insertion
// point among the rects as measured.
//
// That distinction is load-bearing because of how `moveBlockTo`
// (block-movement.js) actually moves a node: it deletes the block at
// `fromPos` FIRST, then walks the now-one-shorter parent to find `toIndex`.
// The rects here still include the dragged block (they are measured on
// lift, before anything moves), so the raw insertion point computed over
// them is a PRE-removal index — one too high for every downward drag, where
// the dragged block's own rect sits before the target and disappears from
// the count once it moves. Decrementing only when the raw target is past
// `fromIndex` corrects exactly that: an upward drag's target already sits
// before the gap the removal leaves, so it needs no adjustment.
//
// An empty rect list returns fromIndex rather than 0. The rects are measured
// on lift, so "no rects" means the measurement has not happened yet — and a
// drop that silently moves the block to the top of the document is a far
// worse answer than a drop that does nothing.
//
// scrollTop/liftScrollTop compensate for the canvas scrolling DURING the
// drag. `blockRects` are measured once, on lift, as viewport-relative
// `top`s; autoScrollSpeed below exists specifically to scroll the canvas
// while a block is held at an edge, which invalidates every one of those
// tops the instant the canvas moves. Each rect's current top is
// `r.top - (scrollTop - liftScrollTop)`: as the canvas scrolls down
// (scrollTop grows past liftScrollTop) a rect's on-screen position moves up
// by the same amount, so the correction subtracts the delta. Both default
// to 0, which makes the compensation a no-op — every pre-existing caller
// and test is unaffected.
//
// Only their DIFFERENCE is used, which is worth saying because the two
// names promise more than the code asks for: nothing here cares what a
// scroller's absolute scrollTop is, only how far the canvas has travelled
// since the rects were taken. A caller that can measure that travel more
// directly than by reading scrollTop twice may pass it as `scrollTop` and
// leave `liftScrollTop` at 0 — PageScreen does exactly that, off the
// canvas element's own box, and says why at its call site.

/**
 * @param {object} drag
 * @param {number} drag.pointerY            the finger, in viewport px
 * @param {Array<{top: number, height: number}>} drag.blockRects  siblings, in order, as
 *   measured on lift (viewport-relative, uncompensated for later scrolling)
 * @param {number} [drag.fromIndex]         where the dragged block started
 * @param {number} [drag.scrollTop]         the canvas's current scroll offset
 * @param {number} [drag.liftScrollTop]     the canvas's scroll offset when the rects were measured
 * @returns {number} the post-removal sibling index moveBlockTo expects, in [0, blockRects.length - 1]
 */
export function dropTargetIndex({ pointerY, blockRects, fromIndex = 0, scrollTop = 0, liftScrollTop = 0 }) {
  if (!Array.isArray(blockRects) || blockRects.length === 0) return fromIndex;
  const delta = scrollTop - liftScrollTop;
  let raw = blockRects.length;
  for (let i = 0; i < blockRects.length; i++) {
    const top = blockRects[i].top - delta;
    if (pointerY < top + blockRects[i].height / 2) {
      raw = i;
      break;
    }
  }
  return raw > fromIndex ? raw - 1 : raw;
}

// WHY DRAWING THE INDICATOR NEEDS A SECOND FUNCTION, found at
// dropTargetIndex's first caller (P2e Task 2) rather than reasoned about
// in advance. The index above is POST-removal, and the blocks on screen
// are PRE-removal — the drag moves nothing until the finger comes off. So
// a caller that draws a hairline at `blockRects[dropTargetIndex(...)]`
// draws it one block too HIGH on every downward drag: drag block 0 to
// between 1 and 2 and the answer is 1, whose rect is block 1's top, which
// is the gap the finger already passed.
//
// That is not a defect in dropTargetIndex — its contract is the index
// moveBlockTo wants, and it is right. It is that "where it lands in the
// document" and "which gap to draw in" are two different questions over
// two different lists, and only the first one had a function.
//
// Inverting the decrement here rather than in the caller is the point:
// the plan's standing warning is "do not double-correct in the caller",
// and a caller doing this arithmetic inline is indistinguishable at a
// glance from one doing exactly that. Named, it says which list it is
// counting in.
//
// The one ambiguity, and the choice made in it. `raw > fromIndex ? raw - 1
// : raw` is not injective: raw === fromIndex and raw === fromIndex + 1
// both answer fromIndex. Both mean the same thing — the block does not
// move (moveNodeToIndex returns false when target === fromIndex) — so
// they differ only in which edge of the dragged block the line is drawn
// on. This takes the block's own TOP, which reads as "back where it came
// from" rather than as a gap below it.
/**
 * @param {number} targetIndex  what dropTargetIndex answered (post-removal)
 * @param {number} fromIndex    where the dragged block started
 * @returns {number} the gap to draw in, counted over the blocks as they are
 *   still laid out: 0 is above the first, blockRects.length is below the last
 */
export function insertionLineIndex(targetIndex, fromIndex) {
  return targetIndex > fromIndex ? targetIndex + 1 : targetIndex;
}

/**
 * @param {object} edge
 * @param {number} edge.pointerY   the finger, in viewport px
 * @param {number} edge.top        top of the scrollable canvas, viewport px
 * @param {number} edge.bottom     bottom of the scrollable canvas, viewport px
 * @param {number} [edge.band]     px from each edge where auto-scroll arms
 * @param {number} [edge.max]      px per frame at the very edge
 * @returns {number} px per frame; negative scrolls toward the top
 */
export function autoScrollSpeed({ pointerY, top, bottom, band = 60, max = 12 }) {
  // On a short canvas the two bands can overlap (band > half the canvas
  // height). Without a clamp a pointer in the overlap falls into whichever
  // `if` runs first — the top band — so a finger held near the BOTTOM of a
  // short canvas would scroll up. Clamping the effective band to at most
  // half the canvas keeps the two bands from ever overlapping.
  const effectiveBand = Math.min(band, (bottom - top) / 2);
  // FOUND AT THE FIRST CALLER (P2e Task 2), and it is a division by zero
  // dressed as a clamp. The line above already narrows the band on a short
  // canvas; on a canvas of NO height it narrows it to 0, and then
  // `depth / effectiveBand` is 0/0 — NaN, returned as a scroll speed. The
  // caller adds that to a scroll position, and `el.scrollTop += NaN` is
  // NaN, which the browser coerces to 0: a block held anywhere near a
  // degenerate band would send the document to the very top.
  //
  // A zero-height band is not hypothetical. Every box in jsdom is 0x0, so
  // this is what the whole suite and the VR harness see for any band they
  // have not stubbed; in a real browser it is a frame before layout, or an
  // ancestor still display:none. An INVERTED band (bottom < top, a box read
  // mid-reflow) is worse than NaN — it made effectiveBand negative, which
  // flipped both comparisons and answered a confident -12 for a finger
  // nowhere near the top.
  //
  // Zero is the honest answer to both: a canvas with no height has nothing
  // to scroll. Guarded here rather than at the call site because it is this
  // function's arithmetic that breaks down, and a caller-side guard would
  // leave the next caller to rediscover it.
  if (!(effectiveBand > 0)) return 0;
  if (pointerY < top + effectiveBand) {
    const depth = Math.min(effectiveBand, top + effectiveBand - pointerY);
    return -Math.round((depth / effectiveBand) * max);
  }
  if (pointerY > bottom - effectiveBand) {
    const depth = Math.min(effectiveBand, pointerY - (bottom - effectiveBand));
    return Math.round((depth / effectiveBand) * max);
  }
  return 0;
}
