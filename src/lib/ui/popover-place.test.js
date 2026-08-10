import { describe, it, expect } from "vitest";
import { placePopover } from "./popover-place.js";

const viewport = { width: 920, height: 670 };
const anchor = { top: 620, bottom: 648, left: 610, right: 660, width: 50, height: 28 };

describe("placePopover", () => {
  it("top-start above a bottom-anchored chip, aligned to its left edge", () => {
    const panel = { width: 190, height: 200 };
    const r = placePopover({ anchor, panel, placement: "top-start", viewport });
    expect(r.left).toBe(610);
    // gap 6 above the anchor, using the PANEL's effective height
    expect(r.top).toBe(620 - 6 - 200);
    expect(r.maxHeight).toBe(620 - 6 - 8); // space above the anchor
  });

  it("caps the panel to available space instead of clamping over app chrome", () => {
    // Filters case: panel taller than the viewport, anchored bottom-end near the top.
    const topAnchor = { top: 70, bottom: 98, left: 700, right: 780, width: 80, height: 28 };
    const tall = { width: 240, height: 900 };
    const r = placePopover({ anchor: topAnchor, panel: tall, placement: "bottom-end", viewport });
    expect(r.top).toBe(98 + 6); // stays glued under the anchor
    expect(r.maxHeight).toBe(670 - (98 + 6) - 8); // fits above the bottom margin
    expect(r.left).toBe(780 - 240);
  });

  it("re-placement with a settled (smaller) panel height tracks the anchor", () => {
    // The mid-air-calendar bug: first measure 414px tall, settled 200px.
    const stale = placePopover({ anchor, panel: { width: 110, height: 414 }, placement: "top-start", viewport });
    const settled = placePopover({ anchor, panel: { width: 190, height: 200 }, placement: "top-start", viewport });
    expect(settled.top).toBeGreaterThan(stale.top); // re-run must pull it back down to the anchor
    expect(settled.top + 200 + 6).toBe(anchor.top);
  });

  it("flips to the other side when the chosen side lacks minHeight and the other has more room", () => {
    const nearBottom = { top: 640, bottom: 660, left: 100, right: 150, width: 50, height: 20 };
    const panel = { width: 200, height: 300 };
    const r = placePopover({ anchor: nearBottom, panel, placement: "bottom-start", viewport });
    // only 2px below; flips above
    expect(r.top + Math.min(300, r.maxHeight) + 6).toBe(640);
    expect(r.maxHeight).toBe(640 - 6 - 8);
  });

  it("clamps horizontally to the viewport", () => {
    const rightEdge = { top: 100, bottom: 128, left: 880, right: 910, width: 30, height: 28 };
    const panel = { width: 300, height: 100 };
    const r = placePopover({ anchor: rightEdge, panel, placement: "bottom-start", viewport });
    expect(r.left).toBe(920 - 300 - 8);
  });
});
