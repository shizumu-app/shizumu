import { describe, it, expect } from "vitest";
import { navCollapsed } from "../nav-collapse.js";

describe("navCollapsed", () => {
  it("collapses once the content has scrolled past the threshold", () => {
    expect(navCollapsed({ scrollTop: 40, collapsed: false })).toBe(true);
  });

  it("stays expanded at the top of the content", () => {
    // The nav bar's two-line form is the page's identity (today ▾ / trail ·
    // dots · +). At rest it must be whole.
    expect(navCollapsed({ scrollTop: 0, collapsed: false })).toBe(false);
  });

  it("holds its state inside the hysteresis band", () => {
    // Between expandAt and collapseAt the answer is "whatever it already
    // was". Without this band a scroll that hovers on the threshold flips
    // the bar every frame — the latched-chrome class of bug, inverted.
    expect(navCollapsed({ scrollTop: 16, collapsed: true })).toBe(true);
    expect(navCollapsed({ scrollTop: 16, collapsed: false })).toBe(false);
  });

  it("expands again only after scrolling back near the top", () => {
    expect(navCollapsed({ scrollTop: 4, collapsed: true })).toBe(false);
  });

  // ── the keyboard no longer collapses it (2026-10-05) ──────────────────
  //
  // It used to, on the reasoning that a writing surface wants the room. The
  // device pass priced that: the nav holds the trail row, its + for a new
  // page, and the trail's own control, so a keyboardOpen that went wrong —
  // which it did, repeatedly, on a Galaxy A34 where a page zoom read as a
  // keyboard — took away every way of adding a page or changing the trail,
  // and left no way back except restarting the app.
  //
  // Scrolling still collapses it, because that one cannot strand anybody:
  // scrolling back up brings it straight back, and the hysteresis band
  // below keeps it from flickering on the way. The keyboard trigger had no
  // such escape, so it goes. A few rows of writing space are not worth a
  // surface a writer can get locked out of.
  it("does not collapse for the keyboard, whatever the keyboard is doing", () => {
    expect(navCollapsed({ scrollTop: 0, collapsed: false, keyboardOpen: true })).toBe(false);
  });

  it("does not hold a collapse open because of the keyboard", () => {
    // `collapsed: true` here is the band's memory of a scroll, and at
    // scrollTop 0 the bar expands again — the keyboard gets no vote.
    expect(navCollapsed({ scrollTop: 0, collapsed: true, keyboardOpen: true })).toBe(false);
  });

  it("still collapses when the content is scrolled, keyboard or not", () => {
    expect(navCollapsed({ scrollTop: 40, collapsed: false, keyboardOpen: true })).toBe(true);
    expect(navCollapsed({ scrollTop: 40, collapsed: false, keyboardOpen: false })).toBe(true);
  });

  it("collapses exactly at the collapse threshold, not one pixel later", () => {
    // Pins `>=` at nav-collapse.js:37. With `>` this returns the incoming
    // `collapsed` instead, and the bar lags a pixel behind the scroll — the
    // kind of drift no screenshot catches.
    expect(navCollapsed({ scrollTop: 24, collapsed: false })).toBe(true);
  });

  it("expands exactly at the expand threshold, not one pixel earlier", () => {
    // Pins `<=` at nav-collapse.js:38. With `<` the bar stays collapsed at
    // exactly expandAt, so scrolling back to the very top can leave it in
    // its one-line form.
    expect(navCollapsed({ scrollTop: 8, collapsed: true })).toBe(false);
  });
});
