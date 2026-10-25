import { describe, it, expect } from "vitest";
import { dropTargetIndex, autoScrollSpeed, insertionLineIndex } from "../drop-target.js";

// Three stacked blocks, 100px each, starting at y=0. Midpoints: 50, 150, 250.
const RECTS = [
  { top: 0, height: 100 },
  { top: 100, height: 100 },
  { top: 200, height: 100 },
];

describe("dropTargetIndex", () => {
  it("targets the slot above a block while the pointer is in its top half", () => {
    expect(dropTargetIndex({ pointerY: 20, blockRects: RECTS, fromIndex: 2 })).toBe(0);
    expect(dropTargetIndex({ pointerY: 120, blockRects: RECTS, fromIndex: 2 })).toBe(1);
  });

  it("targets the slot below once the pointer passes the midpoint", () => {
    expect(dropTargetIndex({ pointerY: 60, blockRects: RECTS, fromIndex: 2 })).toBe(1);
  });

  it("targets the end when the pointer is past the last block", () => {
    // [A,B,C], dragging A (fromIndex 0) past C. The raw insertion point over
    // the lift-time rects is 3 (past everything), but moveBlockTo walks the
    // PARENT AFTER A IS REMOVED — [B,C], 2 children — so the correct
    // "append at the end" index is 2, not 3. This is the downward-shift
    // rule from block-movement.js's moveNodeToIndex: it deletes fromPos
    // first, then resolves toIndex against the shorter parent.
    expect(dropTargetIndex({ pointerY: 400, blockRects: RECTS, fromIndex: 0 })).toBe(2);
  });

  it("stays put when there is nothing to compare against", () => {
    // An empty container is not a drop of "index 0" — it is a drag with no
    // geometry yet (the rects are measured on lift). Returning fromIndex
    // makes the drop a no-op instead of a silent move to the top.
    expect(dropTargetIndex({ pointerY: 50, blockRects: [], fromIndex: 2 })).toBe(2);
  });

  it("targets the slot below when the pointer sits exactly on a midpoint", () => {
    // Pins the strict `<` in dropTargetIndex. Exactly on block 0's midpoint
    // (50) the pointer has reached the halfway line, so the block belongs
    // after it; with `<=` it would land before, and a drop right on the
    // line would go the wrong way.
    expect(dropTargetIndex({ pointerY: 50, blockRects: RECTS, fromIndex: 2 })).toBe(1);
  });

  it("shifts a downward drop's index by one, to land on the post-removal sibling", () => {
    // [A,B,C], dragging A (index 0) to between B and C. The raw target over
    // the lift-time rects (which still include A's own rect) is 2; once A
    // is removed the parent is [B,C] and "between B and C" is index 1.
    // Without the decrement this drops A after C instead of between B
    // and C — every downward drag was off by one.
    expect(dropTargetIndex({ pointerY: 200, blockRects: RECTS, fromIndex: 0 })).toBe(1);
  });

  it("leaves an upward drop's index alone — it already precedes the removal gap", () => {
    // [A,B,C], dragging C (index 2) up to between A and B. The raw target
    // is 1, and C's own rect (index 2) sits AFTER the target, so removing
    // C does not shift anything before it. No decrement applies.
    expect(dropTargetIndex({ pointerY: 100, blockRects: RECTS, fromIndex: 2 })).toBe(1);
  });

  it("compensates for the canvas having scrolled since the rects were measured on lift", () => {
    // The canvas scrolled down 100px after lift; RECTS' tops (measured at
    // liftScrollTop 0) no longer describe where the blocks sit on screen.
    // Uncompensated, pointerY 75 reads as just above block 1's stale
    // midpoint (150). Compensated for the 100px scroll, the blocks have
    // visually moved up by 100px too, so the same finger position is now
    // past block 1 and into block 2 — a different answer.
    const uncompensated = dropTargetIndex({ pointerY: 75, blockRects: RECTS, fromIndex: 0 });
    const compensated = dropTargetIndex({
      pointerY: 75,
      blockRects: RECTS,
      fromIndex: 0,
      scrollTop: 100,
      liftScrollTop: 0,
    });
    expect(uncompensated).toBe(0);
    expect(compensated).toBe(1);
  });
});

// The other half of the same geometry, and the reason it exists is in
// drop-target.js's header: dropTargetIndex counts in the document AFTER the
// dragged block is removed, and the indicator has to be drawn among the
// blocks as they are STILL laid out. The two lists differ by exactly one
// element, and every case below is a round trip through the pair.
describe("insertionLineIndex", () => {
  it("draws a downward drop below the block the finger has passed", () => {
    // [A,B,C], dragging A between B and C. dropTargetIndex answers 1 — the
    // post-removal index in [B,C]. Drawn at rect 1 that hairline is B's
    // top, a gap the finger crossed some time ago; the gap it is actually
    // over is rect 2's top. This off-by-one is the whole reason for the
    // function: it is invisible to dropTargetIndex's own tests, because
    // there is nothing wrong with the index they assert.
    const target = dropTargetIndex({ pointerY: 200, blockRects: RECTS, fromIndex: 0 });
    expect(target).toBe(1);
    expect(insertionLineIndex(target, 0)).toBe(2);
  });

  it("leaves an upward drop's gap where the index already points", () => {
    // [A,B,C], dragging C up between A and B: the target is 1 and rect 1's
    // top IS that gap. Nothing before the removal gap shifts, so nothing to
    // undo — the same asymmetry dropTargetIndex's decrement has.
    const target = dropTargetIndex({ pointerY: 100, blockRects: RECTS, fromIndex: 2 });
    expect(target).toBe(1);
    expect(insertionLineIndex(target, 2)).toBe(1);
  });

  it("draws past the last block when the drop appends", () => {
    // The one gap that has no rect of its own: below the last block. The
    // caller reads it off the last rect's bottom, so the index has to be
    // able to say `length` rather than clamping into the array.
    const target = dropTargetIndex({ pointerY: 400, blockRects: RECTS, fromIndex: 0 });
    expect(target).toBe(2);
    expect(insertionLineIndex(target, 0)).toBe(RECTS.length);
  });

  it("draws on the dragged block's own top when the drop would not move it", () => {
    // target === fromIndex is the no-op drop — moveNodeToIndex refuses it
    // outright. Two raw gaps map onto it (the block's top and the gap below
    // it) and this picks the top, which reads as "back where it came from".
    expect(insertionLineIndex(1, 1)).toBe(1);
    expect(insertionLineIndex(0, 0)).toBe(0);
  });
});

describe("autoScrollSpeed", () => {
  it("does not scroll while the pointer is in the middle of the canvas", () => {
    // Zero is the correct answer everywhere except the two 60px bands; a
    // canvas that creeps while the user holds a block still is unusable.
    expect(autoScrollSpeed({ pointerY: 400, top: 100, bottom: 700 })).toBe(0);
  });

  it("scrolls up, harder the closer to the top edge", () => {
    const near = autoScrollSpeed({ pointerY: 105, top: 100, bottom: 700 });
    const far = autoScrollSpeed({ pointerY: 150, top: 100, bottom: 700 });
    expect(near).toBeLessThan(0);
    expect(far).toBeLessThan(0);
    expect(near).toBeLessThan(far);
  });

  it("scrolls down inside the bottom band", () => {
    expect(autoScrollSpeed({ pointerY: 695, top: 100, bottom: 700 })).toBeGreaterThan(0);
  });

  it("never exceeds the maximum step", () => {
    // Past the band the speed clamps rather than growing with the overshoot:
    // a finger held outside the canvas would otherwise accelerate forever.
    expect(autoScrollSpeed({ pointerY: 0, top: 100, bottom: 700, max: 12 })).toBe(-12);
    expect(autoScrollSpeed({ pointerY: 900, top: 100, bottom: 700, max: 12 })).toBe(12);
  });

  it("does not auto-scroll at the exact top of the band", () => {
    // Locks the behavior at the band's outer edge: standing exactly on it,
    // nothing scrolls. Note this does NOT pin the strict `<` — at exactly
    // top + band the depth is 0, so `<=` computes the same magnitude. It
    // fails under that mutation only because the branch returns -0 and
    // Object.is(-0, 0) is false, which is an accident of signed zero, not
    // a guard. The behavior is what matters here, and the behavior is 0.
    expect(autoScrollSpeed({ pointerY: 160, top: 100, bottom: 700 })).toBe(0);
  });

  it("does not auto-scroll at the exact start of the bottom band", () => {
    // Locks the behavior at the bottom band's outer edge. Unlike its
    // mirror above, this one cannot fail under `>` → `>=` at all: at
    // exactly bottom - band the depth is 0, so both operators return 0.
    // It documents the boundary; it does not pin the operator.
    expect(autoScrollSpeed({ pointerY: 640, top: 100, bottom: 700 })).toBe(0);
  });

  it("does not let overlapping bands on a short canvas scroll the wrong way", () => {
    // A 60px band on a 100px-tall canvas (top:100, bottom:200) overlaps
    // itself in [140,160]. Unclamped, the top branch runs first and wins
    // the whole overlap — so a pointer at 155, which is past the canvas's
    // own midpoint (150) and genuinely closer to the bottom, would scroll
    // UP. Clamping the effective band to half the canvas height removes
    // the overlap so the bottom band gets the points that are actually its.
    const d = autoScrollSpeed({ pointerY: 155, top: 100, bottom: 200 });
    expect(d).toBeGreaterThan(0);
  });

  it("answers 0 rather than NaN for a canvas with no height", () => {
    // The defect the first caller found. The overlap clamp above narrows
    // the band to half the canvas; on a zero-height canvas that is 0, and
    // `depth / effectiveBand` becomes 0/0. NaN is not a harmless answer
    // here — the caller does `scrollTop += speed`, and NaN coerces to 0, so
    // a block held near the band would fling the document to the top.
    //
    // Asserted with toBe(0) and not toBeFalsy or !isNaN: NaN is falsy, and
    // a test that only refused NaN would pass on any wrong number.
    expect(autoScrollSpeed({ pointerY: 140, top: 0, bottom: 0 })).toBe(0);
    expect(autoScrollSpeed({ pointerY: -5, top: 0, bottom: 0 })).toBe(0);
  });

  it("answers 0 for a band read upside down", () => {
    // bottom < top is a box read mid-reflow, and it used to be worse than
    // NaN: a negative effectiveBand flipped both comparisons, so a finger at
    // 140 against a band of [600, 100] got a confident -12 — full-speed
    // scrolling in a direction nothing asked for. Zero is the answer to a
    // band that does not describe a canvas.
    expect(autoScrollSpeed({ pointerY: 140, top: 600, bottom: 100 })).toBe(0);
  });
});
