import { describe, it, expect } from "vitest";
import { stackBackOutcome } from "../stack-back.js";

const W = { width: 400 };

describe("stackBackOutcome", () => {
  it("commits past 40% of the screen width", () => {
    expect(stackBackOutcome({ dx: 170, velocityX: 0, ...W })).toBe("commit");
  });

  it("springs back short of 40%", () => {
    expect(stackBackOutcome({ dx: 120, velocityX: 0, ...W })).toBe("cancel");
  });

  it("commits on a fast flick however short the drag", () => {
    expect(stackBackOutcome({ dx: 20, velocityX: 1.2, ...W })).toBe("commit");
  });

  it("cancels on a fast flick back toward the origin", () => {
    // Past 40% but thrown leftward: the user changed their mind mid-gesture,
    // and position alone would strand them on the previous screen.
    expect(stackBackOutcome({ dx: 300, velocityX: -1.2, ...W })).toBe("cancel");
  });

  it("cancels when the width is unknown", () => {
    // Not a no-op for its own sake: a zero width means the measurement
    // failed, and committing a navigation on a number we do not trust is
    // how a screen disappears under the user's finger.
    expect(stackBackOutcome({ dx: 500, velocityX: 0, width: 0 })).toBe("cancel");
  });

  it("commits at exactly the commit fraction, not one pixel past it", () => {
    // Pins `>=` in stack-back.js. commitFraction 0.4 of width 400 is 160;
    // with `>` this springs back at exactly the line the design names.
    expect(stackBackOutcome({ dx: 160, velocityX: 0, width: 400 })).toBe("commit");
  });

  it("treats a rightward velocity exactly at the threshold as a slow release", () => {
    // Pins the strict `>`: at exactly 0.5 velocity stops deciding and
    // distance takes over — and 20px of 400 is nowhere near committing.
    expect(stackBackOutcome({ dx: 20, velocityX: 0.5, width: 400 })).toBe("cancel");
  });

  it("treats a leftward velocity exactly at the threshold as a slow release", () => {
    // Pins the strict `<` on the cancel side: at exactly -0.5 the distance
    // decides, and 300 of 400 is past the commit line.
    expect(stackBackOutcome({ dx: 300, velocityX: -0.5, width: 400 })).toBe("commit");
  });
});
