import { describe, it, expect } from "vitest";
import { placeMenu } from "../menu-placement.js";

// A phone with the keyboard up: visualViewport reports what is left above it.
const PHONE = { vh: 380, vw: 412, safeTop: 44, safeBottom: 34 };

const caret = (top, bottom = top + 20, left = 24) => ({ top, bottom, left });

describe("placeMenu", () => {
  it("sits under the caret when there is room", () => {
    const r = placeMenu({
      caretRect: caret(100),
      menuH: 160,
      menuW: 300,
      ...PHONE,
    });
    expect(r.top).toBe(124); // caret bottom + gap
    expect(r.maxHeight).toBeGreaterThanOrEqual(160);
  });

  it("flips above the caret when it fits there but not below", () => {
    const r = placeMenu({
      caretRect: caret(280),
      menuH: 160,
      menuW: 300,
      ...PHONE,
    });
    expect(r.top).toBe(280 - 4 - 160);
    expect(r.top).toBeGreaterThanOrEqual(PHONE.safeTop);
  });

  // The reported bug: a menu taller than the whole viewport. The old code
  // resolved `max(8, vh - menuH - 8)` to 8 — above the status bar — and left
  // the tail of the list off-screen because nothing capped its height.
  it("never starts under the status bar, however tall the menu is", () => {
    const r = placeMenu({
      caretRect: caret(120),
      menuH: 900,
      menuW: 300,
      ...PHONE,
    });
    expect(r.top).toBeGreaterThanOrEqual(PHONE.safeTop + 8);
  });

  it("clamps an oversized menu to the space it actually has", () => {
    const r = placeMenu({
      caretRect: caret(120),
      menuH: 900,
      menuW: 300,
      ...PHONE,
    });
    // Must fit between its own top and the bottom safe edge — that is what
    // makes it scrollable instead of running off the screen.
    expect(r.top + r.maxHeight).toBeLessThanOrEqual(PHONE.vh - PHONE.safeBottom);
    expect(r.maxHeight).toBeGreaterThan(0);
  });

  it("picks the roomier side when it fits neither", () => {
    // Caret near the bottom: more room above than below.
    const r = placeMenu({
      caretRect: caret(330),
      menuH: 900,
      menuW: 300,
      ...PHONE,
    });
    expect(r.top).toBe(PHONE.safeTop + 8);
  });

  it("keeps the menu on screen horizontally", () => {
    const r = placeMenu({
      caretRect: caret(100, 120, 390),
      menuH: 100,
      menuW: 300,
      ...PHONE,
    });
    expect(r.left).toBeGreaterThanOrEqual(8);
    expect(r.left + 300).toBeLessThanOrEqual(PHONE.vw - 8);
  });

  it("ignores insets when there are none (desktop)", () => {
    const r = placeMenu({
      caretRect: caret(100),
      menuH: 160,
      menuW: 300,
      vh: 900,
      vw: 1440,
    });
    expect(r.top).toBe(124);
    expect(r.left).toBe(24);
  });
});
