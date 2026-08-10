import { describe, it, expect, vi } from "vitest";
import { syncAppHeight } from "../viewport-height.js";

function fakeWindow({ visual = 800, inner = 800, scrollY = 0 } = {}) {
  const listeners = { win: {}, vv: {} };
  const root = { style: new Map() };
  const el = {
    style: {
      setProperty: (k, v) => root.style.set(k, v),
    },
  };
  const win = {
    document: { documentElement: el },
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

describe("syncAppHeight", () => {
  it("sets --app-height from the visible viewport immediately", () => {
    const { win, get } = fakeWindow({ visual: 812, inner: 900 });
    syncAppHeight(win);
    expect(get("--app-height")).toBe("812px");
  });

  it("shrinks with the keyboard so the shell can't exceed the screen", () => {
    const { win, get, fire } = fakeWindow({ visual: 900, inner: 900 });
    syncAppHeight(win);
    expect(get("--app-height")).toBe("900px");

    win.visualViewport.height = 420; // keyboard up
    fire("vv", "resize");
    expect(get("--app-height")).toBe("420px");
  });

  it("undoes the scroll that drags the shell out from under the user", () => {
    const { win, fire } = fakeWindow({ visual: 900, inner: 900, scrollY: 0 });
    syncAppHeight(win);

    // Browser scrolls the layout viewport to reveal a focused bottom field.
    win.scrollY = 640;
    win.visualViewport.height = 420;
    fire("vv", "scroll");

    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(win.scrollY).toBe(0);
  });

  it("falls back to innerHeight when visualViewport is unavailable", () => {
    const { win, get } = fakeWindow({ visual: null, inner: 640 });
    syncAppHeight(win);
    expect(get("--app-height")).toBe("640px");
  });

  it("stops listening after unsubscribe", () => {
    const { win, get, fire } = fakeWindow({ visual: 900, inner: 900 });
    const stop = syncAppHeight(win);
    stop();

    win.visualViewport.height = 420;
    fire("vv", "resize");
    fire("win", "resize");
    expect(get("--app-height")).toBe("900px");
  });

  it("is a no-op without a window", () => {
    expect(() => syncAppHeight(null)()).not.toThrow();
  });
});
