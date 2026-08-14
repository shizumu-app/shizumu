import { vi } from "vitest";

// Minimal window/document/visualViewport double shared by keyboard-state.test.js
// and viewport-height.test.js — both exercise startKeyboardState (the latter
// under its re-exported name, syncAppHeight) and need the same event-listener
// bookkeeping to fire resize/scroll/orientationchange/visibilitychange by hand.
export function fakeWindow({ visual = 800, inner = 800, scrollY = 0 } = {}) {
  const listeners = { win: {}, vv: {}, doc: {} };
  const root = { style: new Map() };
  const el = {
    style: {
      setProperty: (k, v) => root.style.set(k, v),
    },
  };
  const doc = {
    documentElement: el,
    visibilityState: "visible",
    // Settable by tests that need to simulate a focused field (e.g. the
    // scroll-reset-fights-the-IME guard in keyboard-state.js) — defaults to
    // null (nothing focused), same as a real document with no active field.
    activeElement: null,
    addEventListener: (t, f) => { (listeners.doc[t] ||= []).push(f); },
    removeEventListener: (t, f) => {
      listeners.doc[t] = (listeners.doc[t] || []).filter((g) => g !== f);
    },
  };
  const win = {
    document: doc,
    innerHeight: inner,
    scrollY,
    scrollTo: vi.fn((x, y) => { win.scrollY = y; }),
    visualViewport: visual == null ? undefined : {
      height: visual,
      addEventListener: (t, f) => { (listeners.vv[t] ||= []).push(f); },
      removeEventListener: (t, f) => {
        listeners.vv[t] = (listeners.vv[t] || []).filter((g) => g !== f);
      },
    },
    addEventListener: (t, f) => { (listeners.win[t] ||= []).push(f); },
    removeEventListener: (t, f) => {
      listeners.win[t] = (listeners.win[t] || []).filter((g) => g !== f);
    },
  };
  const fire = (scope, type) => (listeners[scope][type] || []).forEach((f) => f());
  return { win, get: (k) => root.style.get(k), fire, listeners };
}
