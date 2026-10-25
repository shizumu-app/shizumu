import { describe, it, expect } from "vitest";
import { releaseOutcome } from "../drop-release.js";

// A band the finger is comfortably inside for every case that is not about
// the band. 120-600 is the same box PageScreen.test.js stubs, so a
// coordinate here can be read straight across.
const BAND = { top: 120, bottom: 600 };

describe("releaseOutcome — a drop", () => {
  it("drops at the index the drop target named", () => {
    // The index passes straight through, un-adjusted. dropTargetIndex has
    // already made it post-removal, which is what moveBlockTo expects, and
    // a second correction anywhere on this path is the plan's standing
    // warning — a module in the middle is where one would hide best.
    expect(releaseOutcome({ dropIndex: 2, fromIndex: 0, pointerY: 300, bounds: BAND }))
      .toEqual({ drop: true, toIndex: 2, reason: "dropped" });
  });

  it("drops upward as readily as downward", () => {
    // Not a mirror of the case above for its own sake: an upward drag is
    // the one direction where dropTargetIndex applies no shift, so a rule
    // that quietly assumed target > from would still pass every downward
    // assertion in this file.
    expect(releaseOutcome({ dropIndex: 0, fromIndex: 2, pointerY: 200, bounds: BAND }))
      .toEqual({ drop: true, toIndex: 0, reason: "dropped" });
  });

  it("drops at the very top of the container", () => {
    // 0 is a legitimate target and a falsy number, which is the whole
    // reason to say so: a guard written as `if (!dropIndex)` reads
    // "dropped on the first block" as "no target" and cancels the one drag
    // a writer makes most — pulling a block to the top of the page.
    expect(releaseOutcome({ dropIndex: 0, fromIndex: 1, pointerY: 130, bounds: BAND }))
      .toEqual({ drop: true, toIndex: 0, reason: "dropped" });
  });

  it("drops on a band that measures nothing", () => {
    // The degenerate box, and the choice made in it. Every box in jsdom is
    // 0x0 and a real browser reports the same for a frame before layout, so
    // this is not a hypothetical. It does NOT cancel: a box measuring
    // nothing says nobody knows where the canvas is, not that the finger
    // left it — and the index being dropped at comes from the block rects,
    // which this box has no part in. See the module's own paragraph on the
    // trade; the opposite choice would make the gesture silently inert on
    // any frame that read the band early.
    expect(releaseOutcome({ dropIndex: 2, fromIndex: 0, pointerY: 300, bounds: { top: 0, bottom: 0 } }))
      .toEqual({ drop: true, toIndex: 2, reason: "dropped" });
    // An inverted box — read mid-reflow — is the case that answered a
    // confident -12 when autoScrollSpeed met it, so it is guarded by the
    // same form rather than by a second comparison.
    expect(releaseOutcome({ dropIndex: 2, fromIndex: 0, pointerY: 300, bounds: { top: 600, bottom: 120 } }))
      .toEqual({ drop: true, toIndex: 2, reason: "dropped" });
    // And no box at all: Screen's bounds() answers null before its element
    // is bound.
    expect(releaseOutcome({ dropIndex: 2, fromIndex: 0, pointerY: 300, bounds: null }))
      .toEqual({ drop: true, toIndex: 2, reason: "dropped" });
  });
});

describe("releaseOutcome — the two cancels §3 names", () => {
  it("cancels a release back at the block's own index", () => {
    // THE ONLY PLACE THIS RULE IS VISIBLE, and that is why the assertion is
    // on the reason rather than only on `drop: false`. moveNodeToIndex
    // (block-movement.js) returns false when the target equals the block's
    // own index, so a component that ignored this rule and called moveBlock
    // anyway would leave the document byte-identical — a doc-level test
    // cannot tell the rule from its absence, and a probe that removed it
    // would stay green. Two mechanisms hiding each other, which this
    // workstream has now met four times. Here the shell's own answer is
    // readable.
    expect(releaseOutcome({ dropIndex: 1, fromIndex: 1, pointerY: 300, bounds: BAND }))
      .toEqual({ drop: false, toIndex: null, reason: "origin" });
  });

  it("cancels a release above the band and below it", () => {
    // Above is the nav header, below is the bottom slot. Both are "not the
    // canvas", and the block must go back where it was however far the
    // drag had travelled — hence a dropIndex that is emphatically NOT the
    // origin in both, so only this rule can produce the cancel.
    expect(releaseOutcome({ dropIndex: 2, fromIndex: 0, pointerY: 60, bounds: BAND }))
      .toEqual({ drop: false, toIndex: null, reason: "left-canvas" });
    expect(releaseOutcome({ dropIndex: 2, fromIndex: 0, pointerY: 700, bounds: BAND }))
      .toEqual({ drop: false, toIndex: null, reason: "left-canvas" });
  });

  it("keeps the band's own edges inside it", () => {
    // Inclusive on both edges, which matters because the auto-scroll band
    // is the 60px INSIDE each of them: a finger held at the very bottom of
    // the canvas is the case that whole loop exists for, and a rule that
    // read the boundary as "outside" would cancel every drag that used it.
    expect(releaseOutcome({ dropIndex: 2, fromIndex: 0, pointerY: 120, bounds: BAND }).drop).toBe(true);
    expect(releaseOutcome({ dropIndex: 2, fromIndex: 0, pointerY: 600, bounds: BAND }).drop).toBe(true);
  });

  it("reports leaving the canvas even when the gap is the origin", () => {
    // Both cancels apply at once and the answer must still be one of them.
    // Asserted because the reason is what a caller logs and what a test
    // reads, and "origin" here would describe a stroke the writer made
    // deliberately as an accident of where they let go.
    expect(releaseOutcome({ dropIndex: 1, fromIndex: 1, pointerY: 700, bounds: BAND }).reason)
      .toBe("left-canvas");
  });
});

describe("releaseOutcome — nothing to drop at", () => {
  it("cancels when the drag never had a target", () => {
    // null is what PageScreen's dropIndex holds before the first
    // updateDropTarget lands, and what it falls back to when the rects
    // could not be measured. There is no number to move the block to, and
    // the honest answer is not to move it — inventing 0 is the "silently
    // sent to the top of the document" failure drop-target.js's own header
    // refuses for the same reason.
    expect(releaseOutcome({ dropIndex: null, fromIndex: 0, pointerY: 300, bounds: BAND }))
      .toEqual({ drop: false, toIndex: null, reason: "no-target" });
  });

  it("cancels on a non-integer index from either side", () => {
    // NaN is what arithmetic over a degenerate box produces — the exact
    // value autoScrollSpeed returned before its guard — and it does not
    // error downstream, it moves the block to the TOP. Traced rather than
    // assumed: moveNodeToIndex's clamp is Math.max(0, Math.min(NaN, n)),
    // which is NaN; `target === fromIndex` is then false so the delete
    // runs; and its insertion walk is `for (i = 0; i < NaN; i++)`, which
    // never runs, so the block is re-inserted at index 0. A silent move to
    // the top of the document is the one outcome worse than doing nothing,
    // and it is the failure drop-target.js's empty-rects answer refuses for
    // exactly the same reason.
    expect(releaseOutcome({ dropIndex: NaN, fromIndex: 0, pointerY: 300, bounds: BAND }).reason)
      .toBe("no-target");
    expect(releaseOutcome({ dropIndex: 1, fromIndex: undefined, pointerY: 300, bounds: BAND }).reason)
      .toBe("no-target");
  });
});
