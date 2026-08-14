import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import { computeKeyboardState, startKeyboardState, keyboardOpen } from "../keyboard-state.js";
import { fakeWindow } from "./fake-window.js";

describe("computeKeyboardState", () => {
  it("reports closed at full height and learns the baseline", () => {
    const r = computeKeyboardState({ vvHeight: 800, baseline: 0 });
    expect(r.isOpen).toBe(false);
    expect(r.keyboardPx).toBe(0);
    expect(r.nextBaseline).toBe(800);
  });

  it("reports open when the viewport shrinks well below the baseline", () => {
    const r = computeKeyboardState({ vvHeight: 500, baseline: 800 });
    expect(r.isOpen).toBe(true);
    expect(r.keyboardPx).toBe(300);
  });

  it("ignores sub-threshold shrink (browser chrome, not a keyboard)", () => {
    const r = computeKeyboardState({ vvHeight: 760, baseline: 800 });
    expect(r.isOpen).toBe(false);
    expect(r.keyboardPx).toBe(0);
  });

  // The latched-bar bug: after rotation the old tall baseline made the
  // new (legitimately shorter) landscape height read as "keyboard open"
  // forever. The caller resets baseline to 0 on orientationchange; from
  // a zero baseline the current height IS the baseline and the state is
  // closed — this is the property that makes the latch impossible.
  it("a reset baseline re-learns from the current height (no latch)", () => {
    const r = computeKeyboardState({ vvHeight: 400, baseline: 0 });
    expect(r.isOpen).toBe(false);
    expect(r.nextBaseline).toBe(400);
  });
});

// computeKeyboardState's unit tests above cover the pure arithmetic; these
// exercise startKeyboardState itself — the wiring that actually resets the
// baseline on rotation/resume. That wiring is what the module header calls
// out by name ("the latched-bar bug"), and until this block it had no test
// of its own: only the pure function's behavior GIVEN a reset baseline was
// covered, never that startKeyboardState performs the reset.
describe("startKeyboardState — rotation and resume reset the baseline", () => {
  // Control: shrinking WITHOUT a baseline reset misreads as the keyboard
  // opening — this is the latched-bar bug, reproduced directly. Proves the
  // suite can tell "reset ran" from "reset didn't run": the two tests below
  // start from this exact misread and must correct it back to closed.
  it("control: a shrink against a stale baseline (no reset) misreads as the keyboard opening", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: 800, inner: 800 });
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");

    expect(getVar("--kb-inset")).toBe("400px");
    expect(get(keyboardOpen)).toBe(true);
  });

  it("orientationchange resets the baseline, correcting the misread back to closed", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: 800, inner: 800 });
    startKeyboardState(win);

    // Reproduce the control's misread first — a plain resize against the
    // still-tall (800) baseline reads the new landscape height as the
    // keyboard opening. Asserting that here (not just relying on the
    // separate control test) means a broken reset below is caught by
    // THIS test failing, not by it vacuously staying at its initial value.
    win.visualViewport.height = 400;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(true);

    // The real 'orientationchange' event resets the baseline and re-applies
    // from the current (now legitimately shorter) height — this is the fix
    // under test. Removing its listener registration leaves the assertions
    // below failing at "true"/"400px" instead of passing.
    fire("win", "orientationchange");

    expect(getVar("--kb-inset")).toBe("0px");
    expect(get(keyboardOpen)).toBe(false);
  });

  it("visibilitychange (app resume) resets the baseline the same way orientationchange does", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: 800, inner: 800 });
    startKeyboardState(win);

    // Same misread, reproduced the same way: resume into a genuinely
    // shorter height (e.g. a different orientation than when the app was
    // backgrounded) reads as the keyboard being open against the stale
    // tall baseline, until visibilitychange resets it.
    win.visualViewport.height = 400;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(true);

    fire("doc", "visibilitychange"); // fakeWindow's doc.visibilityState is "visible"

    expect(getVar("--kb-inset")).toBe("0px");
    expect(get(keyboardOpen)).toBe(false);
  });

  it("keyboardOpen stays false when visualViewport is unavailable", () => {
    const { win } = fakeWindow({ visual: null, inner: 640 });
    startKeyboardState(win);
    expect(get(keyboardOpen)).toBe(false);
  });
});
