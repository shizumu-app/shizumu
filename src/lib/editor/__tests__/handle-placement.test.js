import { describe, it, expect } from "vitest";
import {
  placeHandleBar,
  HANDLE_BAR_HEIGHT,
  HANDLE_BAR_GAP,
} from "../handle-placement.js";

const BAR = HANDLE_BAR_HEIGHT + HANDLE_BAR_GAP;

describe("placeHandleBar", () => {
  it("sits above the block when there is room", () => {
    const { top, placement } = placeHandleBar({
      blockTop: 400, blockHeight: 24, scrollTop: 0,
    });
    expect(placement).toBe("above");
    expect(top).toBe(400 - BAR);
  });

  it("never overlaps the block it acts on — above", () => {
    const blockTop = 400;
    const { top } = placeHandleBar({ blockTop, blockHeight: 24, scrollTop: 0 });
    expect(top + HANDLE_BAR_HEIGHT).toBeLessThanOrEqual(blockTop);
  });

  it("flips below when the block is at the very top of the page", () => {
    const { top, placement } = placeHandleBar({
      blockTop: 0, blockHeight: 24, scrollTop: 0,
    });
    expect(placement).toBe("below");
    // Below the block's bottom edge, not on top of it.
    expect(top).toBe(0 + 24 + HANDLE_BAR_GAP);
  });

  it("flips below when the block is scrolled to the top edge", () => {
    // Block is 1000px down the doc, but the container is scrolled to it,
    // so there is no visible room above it.
    const { placement } = placeHandleBar({
      blockTop: 1000, blockHeight: 24, scrollTop: 990,
    });
    expect(placement).toBe("below");
  });

  it("stays above once the block clears the bar's height", () => {
    const scrollTop = 500;
    expect(placeHandleBar({
      blockTop: scrollTop + BAR - 1, blockHeight: 24, scrollTop,
    }).placement).toBe("below");
    expect(placeHandleBar({
      blockTop: scrollTop + BAR, blockHeight: 24, scrollTop,
    }).placement).toBe("above");
  });

  it("accounts for tall blocks when flipping below", () => {
    const { top } = placeHandleBar({
      blockTop: 10, blockHeight: 300, scrollTop: 0,
    });
    expect(top).toBe(10 + 300 + HANDLE_BAR_GAP);
  });
});

describe("placeHandleBar — never outside the scroll container", () => {
  // The bar lives inside .tiptap-wrapper (overflow-y: auto). A negative top
  // is clipped away while still reporting a bounding box, so it fails
  // silently: visible to waitFor, absent from the pixels.
  it("clamps an above-placement that would land above the container", () => {
    const { top } = placeHandleBar({ blockTop: 10, blockHeight: 20, scrollTop: -500 });
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it("clamps a below-placement computed from a block above the container", () => {
    // Real case: handleTop came out at -229 because the measured block sat
    // above the wrapper's own top, and below-placement stayed negative.
    const { top } = placeHandleBar({ blockTop: -260, blockHeight: 26, scrollTop: 0 });
    expect(top).toBe(0);
  });

  it("still places normally when there is room", () => {
    const { top, placement } = placeHandleBar({ blockTop: 400, blockHeight: 24, scrollTop: 0 });
    expect(placement).toBe("above");
    expect(top).toBe(400 - HANDLE_BAR_HEIGHT - HANDLE_BAR_GAP);
  });
});
