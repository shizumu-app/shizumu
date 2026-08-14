import { describe, it, expect } from "vitest";
import { shouldCollapseHeader } from "../header-collapse.js";

describe("shouldCollapseHeader", () => {
  it("collapses while typing on the canvas — the whole point of the collapse", () => {
    expect(shouldCollapseHeader({ isPhone: true, keyboardOpen: true, overlayDepth: 0 })).toBe(true);
  });

  // THE BUG this module exists for. The trail sheet is a DOM descendant of the
  // header row that collapsing sets to `display: none`. Hiding that subtree
  // un-focuses the input inside it, so the IME opens and closes the instant
  // the user taps the trail field — reported repeatedly as "the keyboard
  // appears and disappears". Reproduced on device through v0.6.11.
  it("does NOT collapse while an overlay is open — collapsing would hide the field being typed into", () => {
    expect(shouldCollapseHeader({ isPhone: true, keyboardOpen: true, overlayDepth: 1 })).toBe(false);
  });

  it("stays uncollapsed for any overlay depth, not just the first", () => {
    expect(shouldCollapseHeader({ isPhone: true, keyboardOpen: true, overlayDepth: 3 })).toBe(false);
  });

  it("never collapses with the keyboard down", () => {
    // Nothing to make room for; the full header is the normal phone state.
    expect(shouldCollapseHeader({ isPhone: true, keyboardOpen: false, overlayDepth: 0 })).toBe(false);
  });

  it("never collapses on desktop", () => {
    // The desktop header is not the space-constrained one; it has no pill.
    expect(shouldCollapseHeader({ isPhone: false, keyboardOpen: true, overlayDepth: 0 })).toBe(false);
  });

  it("treats a missing overlayDepth as nothing open", () => {
    expect(shouldCollapseHeader({ isPhone: true, keyboardOpen: true })).toBe(true);
  });
});
