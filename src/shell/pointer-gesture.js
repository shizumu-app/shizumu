// The timeline nothing in the shell kept.
//
// `stackBackOutcome` and `sheetDetent` both branch on velocity — a fast
// flick commits or steps a detent however short the drag, and that branch
// is why they exist instead of a plain distance check. Both have shipped
// with that branch fed a hardcoded 0, because nothing upstream ever built
// a velocity from real pointer events: there was no timeline, just the
// touchend position. With velocity pinned at 0, `dx >= width * 0.4` was
// the ONLY path stackBackOutcome could ever take, which is why a real edge
// flick (15-35% of screen width) needed 40% every time.
//
// The naive fix — average the whole stroke's dx over its whole dt — looks
// like a velocity and is not one. A real drag often creeps for a couple
// hundred milliseconds before the actual flick: averaged over the full
// stroke that reads as slow, the terminal flick is diluted into it, and
// the velocity branch still never fires. That failure is silent — the
// function returns a plausible-looking number instead of 0 — which is
// worse than the bug it would replace. Velocity here is read from only the
// last VELOCITY_WINDOW_MS of the stroke for that reason.
//
// A horizontal stroke is always "drag-left" or "drag-right", never a
// separate "pan-horizontal" — an earlier version of this file split them
// by margin, and the split was wrong twice over. First, no row in
// gestureOwner distinguishes a pan from a directional drag: the only row
// that even mentions "pan-horizontal" (header-dots) accepts drag-left and
// drag-right identically, so the split bought nothing there. Second, and
// worse, it silently disabled the back gesture: gestureOwner's left-edge
// row keys off the literal "drag-right" (not "pan-horizontal"), and the
// margin promoted a stroke to "pan-horizontal" precisely when it was
// MORE cleanly horizontal — so the cleanest possible edge-back flick,
// which is the strongest horizontal case there is, always missed the
// left-edge row and fell through to "element". Both modules' own unit
// tests stayed green throughout, because each was correct in isolation;
// only a seam test that runs recognise's output through gestureOwner
// catches it, which is why one exists below.

// RECOGNISE IS TERMINAL, and that is the one thing about this file a
// caller has to know before reaching for it. It takes a FINISHED stroke
// and names it; every answer, "long-press" included, is only available at
// pointerup. That is right for the gestures gestureOwner arbitrates — each
// of them means something the moment the finger leaves — and it is useless
// for a block drag, which has to lift while the finger is still down. A
// lift decided at pointerup is a lift you can never drag.
//
// So P2e's caller (PageScreen's gutter handle) runs the CLOCK itself, as a
// timer, and asks this file the only other question a hold turns on:
// whether the finger stayed put. `strokeMoved` below is that question, and
// exporting it rather than re-deriving 10px at the call site is what keeps
// the two surfaces answering with one number — the same reason EDGE_PX
// sits next to the table that reads it. LONG_PRESS_MS is exported for the
// same reason: the scheduler may own when it asks, never how long.

// Touch slop: below this total displacement, the pointer didn't drag at
// all, and duration alone decides tap vs long-press. 10px matches the
// touch-slop constants both major mobile platforms use — small enough
// that a real tap never crosses it, large enough that finger jitter during
// a genuine long-press doesn't get misread as a drag.
const TAP_SLOP_PX = 10;

// §3's threshold: held past this with no real movement is a long-press.
export const LONG_PRESS_MS = 350;

// How far back from the last point the velocity sample looks. Long enough
// to smooth adjacent-sample jitter in a real event stream, short enough
// that a terminal flick after a slow crawl is measured on its own, not
// blended with the crawl before it.
const VELOCITY_WINDOW_MS = 100;

/**
 * Has this stroke travelled far enough to be a drag rather than a press?
 *
 * The touch-slop half of `recognise`'s tap/long-press test, pulled out so a
 * caller watching a stroke MID-flight can ask it without waiting for the
 * pointerup that `recognise` needs. Both call it, so there is one slop in
 * the shell and not two.
 *
 * Measured first-point to LAST point, exactly as `recognise` measures it —
 * not as a path length. A finger that wanders 40px away and comes back to
 * where it started has not dragged anything; it has jittered, which is what
 * the slop exists to forgive.
 *
 * @param {{x: number, y: number, t: number}[]} points  in event order
 */
export function strokeMoved(points) {
  const list = points || [];
  if (list.length === 0) return false;
  const first = list[0];
  const last = list[list.length - 1];
  return Math.max(Math.abs(last.x - first.x), Math.abs(last.y - first.y)) >= TAP_SLOP_PX;
}

function regionFor(points, edgePx) {
  if (points.length === 0 || edgePx == null) return null;
  return Math.abs(points[0].x) <= edgePx ? "left-edge" : null;
}

// Endpoint-to-endpoint velocity over whichever two points bound the
// sample. `dt <= 0` covers both a same-millisecond pair (a real event
// stream repeats timestamps) and any out-of-order input — either way,
// dividing would produce Infinity or NaN, and 0 is the only value neither
// stackBackOutcome's nor sheetDetent's `>`/`<` comparisons can misread as
// a real flick.
function endpointVelocity(a, b) {
  const dt = b.t - a.t;
  if (dt <= 0) return { velocityX: 0, velocityY: 0 };
  return { velocityX: (b.x - a.x) / dt, velocityY: (b.y - a.y) / dt };
}

function tailVelocity(points) {
  const lastT = points[points.length - 1].t;
  let window = points.filter((p) => p.t >= lastT - VELOCITY_WINDOW_MS);
  // A window that collapses to one point (every recent sample landed on
  // the same millisecond) still needs two points to measure from — fall
  // back to the last two raw points rather than reporting a false 0. This
  // makes VELOCITY_WINDOW_MS a soft bound, not a hard one: if the stream
  // is sparse enough that even the last two raw points are more than
  // VELOCITY_WINDOW_MS apart, this measures across that wider gap instead
  // of refusing to answer. That's the right trade for a real touch
  // stream, which fires far more often than every 100ms — the fallback
  // exists for the rare same-millisecond cluster, not for sparse input —
  // but anyone retuning the constant should not assume it caps the gap
  // this function actually measures over.
  if (window.length < 2) window = points.slice(-2);
  return endpointVelocity(window[0], window[window.length - 1]);
}

// Whichever axis moved further wins; its sign picks the direction. No
// margin, no separate "pan" case — see the file header for why.
function classifyDirection(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "drag-right" : "drag-left";
  return dy >= 0 ? "drag-down" : "drag-up";
}

/**
 * @param {object} input
 * @param {{x: number, y: number, t: number}[]} input.points  in event order, t in ms
 * @param {number} input.edgePx  distance from x=0 that counts as the left edge
 * @returns {{
 *   gesture: "drag-up"|"drag-down"|"drag-left"|"drag-right"|"tap"|"long-press",
 *   dx: number, dy: number,
 *   velocityX: number, velocityY: number,
 *   region: "left-edge"|null,
 * }}
 */
export function recognise({ points, edgePx }) {
  const list = points || [];
  const region = regionFor(list, edgePx);

  if (list.length === 0) {
    return { gesture: "tap", dx: 0, dy: 0, velocityX: 0, velocityY: 0, region };
  }

  const first = list[0];
  const last = list[list.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;

  if (!strokeMoved(list)) {
    // A single point falls here too: first === last, so dx/dy/elapsed are
    // all trivially 0 without a separate branch for it.
    const elapsed = last.t - first.t;
    const gesture = elapsed >= LONG_PRESS_MS ? "long-press" : "tap";
    return { gesture, dx, dy, velocityX: 0, velocityY: 0, region };
  }

  const { velocityX, velocityY } = tailVelocity(list);
  return { gesture: classifyDirection(dx, dy), dx, dy, velocityX, velocityY, region };
}
