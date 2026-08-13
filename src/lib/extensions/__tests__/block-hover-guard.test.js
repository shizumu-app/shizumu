// Root-cause fix coverage: matchMedia('(hover: hover)') was reproduced
// FALSE in the real webkit2gtk engine (GDK X11 backend) with a genuine
// mouse and zero touch hardware, which is why the CSS-only
// `@media (hover: hover)` reveal silently stopped working on desktop.
// The fix drives the title reveal from real mousemove tracking, guarded by
// isTrustedMouseHover() so Chromium's post-touch-tap compat mousemove
// (the original D-6 hole) can't reopen the tap-steals-focus bug.
import { describe, it, expect } from "vitest";
import { isTrustedMouseHover, resolveHoveredMouseBlock, hoverClassTarget, TOUCH_COMPAT_GUARD_MS } from "../block-hover-guard.js";

// A fake element whose classList mimics the DOM API surface the predicate uses.
const elWith = (...classes) => ({
  classList: {
    contains: (c) => classes.includes(c),
  },
});

// Regression: hovering an expanded image flickered rapidly. `.block-mouse-
// hovered` was stamped on the image's NodeView root; ProseMirror's
// MutationObserver saw the foreign class change and REBUILT the NodeView, which
// remounts the Svelte component and tears the <img> down — on every mousemove.
// The class only reveals a board's title slot, so it must land only on boards.
describe("hoverClassTarget — only boards carry .block-mouse-hovered", () => {
  it("returns the element for a list/quote board (.block-shell)", () => {
    const board = elWith("block-shell");
    expect(hoverClassTarget(board)).toBe(board);
  });

  it("returns the element for a code board (.code-block-wrap)", () => {
    const code = elWith("code-block-wrap");
    expect(hoverClassTarget(code)).toBe(code);
  });

  it("returns null for an image/attachment wrapper — the flicker source", () => {
    // Stamping the class here is what rebuilt the NodeView and flickered the
    // <img>; the predicate must refuse it.
    expect(hoverClassTarget(elWith("local-image-wrap", "attachment-image"))).toBe(null);
  });

  it("returns null for a plain paragraph and for null", () => {
    expect(hoverClassTarget(elWith())).toBe(null);
    expect(hoverClassTarget(null)).toBe(null);
  });
});

describe("isTrustedMouseHover", () => {
  it("trusts a mousemove when there has been no touch yet this session", () => {
    expect(isTrustedMouseHover(0, 1_000_000)).toBe(true);
  });

  it("does NOT trust a mousemove immediately after a touch pointerdown (D-6 compat event)", () => {
    const lastTouchAt = 1_000_000;
    expect(isTrustedMouseHover(lastTouchAt, lastTouchAt)).toBe(false);
    expect(isTrustedMouseHover(lastTouchAt, lastTouchAt + 1)).toBe(false);
  });

  it("does NOT trust a mousemove still within the guard window", () => {
    const lastTouchAt = 1_000_000;
    expect(isTrustedMouseHover(lastTouchAt, lastTouchAt + TOUCH_COMPAT_GUARD_MS)).toBe(false);
    expect(isTrustedMouseHover(lastTouchAt, lastTouchAt + TOUCH_COMPAT_GUARD_MS - 1)).toBe(false);
  });

  it("trusts a mousemove once the guard window has fully elapsed", () => {
    const lastTouchAt = 1_000_000;
    expect(isTrustedMouseHover(lastTouchAt, lastTouchAt + TOUCH_COMPAT_GUARD_MS + 1)).toBe(true);
  });

  it("respects a custom guard window", () => {
    const lastTouchAt = 5000;
    expect(isTrustedMouseHover(lastTouchAt, 5050, 100)).toBe(false);
    expect(isTrustedMouseHover(lastTouchAt, 5150, 100)).toBe(true);
  });

  it("is a pure function of its arguments (no hidden clock reads)", () => {
    // Same inputs, called twice, must return the same result regardless of
    // real wall-clock time — this is what makes it deterministically
    // testable and is the whole point of accepting `now` as a parameter.
    const a = isTrustedMouseHover(42, 900);
    const b = isTrustedMouseHover(42, 900);
    expect(a).toBe(b);
  });
});

// Code-review finding (post-commit 7af09e1): the original wiring gated
// BOTH the reveal path and the clear path behind isTrustedMouseHover(),
// which meant a revealed title could get stuck open — a touch anywhere in
// the editor within the guard window blocked the clear too, and moving the
// mouse from block A to block B within the guard window blocked B's reveal
// but never cleared A. resolveHoveredMouseBlock() is the fix: clearing
// (returning null) is the unconditional default: it is what happens
// whenever a new reveal isn't explicitly granted, never something a caller
// has to remember to also gate.
describe("resolveHoveredMouseBlock", () => {
  const BLOCK_A = { id: "A" };
  const BLOCK_B = { id: "B" };

  it("reveals the found block when the hover is trusted", () => {
    expect(resolveHoveredMouseBlock(BLOCK_A, 0, 1_000_000)).toBe(BLOCK_A);
  });

  it("clears (null) when nothing is found, regardless of touch recency", () => {
    // No touch at all.
    expect(resolveHoveredMouseBlock(null, 0, 1_000_000)).toBe(null);
    // Touch just happened -- still clears; there is nothing here to
    // "protect" by holding a stale reveal.
    const lastTouchAt = 1_000_000;
    expect(resolveHoveredMouseBlock(null, lastTouchAt, lastTouchAt + 1)).toBe(null);
  });

  it("clears (null) rather than reveals when found is untrusted (post-touch compat mousemove)", () => {
    const lastTouchAt = 1_000_000;
    expect(resolveHoveredMouseBlock(BLOCK_A, lastTouchAt, lastTouchAt + 1)).toBe(null);
  });

  it("BUG regression: a touch elsewhere must still clear an already-revealed block", () => {
    // Scenario: the mouse was hovering BLOCK_A (a prior call already
    // returned BLOCK_A and the caller stored it as hoveredMouseBlock).
    // A touch now lands, then a genuine mousemove reports the cursor is no
    // longer over any block (found = null) -- e.g. the touch itself moved
    // focus/scroll, or the user's finger is now covering empty space.
    // The clear must go through immediately, not be held for guardMs.
    const lastTouchAt = 1_000_000;
    const result = resolveHoveredMouseBlock(null, lastTouchAt, lastTouchAt + 10);
    expect(result).toBe(null);
  });

  it("BUG regression: moving from block A to block B within the guard window clears A instead of leaving it stuck", () => {
    const lastTouchAt = 1_000_000;
    // Mouse moves onto B just after a touch -- B's reveal is correctly
    // withheld, but the return value must be null (clearing A), never A
    // itself (which would leave A's title stuck open under a cursor that
    // has moved away).
    const result = resolveHoveredMouseBlock(BLOCK_B, lastTouchAt, lastTouchAt + 1);
    expect(result).toBe(null);
    expect(result).not.toBe(BLOCK_A);
  });

  it("reveals the new block once the guard window has elapsed, even if a different block was hovered before", () => {
    const lastTouchAt = 1_000_000;
    const result = resolveHoveredMouseBlock(BLOCK_B, lastTouchAt, lastTouchAt + TOUCH_COMPAT_GUARD_MS + 1);
    expect(result).toBe(BLOCK_B);
  });
});
