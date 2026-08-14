import { describe, it, expect } from "vitest";
import { gestureArmed, atScrollBoundary } from "../gesture-arming.js";

describe("gestureArmed", () => {
  it("arms on the bare canvas at the scroll boundary", () => {
    expect(gestureArmed({ overlayOpen: false, scrollAtBoundary: true })).toBe(true);
  });
  it("never arms while an overlay is open — settings scroll must not switch views", () => {
    expect(gestureArmed({ overlayOpen: true, scrollAtBoundary: true })).toBe(false);
  });
  it("never arms mid-scroll — scrolling the page can never change views", () => {
    expect(gestureArmed({ overlayOpen: false, scrollAtBoundary: false })).toBe(false);
  });
  it("never arms while the soft keyboard is open, even at the scroll boundary with no overlay — a flick must not fire while typing", () => {
    expect(gestureArmed({ overlayOpen: false, scrollAtBoundary: true, keyboardOpen: true })).toBe(false);
  });
  it("keyboardOpen absent defaults to false — unchanged behavior for callers that don't pass it", () => {
    expect(gestureArmed({ overlayOpen: false, scrollAtBoundary: true })).toBe(true);
  });
});

describe("atScrollBoundary", () => {
  const el = (scrollTop, clientHeight, scrollHeight) => ({ scrollTop, clientHeight, scrollHeight });
  it("bottom boundary for an upward flick", () => {
    expect(atScrollBoundary(el(400, 600, 1000), "up")).toBe(true);
    expect(atScrollBoundary(el(100, 600, 1000), "up")).toBe(false);
  });
  it("unscrollable content is always at boundary", () => {
    expect(atScrollBoundary(el(0, 600, 600), "up")).toBe(true);
  });
  it("null container counts as boundary (nothing to scroll)", () => {
    expect(atScrollBoundary(null, "up")).toBe(true);
  });
});
