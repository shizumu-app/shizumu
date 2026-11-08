import { describe, it, expect } from "vitest";
import { pinsPanelPlacement, minSheetWidth, dockedSheetWidth, DOCK_PANEL_WIDTH } from "./pins-dock.js";

// Lora at the default 16px canvas font: one `ch` is about 8.6px.
const CH = 8.6;

describe("the pins panel docks beside the page only when the page keeps its writing width", () => {
  it("a 1440px window docks: 72ch + padding + panel fits with desk to spare", () => {
    expect(pinsPanelPlacement({ viewportWidth: 1440, chPx: CH })).toBe("dock");
  });

  it("a 1000px window overlays: docking would squeeze the page below 72 characters", () => {
    expect(pinsPanelPlacement({ viewportWidth: 1000, chPx: CH })).toBe("overlay");
  });

  it("the breakpoint is exactly the page's minimum plus gutters plus the panel", () => {
    const need = minSheetWidth(CH) + 48 + DOCK_PANEL_WIDTH;
    expect(pinsPanelPlacement({ viewportWidth: need, chPx: CH })).toBe("dock");
    expect(pinsPanelPlacement({ viewportWidth: need - 1, chPx: CH })).toBe("overlay");
  });

  it("a bigger canvas font needs a wider window", () => {
    expect(pinsPanelPlacement({ viewportWidth: 1280, chPx: CH })).toBe("dock");
    expect(pinsPanelPlacement({ viewportWidth: 1280, chPx: 12 })).toBe("overlay");
  });

  it("an unknown width overlays — the old behaviour is the safe one", () => {
    expect(pinsPanelPlacement({ viewportWidth: NaN, chPx: CH })).toBe("overlay");
    expect(pinsPanelPlacement({ viewportWidth: 0, chPx: CH })).toBe("overlay");
  });

  it("docked, the sheet narrows toward 72ch but never below it", () => {
    const min = minSheetWidth(CH);
    expect(pinsPanelPlacement({ viewportWidth: 1200, chPx: CH })).toBe("dock");
    const w = dockedSheetWidth({ viewportWidth: 1200, chPx: CH });
    expect(w).toBeGreaterThanOrEqual(min);
    expect(w).toBeLessThanOrEqual(1200 - DOCK_PANEL_WIDTH - 48);
    // A wide window keeps the sheet's usual 900px.
    expect(dockedSheetWidth({ viewportWidth: 1920, chPx: CH })).toBe(900);
  });
});
