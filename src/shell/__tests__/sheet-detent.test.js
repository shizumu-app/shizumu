import { describe, it, expect } from "vitest";
import { sheetDetent } from "../sheet-detent.js";

const SIZES = { halfPx: 300, fullPx: 600 };

describe("sheetDetent", () => {
  it("snaps back to where it started when barely moved", () => {
    expect(sheetDetent({ from: "half", offsetY: 10, velocityY: 0, ...SIZES })).toBe("half");
    expect(sheetDetent({ from: "full", offsetY: 10, velocityY: 0, ...SIZES })).toBe("full");
  });

  it("drops full to half when dragged most of the way down", () => {
    expect(sheetDetent({ from: "full", offsetY: 250, velocityY: 0, ...SIZES })).toBe("half");
  });

  it("dismisses from half when dragged most of the way down", () => {
    expect(sheetDetent({ from: "half", offsetY: 220, velocityY: 0, ...SIZES })).toBe("dismissed");
  });

  it("rises to full when dragged up from half", () => {
    expect(sheetDetent({ from: "half", offsetY: -200, velocityY: 0, ...SIZES })).toBe("full");
  });

  it("takes a fast flick down one step, however short the drag", () => {
    // Velocity beats position: a fast short flick is an unambiguous intent,
    // and requiring the distance too is what makes a sheet feel stuck.
    expect(sheetDetent({ from: "full", offsetY: 12, velocityY: 1.4, ...SIZES })).toBe("half");
    expect(sheetDetent({ from: "half", offsetY: 12, velocityY: 1.4, ...SIZES })).toBe("dismissed");
  });

  it("dismisses from full on a hard flick, in one gesture", () => {
    // The device report: a one-field sheet at full that "sometimes" could
    // not be dismissed. One-step-per-flick meant two flicks from full, and
    // the slow path needed ~560px of travel. A hard flick is not an aim at
    // half; it is the sheet being thrown away. Removing the
    // dismissVelocity tier from sheet-detent.js turns this "half" and
    // fails it — that is the red proof.
    expect(sheetDetent({ from: "full", offsetY: 12, velocityY: 2.5, ...SIZES })).toBe("dismissed");
  });

  it("dismisses from half on a hard flick too — the tier is not a from-full special case", () => {
    expect(sheetDetent({ from: "half", offsetY: 12, velocityY: 2.5, ...SIZES })).toBe("dismissed");
  });

  it("treats a velocity exactly at the dismiss tier as a one-step flick", () => {
    // Pins the strict `>` on dismissVelocity: at exactly 2px/ms the
    // one-step rule decides, and from full that is half. A `>=` here would
    // widen the throw band by the one value a test can name.
    expect(sheetDetent({ from: "full", offsetY: 12, velocityY: 2, ...SIZES })).toBe("half");
  });

  it("keeps a gentle flick from full at one step even when the tier is lowered to meet it", () => {
    // The two tiers are independent knobs. With dismissVelocity brought
    // down to the flick's own speed the strict `>` still holds it to one
    // step; lifted a hair above, the same flick throws the sheet away.
    const flick = { from: "full", offsetY: 12, velocityY: 1.4, ...SIZES };
    expect(sheetDetent({ ...flick, dismissVelocity: 1.4 })).toBe("half");
    expect(sheetDetent({ ...flick, dismissVelocity: 1.3 })).toBe("dismissed");
  });

  it("snaps a slow drag from full back to half when released just past the half line", () => {
    // Kept on purpose, not an oversight — see the module header. 320px
    // down from full leaves 280px of sheet: 20px past half, 280px short of
    // gone. Direction-wins would dismiss here, and dismissing is the one
    // outcome that costs the user something (the sheets that open at full
    // hold a typed field). A 20px overshoot of the detent they were
    // aiming at is forgiven; a throw or a scrim tap is how the sheet is
    // closed from full in one gesture.
    expect(sheetDetent({ from: "full", offsetY: 320, velocityY: 0, ...SIZES })).toBe("half");
  });

  it("dismisses a slow drag from full once the sheet is nearer gone than half", () => {
    // The other side of the same line, so the case above cannot be passing
    // on "slow drags from full never dismiss".
    expect(sheetDetent({ from: "full", offsetY: 460, velocityY: 0, ...SIZES })).toBe("dismissed");
  });

  it("takes a fast flick up to full", () => {
    expect(sheetDetent({ from: "half", offsetY: -12, velocityY: -1.4, ...SIZES })).toBe("full");
  });

  it("cannot go above full on an upward flick from full", () => {
    // There is no detent above full; the flick is absorbed rather than
    // producing an undefined state the caller would have to guard.
    expect(sheetDetent({ from: "full", offsetY: -80, velocityY: -1.4, ...SIZES })).toBe("full");
  });

  it("treats a velocity exactly at the threshold as a slow release", () => {
    // Pins the strict `>` on velocityThreshold. The threshold is the point
    // where velocity STOPS deciding — at exactly 0.5 position must win, and
    // from `full` with almost no travel that means staying at full.
    expect(sheetDetent({ from: "full", offsetY: 10, velocityY: 0.5, ...SIZES })).toBe("full");
  });

  it("treats an upward velocity exactly at the threshold as a slow release", () => {
    // Pins the strict `<` on -velocityThreshold. Same rule mirrored: at
    // exactly -0.5 the position decides, and a 10px drag from half stays half.
    expect(sheetDetent({ from: "half", offsetY: 10, velocityY: -0.5, ...SIZES })).toBe("half");
  });
});
