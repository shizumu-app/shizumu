import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import { safeAreaStyle, startSafeArea, nativeInsets } from "../safe-area.js";
import { fakeWindow } from "./fake-window.js";

describe("safeAreaStyle", () => {
  it("turns measured insets into the variables every surface already reads", () => {
    expect(safeAreaStyle({ top: 36, bottom: 48, left: 0, right: 0 })).toEqual({
      "--safe-top": "36px",
      "--safe-bottom": "48px",
      "--safe-left": "0px",
      "--safe-right": "0px",
    });
  });

  it("applies a zero, because zero is an answer", () => {
    // A phone with gesture navigation has no bar to clear at the bottom, and
    // that is a measurement — not a reason to leave the CSS env() fallback
    // underneath it still guessing.
    expect(safeAreaStyle({ bottom: 0 })).toEqual({ "--safe-bottom": "0px" });
  });

  it("leaves a side alone when it was not measured", () => {
    // The difference that matters: `undefined` means the platform said
    // nothing, and global.css's env() values must keep answering — which is
    // exactly what iOS needs, where env() is correct and nothing here ever
    // runs. Writing 0 for an unmeasured side would put the iPhone's content
    // under the home indicator.
    expect(safeAreaStyle({ bottom: 48 })).toEqual({ "--safe-bottom": "48px" });
    expect(safeAreaStyle({})).toEqual({});
    expect(safeAreaStyle(null)).toEqual({});
    expect(safeAreaStyle("48")).toEqual({});
  });

  it("ignores a negative or non-finite side rather than writing it", () => {
    expect(safeAreaStyle({ top: -4, bottom: Number.NaN, left: Infinity })).toEqual({});
  });
});

describe("startSafeArea", () => {
  it("writes the variables the root already uses", () => {
    const { win, get: css } = fakeWindow();
    const release = startSafeArea(win);
    win.__nativeInsets({ top: 36, bottom: 48 });
    expect(css("--safe-top")).toBe("36px");
    expect(css("--safe-bottom")).toBe("48px");
    release();
  });

  it("adopts a value the activity published before this module existed", () => {
    // wry calls onWebViewCreate from setWebView(), which runs before
    // loadUrl — so the first insets can land before the document does. The
    // activity stashes as well as calling; this reads the stash.
    const { win, get: css } = fakeWindow();
    win.__nativeInsetsState = { bottom: 48 };
    const release = startSafeArea(win);
    expect(css("--safe-bottom")).toBe("48px");
    release();
  });

  it("publishes what it was told, for the readout", () => {
    const { win } = fakeWindow();
    const release = startSafeArea(win);
    win.__nativeInsets({ top: 36, bottom: 48 });
    expect(get(nativeInsets)).toEqual({ top: 36, bottom: 48 });
    release();
  });

  it("takes its receiver away on release, and is idempotent about it", () => {
    const { win } = fakeWindow();
    const release = startSafeArea(win);
    expect(typeof win.__nativeInsets).toBe("function");
    release();
    release();
    expect(win.__nativeInsets).toBeUndefined();
  });

  // THE ACTIVITY TELLS EACH PAGE ONCE, by URL, and location.reload() keeps
  // the URL: after the startup lock screen's unlock reloaded the app, the
  // A16 drew the header under the status bar and the tab row in the
  // navigation buttons' strip (2026-11-08). The insets do not change across
  // a reload of the same activity, so the page keeps the last ones it was
  // told for the next document in this session.
  const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

  it("a reloaded page uses the insets the page before it was told", () => {
    const storage = memoryStorage();
    const first = fakeWindow();
    first.win.sessionStorage = storage;
    startSafeArea(first.win);
    first.win.__nativeInsets({ top: 36, bottom: 48 });

    const reloaded = fakeWindow();
    reloaded.win.sessionStorage = storage;
    const release = startSafeArea(reloaded.win);
    expect(reloaded.get("--safe-top")).toBe("36px");
    expect(reloaded.get("--safe-bottom")).toBe("48px");
    release();
  });

  it("prefers what the activity says over what was kept, and survives storage that throws", () => {
    const storage = memoryStorage();
    storage.setItem("shizumu:native-insets", JSON.stringify({ bottom: 48 }));
    const { win, get: css } = fakeWindow();
    win.sessionStorage = storage;
    win.__nativeInsetsState = { bottom: 0 };
    startSafeArea(win)();
    expect(css("--safe-bottom")).toBe("0px");

    const broken = fakeWindow();
    broken.win.sessionStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    const release = startSafeArea(broken.win);
    expect(() => broken.win.__nativeInsets({ bottom: 48 })).not.toThrow();
    expect(broken.get("--safe-bottom")).toBe("48px");
    release();
  });

  it("does nothing at all without a window", () => {
    // Not an empty assertion for its own sake: this module is imported by
    // the app shell, which SSRs nothing but is evaluated in jsdom-less
    // contexts by the VR harness and the demo bundle. Throwing here would
    // take the whole app down somewhere no phone is involved.
    expect(() => startSafeArea(null)()).not.toThrow();
  });
});
