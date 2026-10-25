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

/** The rewind is deferred to a macrotask so a push in the same turn can
 *  take the slot over — see popTrailingClosed. Tests that assert on
 *  history AFTER a close have to cross that boundary, which is what this
 *  is. Tests that assert BEFORE it are asserting the deferral itself. */
const afterRewind = () => new Promise((r) => setTimeout(r, 0));

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

  it("programmatic navClose rewinds history without re-calling onClose", async () => {
    const teardown = initNavStack();
    const onClose = vi.fn();
    const id = navPush("sheet", onClose);
    navClose(id); // e.g. user tapped the X
    expect(onClose).not.toHaveBeenCalled();
    await afterRewind();
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

  it("cascading closes (trailing >= 2) do not over-suppress subsequent backs", async () => {
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
    await afterRewind();
    expect(historyStates.length).toBe(1); // Rewound from 3 to 1.

    // User back should close A (not swallowed by residual suppress).
    navBack();
    expect(closed).toEqual(["A"]);
    expect(historyStates.length).toBe(0);
    teardown();
  });
});

describe("navstack — one sheet replacing another, with a REAL async popstate", () => {
  // THE DEFECT THIS EXISTS FOR. Pressing Android's back button while the
  // table size grid was open closed the whole app. Measured on an
  // SM-A065F: with the insert sheet up `history.state` is
  // {shizumu:"insert",navId:1}, and the moment the table grid replaces it
  // the state is null — the grid is on screen with no entry behind it, so
  // the press falls through to the activity. Reached from insert -> table,
  // insert -> chart, and the block handle's `turn into`.
  //
  // WHY THE SUITE ABOVE COULD NOT SEE IT. Its `history.go` stub fires
  // popstate SYNCHRONOUSLY, inside the call. A browser does not: the pop
  // lands a task later, AFTER the replacing sheet has already pushed.
  // That ordering is the entire bug, so these tests model it and the ones
  // above keep their determinism.
  let states;

  beforeEach(() => {
    vi.useFakeTimers();
    _resetForTests();
    states = [{ shizumu: null, navId: 0 }];
    vi.spyOn(window.history, "pushState").mockImplementation((st) => { states.push(st); });
    vi.spyOn(window.history, "replaceState").mockImplementation((st) => {
      states[states.length - 1] = st;
    });
    vi.spyOn(window.history, "go").mockImplementation((n) => {
      for (let i = 0; i < -n; i++) if (states.length > 1) states.pop();
      window.dispatchEvent(new PopStateEvent("popstate", { state: states.at(-1) ?? null }));
    });
    return () => { vi.restoreAllMocks(); vi.useRealTimers(); };
  });

  it("leaves the replacing sheet with a history entry of its own", () => {
    initNavStack();
    const first = navPush("insert", () => {});
    expect(states.at(-1)).toMatchObject({ shizumu: "insert" });

    // The swap as the components perform it: the outgoing sheet closes
    // itself and the incoming one pushes, both inside one turn.
    navClose(first);
    navPush("table", () => {});
    // The rewind is deferred to a macrotask; let it run.
    vi.advanceTimersByTime(1);

    // The entry the device reported as null. Under close-then-push the
    // pending go(-1) lands after the push and takes this away.
    expect(states.at(-1)).toMatchObject({ shizumu: "table" });
    // One sheet, one entry: the slot was taken over, not added to.
    expect(states.length).toBe(2);
  });

  it("gives back to the sheet, not to the activity", () => {
    const closed = [];
    initNavStack();
    const first = navPush("insert", () => closed.push("insert"));
    navClose(first);
    navPush("table", () => closed.push("table"));
    vi.advanceTimersByTime(1);

    // One back press. It must reach the sheet.
    window.history.go(-1);
    expect(closed).toEqual(["table"]);
    // And only now is the stack empty, which is when the OS owns back.
    expect(states.length).toBe(1);
  });
});
