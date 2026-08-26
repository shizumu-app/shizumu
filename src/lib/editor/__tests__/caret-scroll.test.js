import { describe, it, expect } from "vitest";
import {
  caretScrollDelta,
  isDegenerateCaretRect,
  CARET_SCROLL_MARGIN_PX,
} from "../caret-scroll.js";

/** The scroller in the reproduction: 193 → 729 in viewport coordinates. */
const container = { top: 193, bottom: 729 };

describe("caretScrollDelta", () => {
  it("scrolls down when the block sits below the fold", () => {
    // The measured reproduction: after Enter on the last line, the new
    // paragraph's box was 736 → 761 against a container ending at 729, and
    // nothing scrolled. 761 + 28 - 729 = 60.
    expect(caretScrollDelta({ top: 736, bottom: 761 }, container)).toBe(60);
  });

  it("scrolls up when the block sits above the top edge", () => {
    expect(caretScrollDelta({ top: 150, bottom: 175 }, container)).toBe(150 - 28 - 193);
  });

  it("does nothing when the block is already comfortably inside", () => {
    // Not "does nothing because nothing was computed" — the block really
    // is clear of both edges by more than the margin, so any scroll here
    // would be the editor yanking the page under a reader.
    expect(caretScrollDelta({ top: 400, bottom: 425 }, container)).toBe(0);
  });

  it("keeps a margin below rather than settling flush against the edge", () => {
    // A block ending exactly at the container's bottom is technically in
    // view and still feels like writing into the window frame.
    expect(caretScrollDelta({ top: 704, bottom: 729 }, container)).toBe(CARET_SCROLL_MARGIN_PX);
    // One margin clear of the edge is where it stops.
    expect(caretScrollDelta({ top: 676, bottom: 701 }, container)).toBe(0);
  });

  it("aligns the top of a block taller than the viewport", () => {
    // Satisfying both edges is impossible; pinning the bottom would drop
    // the user at the end of a long block they just entered at the top.
    const tall = { top: 300, bottom: 1400 };
    expect(caretScrollDelta(tall, container)).toBe(300 - 193 - CARET_SCROLL_MARGIN_PX);
  });

  it("returns 0 rather than NaN for a collapsed or missing container", () => {
    // A container measured before layout has height 0. Scrolling by
    // whatever arithmetic falls out of that would be a random jump.
    expect(caretScrollDelta({ top: 736, bottom: 761 }, { top: 400, bottom: 400 })).toBe(0);
    expect(caretScrollDelta({ top: 736, bottom: 761 }, null)).toBe(0);
    expect(caretScrollDelta(null, container)).toBe(0);
  });

  it("honours a caller-supplied margin", () => {
    expect(caretScrollDelta({ top: 736, bottom: 761 }, container, 0)).toBe(32);
  });
});

describe("isDegenerateCaretRect", () => {
  it("recognises the all-zero rect PM gives up on", () => {
    // Exactly what view.coordsAtPos returned for the caret in the
    // brand-new empty paragraph, measured in the browser.
    expect(isDegenerateCaretRect({ top: 0, bottom: 0, left: 0, right: 0 })).toBe(true);
    expect(isDegenerateCaretRect(null)).toBe(true);
  });

  it("leaves a real caret rect to ProseMirror", () => {
    // Measured immediately after typing one character into that same
    // paragraph — PM handles this one correctly, and taking it over would
    // mean fighting PM for the scroll position on every keystroke.
    expect(isDegenerateCaretRect({ top: 737.71875, bottom: 757.71875, left: 322, right: 322 })).toBe(false);
  });

  it("treats a zero-height rect with a real left as PM's to handle", () => {
    // Mirrors prosemirror-view's own guard, which bails only when the rect
    // is empty AND left is 0. A collapsed caret at a real x is normal.
    expect(isDegenerateCaretRect({ top: 400, bottom: 400, left: 322, right: 322 })).toBe(false);
  });

  it("treats an empty rect at x=0 as degenerate", () => {
    expect(isDegenerateCaretRect({ top: 400, bottom: 400, left: 0, right: 0 })).toBe(true);
  });
});
