import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isCoarsePointer,
  isPhoneViewport,
  isTabletViewport,
  watchMedia,
  PHONE_QUERY,
  TABLET_QUERY,
} from "./responsive.js";

// jsdom's matchMedia isn't a real implementation — we stub it per-test so
// each predicate's `matches` value is controllable. The helpers cache the
// MediaQueryList on first call, so vi.resetModules() between tests is
// the cleanest way to rebuild the cache.
function stubMatchMedia(matchesByQuery, { addListener } = {}) {
  const listeners = [];
  window.matchMedia = vi.fn((query) => {
    const matches = !!matchesByQuery[query];
    const mql = {
      matches,
      media: query,
      addEventListener: vi.fn((evt, cb) => listeners.push({ query, cb })),
      removeEventListener: vi.fn(),
    };
    if (addListener) addListener(mql);
    return mql;
  });
  return listeners;
}

beforeEach(async () => {
  // Reset the module cache so each test gets fresh internal MQL state.
  vi.resetModules();
});

afterEach(() => {
  delete window.matchMedia;
});

// A phone doesn't stop being a phone when you turn it sideways. Landscape
// makes the WIDTH ~890px on a modern handset, which sailed past both the
// 480px phone breakpoint and the 768px tablet one and handed the user the
// full desktop layout. Both tiers are keyed on the SHORT side too, matching
// the convention Modal.svelte already used for landscape phones.
describe("phone/tablet breakpoints in landscape", () => {
  it("treats a landscape phone as a phone viewport", async () => {
    const { PHONE_QUERY, TABLET_QUERY } = await import("./responsive.js");
    // 890x412 handset on its side: too wide for either width rule.
    stubMatchMedia({
      [PHONE_QUERY]: true,
      [TABLET_QUERY]: true,
    });
    const m = await import("./responsive.js");
    expect(m.isPhoneViewport()).toBe(true);
    expect(m.isTabletViewport()).toBe(true);
  });

  it("asks about the short side, not just the width", async () => {
    const { PHONE_QUERY, TABLET_QUERY } = await import("./responsive.js");
    for (const q of [PHONE_QUERY, TABLET_QUERY]) {
      expect(q).toContain("orientation: landscape");
      expect(q).toContain("max-height: 480px");
    }
  });

  it("keeps the mobile nav chrome mounted in landscape", async () => {
    const { PHONE_QUERY } = await import("./responsive.js");
    stubMatchMedia({ [PHONE_QUERY]: true });
    const m = await import("./responsive.js");
    // isMobileNav gates the MobileActionBar mount and the edge gestures —
    // rotating used to unmount the bar and disable the swipes entirely.
    expect(m.isMobileNav()).toBe(true);
  });

  it("leaves a normal desktop window on the desktop layout", async () => {
    const { PHONE_QUERY, TABLET_QUERY } = await import("./responsive.js");
    stubMatchMedia({ [PHONE_QUERY]: false, [TABLET_QUERY]: false });
    const m = await import("./responsive.js");
    expect(m.isPhoneViewport()).toBe(false);
    expect(m.isMobileNav()).toBe(false);
  });
});

describe("isCoarsePointer", () => {
  it("returns true when matchMedia reports coarse pointer", async () => {
    stubMatchMedia({ "(pointer: coarse)": true });
    const m = await import("./responsive.js");
    expect(m.isCoarsePointer()).toBe(true);
  });

  it("returns false when matchMedia reports fine pointer", async () => {
    stubMatchMedia({ "(pointer: coarse)": false });
    const m = await import("./responsive.js");
    expect(m.isCoarsePointer()).toBe(false);
  });

  it("returns false when matchMedia is unavailable", async () => {
    delete window.matchMedia;
    const m = await import("./responsive.js");
    expect(m.isCoarsePointer()).toBe(false);
  });
});

describe("isPhoneViewport", () => {
  it("returns true at ≤ 480px viewport", async () => {
    stubMatchMedia({ [PHONE_QUERY]: true });
    const m = await import("./responsive.js");
    expect(m.isPhoneViewport()).toBe(true);
  });

  it("returns false above 480px viewport", async () => {
    stubMatchMedia({ [PHONE_QUERY]: false });
    const m = await import("./responsive.js");
    expect(m.isPhoneViewport()).toBe(false);
  });
});

describe("isTabletViewport", () => {
  it("returns true at ≤ 768px viewport", async () => {
    stubMatchMedia({ [TABLET_QUERY]: true });
    const m = await import("./responsive.js");
    expect(m.isTabletViewport()).toBe(true);
  });
});

// The baseline/threshold arithmetic that used to live here (resizes-visual
// vs. resizes-content, re-baselining on rotation, the slack threshold) now
// lives in keyboard-state.js's computeKeyboardState — see
// lib/__tests__/keyboard-state.test.js. isKeyboardOpen()/watchKeyboardOpen()
// are thin wrappers around its `keyboardOpen` store, so these tests only
// need to confirm the wrapping, not re-derive the arithmetic.
describe("isKeyboardOpen", () => {
  it("reads the current value of the keyboardOpen store", async () => {
    const { keyboardOpen } = await import("./keyboard-state.js");
    const m = await import("./responsive.js");
    expect(m.isKeyboardOpen()).toBe(false);
    keyboardOpen.set(true);
    expect(m.isKeyboardOpen()).toBe(true);
    keyboardOpen.set(false);
    expect(m.isKeyboardOpen()).toBe(false);
  });
});

describe("watchKeyboardOpen", () => {
  it("fires immediately with the current value and on every store change", async () => {
    const { keyboardOpen } = await import("./keyboard-state.js");
    const m = await import("./responsive.js");
    const seen = [];
    const unsubscribe = m.watchKeyboardOpen((open) => seen.push(open));
    expect(seen).toEqual([false]);

    keyboardOpen.set(true);
    expect(seen).toEqual([false, true]);

    unsubscribe();
    keyboardOpen.set(false);
    // Unsubscribed — the close transition must not reach a stale callback.
    expect(seen).toEqual([false, true]);
  });
});

describe("watchMedia", () => {
  it("invokes the callback once with the current matches value", async () => {
    // watchMedia is generic — it takes whatever query it's handed, so this
    // one keeps a literal rather than the module's own breakpoint.
    stubMatchMedia({ "(max-width: 768px)": true });
    const m = await import("./responsive.js");
    const cb = vi.fn();
    m.watchMedia("(max-width: 768px)", cb);
    expect(cb).toHaveBeenCalledWith(true);
  });

  it("invokes the callback again when the query changes", async () => {
    const listenersOut = [];
    stubMatchMedia({ [PHONE_QUERY]: false }, {
      addListener: (mql) => listenersOut.push(mql),
    });
    const m = await import("./responsive.js");
    const cb = vi.fn();
    m.watchMedia("(max-width: 480px)", cb);

    // First call delivers initial state.
    expect(cb).toHaveBeenLastCalledWith(false);

    // Simulate viewport crossing the breakpoint — fire the registered handler.
    const mql = listenersOut[0];
    const changeHandler = mql.addEventListener.mock.calls[0][1];
    changeHandler({ matches: true });
    expect(cb).toHaveBeenLastCalledWith(true);
  });

  it("returns an unsubscribe function that removes the listener", async () => {
    const listenersOut = [];
    stubMatchMedia({ "(pointer: coarse)": false }, {
      addListener: (mql) => listenersOut.push(mql),
    });
    const m = await import("./responsive.js");
    const cb = vi.fn();
    const unsubscribe = m.watchMedia("(pointer: coarse)", cb);
    unsubscribe();
    expect(listenersOut[0].removeEventListener).toHaveBeenCalled();
  });

  it("calls the callback with false and returns a noop when matchMedia is unavailable", async () => {
    delete window.matchMedia;
    const m = await import("./responsive.js");
    const cb = vi.fn();
    const unsubscribe = m.watchMedia("(max-width: 480px)", cb);
    expect(cb).toHaveBeenCalledWith(false);
    expect(typeof unsubscribe).toBe("function");
    // Should not throw when called.
    unsubscribe();
  });
});

describe("isMobileNav", () => {
  it("true on phone viewport regardless of pointer", async () => {
    stubMatchMedia({ [PHONE_QUERY]: true, "(pointer: coarse)": false, [TABLET_QUERY]: true });
    const m = await import("./responsive.js");
    expect(m.isMobileNav()).toBe(true);
  });

  it("true on coarse-pointer tablet (481-768px hole)", async () => {
    stubMatchMedia({ [PHONE_QUERY]: false, "(pointer: coarse)": true, [TABLET_QUERY]: true });
    const m = await import("./responsive.js");
    expect(m.isMobileNav()).toBe(true);
  });

  it("false on fine-pointer 600px desktop window", async () => {
    stubMatchMedia({ [PHONE_QUERY]: false, "(pointer: coarse)": false, [TABLET_QUERY]: true });
    const m = await import("./responsive.js");
    expect(m.isMobileNav()).toBe(false);
  });

  it("false on coarse-pointer desktop-size touchscreen", async () => {
    stubMatchMedia({ [PHONE_QUERY]: false, "(pointer: coarse)": true, [TABLET_QUERY]: false });
    const m = await import("./responsive.js");
    expect(m.isMobileNav()).toBe(false);
  });
});

describe("watchMobileNav", () => {
  it("fires immediately with the current value", async () => {
    stubMatchMedia({ [PHONE_QUERY]: true, "(pointer: coarse)": false, [TABLET_QUERY]: true });
    const m = await import("./responsive.js");
    const seen = [];
    const un = m.watchMobileNav((v) => seen.push(v));
    expect(seen).toEqual([true]);
    un();
  });
});
