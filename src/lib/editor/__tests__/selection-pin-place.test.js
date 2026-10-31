import { describe, it, expect } from "vitest";
import { selectionEndRect, pinButtonTop } from "../selection-pin-place.js";

const rect = (top, right, width = 100, height = 18) => ({ top, right, width, height });

describe("selectionEndRect", () => {
  it("sits by the line a multi-block selection ends on, not the one it starts on", () => {
    // Dragged from a paragraph at y=120 down to a list item at y=940: the
    // whole box's top is 120, which put the button above the drag's start.
    const range = {
      getClientRects: () => [rect(120, 600), rect(140, 580), rect(940, 310)],
      getBoundingClientRect: () => ({ top: 120, right: 600, width: 500, height: 838 }),
    };
    expect(selectionEndRect(range)).toEqual({ top: 940, bottom: 958, right: 310 });
  });

  it("skips empty line boxes at the end, which a selection ending at a block boundary has", () => {
    const range = { getClientRects: () => [rect(120, 600), rect(300, 420), rect(320, 0, 0, 0)] };
    expect(selectionEndRect(range)).toEqual({ top: 300, bottom: 318, right: 420 });
  });

  it("falls back to the whole box, then to nothing", () => {
    expect(selectionEndRect({ getClientRects: () => [], getBoundingClientRect: () => rect(50, 200) })).toEqual({ top: 50, bottom: 68, right: 200 });
    // null tells the caller to use the editor's own coordinates
    expect(selectionEndRect({ getClientRects: () => [], getBoundingClientRect: () => rect(0, 0, 0, 0) })).toBeNull();
    expect(selectionEndRect(null)).toBeNull();
  });
});

describe("pinButtonTop", () => {
  it("sits above the end line when there is room", () => {
    expect(pinButtonTop({ top: 400, bottom: 418 }, { top: 100 }, 0)).toBe(268);
  });
  it("drops below the end line when above would leave the editor's top edge", () => {
    // A selection ending on the page's second line: 32 px above it is
    // outside the wrapper, where the button was clipped and unclickable.
    expect(pinButtonTop({ top: 120, bottom: 138 }, { top: 100 }, 0)).toBe(46);
  });
  it("counts the wrapper's scroll, because the button lives in its content", () => {
    expect(pinButtonTop({ top: 400, bottom: 418 }, { top: 100 }, 500)).toBe(768);
  });
});
