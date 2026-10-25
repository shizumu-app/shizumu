import { describe, it, expect } from "vitest";
import { recognise, strokeMoved, LONG_PRESS_MS } from "../pointer-gesture.js";
import { gestureOwner } from "../gesture-owner.js";

describe("recognise", () => {
  it("calls a single point a tap with zero velocity", () => {
    // Not a special case bolted on: one point means first === last, so
    // distance and elapsed time are both trivially zero and the ordinary
    // "didn't move" path already lands here. Written out anyway because
    // stackBackOutcome and sheetDetent both divide by whatever this
    // reports — a tap that leaked a nonzero velocity would commit a
    // navigation nobody dragged for.
    const out = recognise({ points: [{ x: 40, y: 40, t: 0 }], edgePx: 24 });
    expect(out.gesture).toBe("tap");
    expect(out.dx).toBe(0);
    expect(out.dy).toBe(0);
    expect(out.velocityX).toBe(0);
    expect(out.velocityY).toBe(0);
  });

  it("calls 400ms with no movement a long-press", () => {
    // Time without distance is a press, not a tap — the finger held still
    // long enough (past §3's 350ms line) that it can't be a quick touch.
    const out = recognise({
      points: [
        { x: 40, y: 40, t: 0 },
        { x: 42, y: 39, t: 400 },
      ],
      edgePx: 24,
    });
    expect(out.gesture).toBe("long-press");
  });

  it("pins the long-press line at exactly 350ms, not one tick short", () => {
    // Mirrors stack-back.js's own boundary tests: the threshold is a
    // specific number from §3, not "long-ish", so both edges of it are
    // pinned rather than left to whatever the implementation happens to do.
    const held = (t) =>
      recognise({
        points: [
          { x: 0, y: 0, t: 0 },
          { x: 1, y: 0, t },
        ],
        edgePx: 24,
      }).gesture;
    expect(held(349)).toBe("tap");
    expect(held(350)).toBe("long-press");
  });

  it("reads a downward trend as drag-down", () => {
    const out = recognise({
      points: [
        { x: 100, y: 0, t: 0 },
        { x: 105, y: 80, t: 100 },
      ],
      edgePx: 24,
    });
    expect(out.gesture).toBe("drag-down");
  });

  it("reads an upward trend as drag-up", () => {
    const out = recognise({
      points: [
        { x: 100, y: 80, t: 0 },
        { x: 105, y: 0, t: 100 },
      ],
      edgePx: 24,
    });
    expect(out.gesture).toBe("drag-up");
  });

  it("reads a rightward trend as drag-right", () => {
    // dx=80, dy=50: horizontal is bigger, so it wins outright — no margin
    // gate any more (see the strongly-horizontal test below for why one
    // existed briefly and why it was wrong).
    const out = recognise({
      points: [
        { x: 0, y: 0, t: 0 },
        { x: 80, y: 50, t: 100 },
      ],
      edgePx: 24,
    });
    expect(out.gesture).toBe("drag-right");
  });

  it("reads a leftward trend as drag-left", () => {
    const out = recognise({
      points: [
        { x: 80, y: 0, t: 0 },
        { x: 0, y: 50, t: 100 },
      ],
      edgePx: 24,
    });
    expect(out.gesture).toBe("drag-left");
  });

  it("classifies a strongly-horizontal drag as drag-right, not a separate pan gesture", () => {
    // dx=200 against dy=20 is a 10x margin. An earlier version of this
    // function read that as confidently horizontal and emitted
    // "pan-horizontal" instead of a directional label — which was
    // backwards: gestureOwner's left-edge row keys off the literal
    // "drag-right" (gesture-owner.js:64), so the MORE cleanly horizontal a
    // flick was, the LESS likely it was to ever reach "back". No row
    // distinguishes a pan from a directional drag anyway — header-dots
    // accepts drag-left/drag-right/tap exactly the same as it would accept
    // a pan (gesture-owner.js:82) — so the split bought nothing and broke
    // the one row that cared. See the seam test below, which is what
    // actually caught this.
    const out = recognise({
      points: [
        { x: 0, y: 0, t: 0 },
        { x: 200, y: 20, t: 100 },
      ],
      edgePx: 24,
    });
    expect(out.gesture).toBe("drag-right");
  });

  it("reports the flick's own speed, not the whole stroke's average", () => {
    // This is the case the module exists for. The stroke crawls 10px over
    // 300ms (0.03 px/ms — well under stackBackOutcome's 0.5 threshold) and
    // then covers 60px in the last 50ms (1.2 px/ms — comfortably over it).
    // Averaged across the full 350ms the whole thing reads as 0.2 px/ms,
    // which never crosses the threshold: a flick reported at the average
    // is indistinguishable from no flick at all, which is exactly the bug
    // stackBackOutcome shipped with when it was fed a hardcoded 0.
    const out = recognise({
      points: [
        { x: 0, y: 0, t: 0 },
        { x: 5, y: 0, t: 150 },
        { x: 10, y: 0, t: 300 },
        { x: 70, y: 0, t: 350 },
      ],
      edgePx: 24,
    });
    expect(out.velocityX).toBeCloseTo(1.2, 5);
  });

  it("reports zero velocity when two points share a timestamp", () => {
    // Not a division that happens to come out at 0 — a real event stream
    // repeats a millisecond often enough that this has to be a deliberate
    // guard. The alternative is dividing by zero, which is Infinity or
    // NaN, and either one poisons stackBackOutcome's `>` comparisons into
    // committing or cancelling on a value that was never a real speed.
    const out = recognise({
      points: [
        { x: 0, y: 0, t: 100 },
        { x: 50, y: 50, t: 100 },
      ],
      edgePx: 24,
    });
    expect(out.velocityX).toBe(0);
    expect(out.velocityY).toBe(0);
  });

  it("never throws on an empty points list", () => {
    // No points carry no signal at all. Returning the same neutral shape
    // a tap gets — rather than null, undefined, or a throw — means a
    // caller that always destructures { gesture, dx, dy } doesn't need a
    // separate guard for "the pointer stream was empty".
    const out = recognise({ points: [], edgePx: 24 });
    expect(out.gesture).toBe("tap");
    expect(out.dx).toBe(0);
    expect(out.dy).toBe(0);
    expect(out.velocityX).toBe(0);
    expect(out.velocityY).toBe(0);
    expect(out.region).toBe(null);
  });

  it("never throws when points is missing entirely", () => {
    expect(() => recognise({ edgePx: 24 })).not.toThrow();
  });

  it("marks the region left-edge when the first point starts within edgePx", () => {
    const out = recognise({
      points: [
        { x: 10, y: 0, t: 0 },
        { x: 90, y: 0, t: 100 },
      ],
      edgePx: 24,
    });
    expect(out.region).toBe("left-edge");
  });

  it("leaves region null when the first point starts past edgePx", () => {
    // The caller derives every other region from the element under the
    // finger; this module only ever knows the one geometric fact an
    // element can't tell it — where the stroke started relative to the
    // screen edge.
    const out = recognise({
      points: [
        { x: 30, y: 0, t: 0 },
        { x: 90, y: 0, t: 100 },
      ],
      edgePx: 24,
    });
    expect(out.region).toBe(null);
  });

  it("hands gestureOwner a flick it can actually route to back", () => {
    // The seam, not either module alone. gesture-owner.js:114 keys the
    // left-edge row off the literal "drag-right", so any classification
    // that turns a clean edge flick into something else disables back
    // silently — both modules' own tests stay green while the gesture is
    // dead. A real flick carries vertical drift from the arc of a thumb;
    // this is one.
    //
    // recognise reports the edge as a region name and the table takes it
    // as `atLeftEdge`, so the conversion is part of the seam and belongs
    // here rather than being assumed away — Task 6 split those two facts
    // apart precisely because collapsing them let a marked region hide
    // the edge from the row that owns it.
    const r = recognise({
      points: [
        { x: 5, y: 300, t: 0 },
        { x: 60, y: 303, t: 30 },
        { x: 140, y: 307, t: 60 },
        { x: 200, y: 310, t: 90 },
      ],
      edgePx: 24,
    });
    expect(
      gestureOwner({
        atLeftEdge: r.region === "left-edge",
        gesture: r.gesture,
        edgeBackArmed: true,
      }),
    ).toBe("back");
  });

  it("hands gestureOwner a vertical drag it can route back to the page", () => {
    // Mirrors the seam test above on the other axis: pins the vertical
    // classification against the table too, at the row that returns to
    // PAGE from memory (canvas region, drag-down, at memory's scroll top).
    const r = recognise({
      points: [
        { x: 200, y: 40, t: 0 },
        { x: 205, y: 200, t: 120 },
      ],
      edgePx: 24,
    });
    expect(
      gestureOwner({ region: "canvas", gesture: r.gesture, atScrollTop: true, space: "memory" }),
    ).toBe("page");
  });

  it("hands gestureOwner a horizontal drag the dots row still accepts", () => {
    // The claim this module's header rests on: no row distinguishes a pan
    // from a directional drag, so dropping "pan-horizontal" cost nothing.
    // header-dots is the row that argument is about — it accepts
    // pan-horizontal, drag-left, drag-right and tap alike — so pin it here
    // rather than leaving the justification as prose. If that row is ever
    // narrowed, this fails and says why.
    const r = recognise({
      points: [
        { x: 200, y: 120, t: 0 },
        { x: 150, y: 123, t: 30 },
        { x: 90, y: 126, t: 60 },
      ],
      edgePx: 24,
    });
    expect(gestureOwner({ region: "header-dots", gesture: r.gesture })).toBe("page-switch");
  });
});

// The touch slop on its own, for the caller `recognise` cannot serve. A
// block drag has to lift while the finger is still down, and `recognise`
// answers only for a finished stroke — so PageScreen runs the clock and
// asks this the other half of the same question. These hold that the two
// callers share one number rather than agreeing by coincidence.
describe("strokeMoved", () => {
  const at = (x, y, t) => ({ x, y, t });

  it("is false for a press that stayed inside the slop", () => {
    // Not "nothing happened": a hold that jitters 9px is the ordinary shape
    // of a real finger held still for a third of a second, and calling it a
    // drag is how a long press stops arming on a device while every unit
    // test stays green.
    expect(strokeMoved([at(100, 100, 0), at(104, 96, 200), at(109, 100, 340)])).toBe(false);
  });

  it("is true once either axis crosses the slop", () => {
    expect(strokeMoved([at(100, 100, 0), at(100, 140, 60)])).toBe(true);
    expect(strokeMoved([at(100, 100, 0), at(60, 100, 60)])).toBe(true);
  });

  it("measures to the last point, not along the path", () => {
    // A finger that wanders and comes back has not dragged anything. Path
    // length would call this a 80px drag and cancel a hold the writer is
    // still making — and `recognise` measures first-to-last for exactly the
    // same reason, which is why these two must not diverge.
    expect(strokeMoved([at(100, 100, 0), at(140, 100, 40), at(102, 100, 90)])).toBe(false);
  });

  it("answers for a stroke with nothing in it", () => {
    // An empty list is a press with no samples yet — the frame between
    // pointerdown being handled and the first coordinate landing. False is
    // the only safe answer: true would abandon every press before it began.
    expect(strokeMoved([])).toBe(false);
    expect(strokeMoved(undefined)).toBe(false);
  });

  it("agrees with recognise about where the slop is", () => {
    // One number, two callers. A stroke this says has not moved must still
    // classify as a press rather than a drag, or the mid-stroke lift and the
    // terminal classifier would disagree about the same finger.
    const points = [at(100, 100, 0), at(109, 100, LONG_PRESS_MS)];
    expect(strokeMoved(points)).toBe(false);
    expect(recognise({ points, edgePx: 24 }).gesture).toBe("long-press");
  });
});
