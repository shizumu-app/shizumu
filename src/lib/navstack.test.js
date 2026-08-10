import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  navPush, navClose, navBack, initNavStack, subscribe, _resetForTests,
} from "./navstack.js";

// jsdom implements pushState/back, but back() is async and flaky in tests.
// Stub history + fire popstate manually for deterministic control.
let historyStates;
beforeEach(() => {
  _resetForTests();
  historyStates = [];
  vi.spyOn(window.history, "pushState").mockImplementation((state) => {
    historyStates.push(state);
  });
  vi.spyOn(window.history, "back").mockImplementation(() => {
    historyStates.pop();
    window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
  });
  vi.spyOn(window.history, "go").mockImplementation((n) => {
    for (let i = 0; i < -n; i++) historyStates.pop();
    window.dispatchEvent(new PopStateEvent("popstate", { state: historyStates.at(-1) ?? null }));
  });
  return () => vi.restoreAllMocks();
});

describe("navstack", () => {
  it("hardware back closes the top entry and calls its onClose", () => {
    const teardown = initNavStack();
    const closed = [];
    navPush("settings", () => closed.push("settings"));
    navPush("sheet", () => closed.push("sheet"), { hideBar: true });
    navBack(); // hardware back
    expect(closed).toEqual(["sheet"]);
    navBack();
    expect(closed).toEqual(["sheet", "settings"]);
    teardown();
  });

  it("programmatic navClose rewinds history without re-calling onClose", () => {
    const teardown = initNavStack();
    const onClose = vi.fn();
    const id = navPush("sheet", onClose);
    navClose(id); // e.g. user tapped the X
    expect(onClose).not.toHaveBeenCalled();
    expect(historyStates.length).toBe(0); // history rewound
    teardown();
  });

  it("closing a mid-stack entry defers its history pop until it reaches the top", () => {
    const teardown = initNavStack();
    const closed = [];
    const memId = navPush("memory", () => closed.push("memory"));
    navPush("sheet", () => closed.push("sheet"));
    navClose(memId); // memory closed underneath the sheet
    // Back should close the sheet first, then consume memory's orphan state silently.
    navBack();
    expect(closed).toEqual(["sheet"]);
    navBack();
    expect(closed).toEqual(["sheet"]); // memory's onClose NOT called again
    teardown();
  });

  it("snapshot reflects depth, top, hideBar, has()", () => {
    const teardown = initNavStack();
    const snaps = [];
    const un = subscribe((s) => snaps.push(s));
    expect(snaps.at(-1).depth).toBe(0);
    navPush("settings", () => {});
    navPush("sheet", () => {}, { hideBar: true });
    const s = snaps.at(-1);
    expect(s.depth).toBe(2);
    expect(s.top).toBe("sheet");
    expect(s.hideBar).toBe(true);
    expect(s.has("settings")).toBe(true);
    un();
    teardown();
  });

  it("back on an empty stack is a no-op for the stack", () => {
    const teardown = initNavStack();
    // Simulate a popstate arriving with nothing registered (e.g. Android
    // back at the home state — the OS handles it; we must not throw).
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    const snaps = [];
    subscribe((s) => snaps.push(s))();
    expect(snaps.at(-1).depth).toBe(0);
    teardown();
  });

  it("cascading closes (trailing >= 2) do not over-suppress subsequent backs", () => {
    const teardown = initNavStack();
    const closed = [];
    const idA = navPush("A", () => closed.push("A"));
    const idB = navPush("B", () => closed.push("B"));
    const idC = navPush("C", () => closed.push("C"));
    expect(historyStates.length).toBe(3);

    // Close B (mid-stack, deferred).
    navClose(idB);
    expect(closed).toEqual([]);
    expect(historyStates.length).toBe(3); // No rewind yet.

    // Close C (top). This cascades: pops C, then B (both deferred now),
    // calling history.go(-2) exactly once, which fires ONE popstate.
    navClose(idC);
    expect(closed).toEqual([]); // Neither C nor B's onClose called.
    expect(historyStates.length).toBe(1); // Rewound from 3 to 1.

    // User back should close A (not swallowed by residual suppress).
    navBack();
    expect(closed).toEqual(["A"]);
    expect(historyStates.length).toBe(0);
    teardown();
  });
});
