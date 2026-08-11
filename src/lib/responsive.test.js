import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isCoarsePointer,
  isPhoneViewport,
  isTabletViewport,
  isKeyboardOpen,
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
  delete window.visualViewport;
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

describe("isKeyboardOpen", () => {
  it("returns true when visualViewport is much shorter than innerHeight", async () => {
    window.visualViewport = { height: 400 };
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const m = await import("./responsive.js");
    expect(m.isKeyboardOpen()).toBe(true);
  });

  it("returns false when visualViewport is close to innerHeight", async () => {
    window.visualViewport = { height: 750 };
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const m = await import("./responsive.js");
    expect(m.isKeyboardOpen()).toBe(false);
  });

  it("returns false when visualViewport is unavailable", async () => {
    delete window.visualViewport;
    const m = await import("./responsive.js");
    expect(m.isKeyboardOpen()).toBe(false);
  });

  // index.html asks for `interactive-widget=resizes-content`, which makes
  // the keyboard shrink the LAYOUT viewport, not just the visual one. Under
  // that mode visualViewport.height tracks innerHeight, so the original
  // vv-vs-innerHeight comparison reports "no keyboard" forever — which
  // would silently kill the header collapse.
  describe("under interactive-widget=resizes-content", () => {
    it("detects the keyboard from innerHeight dropping below its baseline", async () => {
      window.visualViewport = { height: 900 };
      Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
      const m = await import("./responsive.js");
      // Establish the no-keyboard baseline.
      expect(m.isKeyboardOpen()).toBe(false);

      // Keyboard opens: both viewports shrink together.
      window.visualViewport = { height: 400 };
      Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
      expect(m.isKeyboardOpen()).toBe(true);
    });

    it("goes back to false when the keyboard closes", async () => {
      window.visualViewport = { height: 900 };
      Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
      const m = await import("./responsive.js");
      m.isKeyboardOpen();

      Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
      window.visualViewport = { height: 400 };
      expect(m.isKeyboardOpen()).toBe(true);

      Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
      window.visualViewport = { height: 900 };
      expect(m.isKeyboardOpen()).toBe(false);
    });

    it("re-baselines upward so a taller viewport never reads as a keyboard", async () => {
      // e.g. rotating to landscape, or the address bar collapsing.
      window.visualViewport = { height: 400 };
      Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
      const m = await import("./responsive.js");
      m.isKeyboardOpen();

      Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
      window.visualViewport = { height: 900 };
      expect(m.isKeyboardOpen()).toBe(false);
    });

    // The existing re-baseline test only covers rotation that makes the
    // viewport TALLER. Portrait to landscape makes it shorter, and the
    // baseline only ever grew — so the shrink read as a keyboard that never
    // closed, leaving the header collapsed for as long as the phone was in
    // landscape with no keyboard on screen. A soft keyboard never changes
    // the viewport width; a rotation always does.
    it("re-baselines on rotation that makes the viewport SHORTER", async () => {
      Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
      window.visualViewport = { height: 800 };
      const m = await import("./responsive.js");
      m._resetKeyboardBaseline();
      expect(m.isKeyboardOpen()).toBe(false);

      // Rotate: shorter AND wider, with no keyboard.
      Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: 390, configurable: true });
      window.visualViewport = { height: 390 };
      expect(m.isKeyboardOpen()).toBe(false);
    });

    it("still detects a keyboard when the width is unchanged", async () => {
      Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
      window.visualViewport = { height: 800 };
      const m = await import("./responsive.js");
      m._resetKeyboardBaseline();
      m.isKeyboardOpen();

      // Keyboard opens: shorter, same width.
      Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
      window.visualViewport = { height: 400 };
      expect(m.isKeyboardOpen()).toBe(true);
    });

    it("ignores a shrink too small to be a keyboard", async () => {
      window.visualViewport = { height: 900 };
      Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
      const m = await import("./responsive.js");
      m.isKeyboardOpen();

      // A 40px system-bar change, not a keyboard.
      Object.defineProperty(window, "innerHeight", { value: 860, configurable: true });
      window.visualViewport = { height: 860 };
      expect(m.isKeyboardOpen()).toBe(false);
    });
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
