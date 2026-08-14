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

// Mobile-stability item 5: HANDLE_BAR_HEIGHT was 34 — one `.block-handle`
// row (32px) plus its 1px+1px border, but missing `.block-handles.floating`'s
// own 1px+1px padding. A 2px-short bar height under-measures the gap the
// formula reserves below the bar, which is the wrong direction to be wrong
// in when the very next thing down the page is the block's own text.
describe("HANDLE_BAR_HEIGHT — tracks the actual rendered bar (CSS-verified)", () => {
  it("equals .block-handle's coarse-pointer height plus the bar's own padding and border on each side", () => {
    const BLOCK_HANDLE_HEIGHT = 32; // 2rem, @media (pointer: coarse) .block-handle
    const FLOATING_PADDING = 1; // .block-handles.floating { padding: 1px; }
    const BAR_BORDER = 1; // .block-handles { border: 1px solid ...; }
    expect(HANDLE_BAR_HEIGHT).toBe(BLOCK_HANDLE_HEIGHT + 2 * FLOATING_PADDING + 2 * BAR_BORDER);
  });
});

// The formula itself was already non-overlapping for a single fresh
// (blockTop, blockHeight) snapshot — what went stale on-device was the
// SNAPSHOT (TipTapEditor.svelte's touch reveal used to be one-shot; a
// ResizeObserver now re-runs it whenever the active block's box changes,
// see revealHandleForBlock's call sites). This locks the geometric
// invariant placeHandleBar must uphold given accurate inputs, across a
// spread of narrow-viewport-shaped scenarios including the exact shape of
// the reported bug: a block that has grown to a second wrapped line.
describe("placeHandleBar — the bar's rect never intersects the block's content rect", () => {
  const cases = [
    { name: "ordinary block, plenty of room above", blockTop: 400, blockHeight: 24, scrollTop: 0 },
    { name: "narrow-viewport phone block, room above", blockTop: 200, blockHeight: 48, scrollTop: 0 },
    { name: "block at the very top of the page", blockTop: 0, blockHeight: 24, scrollTop: 0 },
    { name: "block scrolled to the container's top edge", blockTop: 1000, blockHeight: 24, scrollTop: 990 },
    { name: "tall multi-line block, no room above", blockTop: 10, blockHeight: 300, scrollTop: 0 },
    {
      // The reported shape: a short one-line block that grew a second
      // wrapped line — re-measuring after the growth (blockHeight now
      // reflects both lines) must still clear the new, taller box.
      name: "block grown to a second wrapped line",
      blockTop: 120, blockHeight: 48, scrollTop: 0,
    },
  ];
  for (const { name, blockTop, blockHeight, scrollTop } of cases) {
    it(name, () => {
      const { top } = placeHandleBar({ blockTop, blockHeight, scrollTop });
      const barBottom = top + HANDLE_BAR_HEIGHT;
      const contentTop = blockTop;
      const contentBottom = blockTop + blockHeight;
      const intersects = top < contentBottom && barBottom > contentTop;
      expect(intersects).toBe(false);
    });
  }
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
