import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import { computeKeyboardState, keyboardOverlayPx, startKeyboardState, keyboardOpen, isTextFieldElement } from "../keyboard-state.js";
import { fakeWindow } from "./fake-window.js";

describe("computeKeyboardState", () => {
  it("reports closed at full height and learns the baseline", () => {
    const r = computeKeyboardState({ vvHeight: 800, baseline: 0 });
    expect(r.isOpen).toBe(false);
    expect(r.keyboardPx).toBe(0);
    expect(r.nextBaseline).toBe(800);
  });

  it("reports open when the viewport shrinks well below the baseline and a field is focused", () => {
    const r = computeKeyboardState({ vvHeight: 500, baseline: 800, hasFocusedField: true });
    expect(r.isOpen).toBe(true);
    expect(r.keyboardPx).toBe(300);
  });

  it("ignores sub-threshold shrink (browser chrome, not a keyboard)", () => {
    const r = computeKeyboardState({ vvHeight: 760, baseline: 800 });
    expect(r.isOpen).toBe(false);
    expect(r.keyboardPx).toBe(0);
  });

  it("a shrink past threshold with no focused field measures the inset but reports closed", () => {
    const r = computeKeyboardState({ vvHeight: 400, baseline: 800, hasFocusedField: false });
    expect(r.isOpen).toBe(false);
    expect(r.keyboardPx).toBe(400);
  });

  it("a shrink past threshold with a focused field reports open", () => {
    const r = computeKeyboardState({ vvHeight: 400, baseline: 800, hasFocusedField: true });
    expect(r.isOpen).toBe(true);
    expect(r.keyboardPx).toBe(400);
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
    // isOpen also requires a focused field (see the focus-gate describe
    // block below) — give it one so this test isolates the baseline-reset
    // mechanic under test, not that unrelated gate.
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");

    expect(getVar("--kb-inset")).toBe("400px");
    expect(get(keyboardOpen)).toBe(true);
  });

  it("orientationchange resets the baseline, correcting the misread back to closed", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = { tagName: "INPUT" };
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
    win.document.activeElement = { tagName: "INPUT" };
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

// The launch bug: on Android cold start the WebView can report a tall
// viewport, then a transient short one while splash/insets settle. That
// shrink alone used to read as "keyboard open" — and with no field focused,
// no further resize event would ever come along to correct it, so the flag
// (and the collapsed-header it drives) stuck forever. A soft keyboard cannot
// be open unless something is focused; hasFocusedField is the guard.
describe("startKeyboardState — a keyboard is not open unless a field is focused", () => {
  it("a shrink with NO focused field reports closed (the launch bug)", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = null;
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");

    expect(get(keyboardOpen)).toBe(false);
  });

  it("the same shrink WITH a focused field reports open", () => {
    const { win, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");

    expect(get(keyboardOpen)).toBe(true);
  });

  it("blurring after being open flips it closed via the focusout listener, with no viewport event", () => {
    const { win, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(true);

    // Focus leaves the field — no resize/scroll event follows this (the
    // viewport doesn't change shape just because focus moved), so only the
    // focusout listener re-running apply() can correct the flag.
    win.document.activeElement = null;
    fire("doc", "focusout");

    expect(get(keyboardOpen)).toBe(false);
  });

  it("focusing a field flips it open via the focusin listener, with no viewport event", () => {
    const { win, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = null;
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(false);

    win.document.activeElement = { tagName: "TEXTAREA" };
    fire("doc", "focusin");

    expect(get(keyboardOpen)).toBe(true);
  });

  it("--kb-inset zeroes when nothing is focused, even though the viewport measured a shrink", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = null;
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");

    expect(getVar("--kb-inset")).toBe("0px");
  });
});

// The IME-fight bug: while Android animates the keyboard open, the browser
// legitimately scrolls the layout viewport to keep the focused field
// visible. apply() used to yank that back with scrollTo(0, 0) on every vv
// event fired during the animation, fighting the IME and dropping focus.
// The fix: skip the reset while a text field has focus.
describe("startKeyboardState — scroll reset defers to a focused field", () => {
  it("does not call scrollTo when an input has focus (browser is legitimately revealing it)", () => {
    const { win, fire } = fakeWindow({ visual: 800, inner: 800, scrollY: 40 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");

    expect(win.scrollTo).not.toHaveBeenCalled();
  });

  it("does not call scrollTo when a contenteditable element has focus", () => {
    const { win, fire } = fakeWindow({ visual: 800, inner: 800, scrollY: 40 });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");

    expect(win.scrollTo).not.toHaveBeenCalled();
  });

  it("still calls scrollTo when nothing text-like has focus", () => {
    const { win, fire } = fakeWindow({ visual: 800, inner: 800, scrollY: 40 });
    win.document.activeElement = null;
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");

    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

describe("isTextFieldElement — who the keyboard is open for", () => {
  it("recognises the three field shapes", () => {
    expect(isTextFieldElement({ tagName: "INPUT" })).toBe(true);
    expect(isTextFieldElement({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextFieldElement({ isContentEditable: true })).toBe(true);
  });

  it("says no to nothing and to ordinary elements", () => {
    // Not decoration: this is the value the focusout path falls back to
    // when relatedTarget is null, which is the genuine blur-to-nothing
    // case that SHOULD close the keyboard. If this returned true the
    // keyboard would never be reported closed at all.
    expect(isTextFieldElement(null)).toBe(false);
    expect(isTextFieldElement(undefined)).toBe(false);
    expect(isTextFieldElement({ tagName: "BODY" })).toBe(false);
    expect(isTextFieldElement({ tagName: "BUTTON" })).toBe(false);
  });
});

describe("startKeyboardState — focusout to another field keeps the keyboard open", () => {
  it("does not publish 'closed' when focus is moving to a second field", () => {
    // The real defect this guards, not a hypothetical: on focusout the
    // browser has ALREADY set activeElement to BODY, so reading it alone
    // says "nothing focused" even while focus is in flight to another
    // input. That published keyboardOpen false and --kb-inset 0px for one
    // paint -- the phone header un-collapsed and the page's bottom padding
    // grew BETWEEN the tap and the click, moving the control out from under
    // the finger. Driven through startKeyboardState rather than asserted on
    // the predicate alone, because a predicate test passes whether or not
    // anything calls it.
    const { win, get: getVar, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(true);

    // Focus leaves the first field for a second one. The browser's state at
    // this instant: activeElement is BODY, relatedTarget is the new field.
    win.document.activeElement = { tagName: "BODY" };
    fire("doc", "focusout", { type: "focusout", relatedTarget: { tagName: "TEXTAREA" } });

    expect(get(keyboardOpen)).toBe(true);
    expect(getVar("--kb-inset")).toBe("400px");
  });

  it("still closes on a genuine blur to nothing", () => {
    // The other half, and the reason the fallback to activeElement stays:
    // relatedTarget is null when focus goes nowhere, which is exactly when
    // the keyboard really is dismissed.
    const { win, get: getVar, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(true);

    win.document.activeElement = { tagName: "BODY" };
    fire("doc", "focusout", { type: "focusout", relatedTarget: null });

    expect(get(keyboardOpen)).toBe(false);
    expect(getVar("--kb-inset")).toBe("0px");
  });
});

describe("keyboardOverlayPx — how far a fixed sheet must lift itself", () => {
  // The two widget modes, which is the whole point of the function. Both
  // sheets in this app were measured entirely off the top of the screen
  // because they lifted by the keyboard's HEIGHT under a mode that had
  // already shrunk the layout viewport for them.
  it("is zero under resizes-content, where the layout viewport already shrank", () => {
    // Android with interactive-widget=resizes-content, which is what
    // index.html asks for: innerHeight tracks the visual viewport, so a
    // fixed `bottom: 0` is already sitting on top of the keyboard and any
    // lift at all is a second subtraction of the same keyboard.
    expect(keyboardOverlayPx({ innerHeight: 360, vvHeight: 360, isOpen: true })).toBe(0);
  });

  it("is the keyboard's height under resizes-visual, where it did not", () => {
    // iOS/WKWebView ignores interactive-widget: innerHeight stays the full
    // device height while the visual viewport shrinks, so `bottom: 0` is
    // underneath the keyboard and the sheet has to supply the difference.
    expect(keyboardOverlayPx({ innerHeight: 839, vvHeight: 360, isOpen: true })).toBe(479);
  });

  it("is zero when the keyboard is not open, whatever the viewports say", () => {
    // Not a "nothing happens" placeholder: a cold-start transient shrink
    // with no field focused reports isOpen false, and publishing a lift
    // for it would nudge fixed chrome before the user has touched a field
    // — the same class of bug the --kb-inset isOpen gate exists for.
    expect(keyboardOverlayPx({ innerHeight: 839, vvHeight: 360, isOpen: false })).toBe(0);
  });

  it("never returns a negative lift", () => {
    // visualViewport can report TALLER than innerHeight mid-rotation. A
    // negative here would push a sheet down off the bottom of the screen,
    // so it clamps rather than trusting the arithmetic.
    expect(keyboardOverlayPx({ innerHeight: 360, vvHeight: 839, isOpen: true })).toBe(0);
  });

  it("is zero rather than NaN when a viewport height is missing", () => {
    // startKeyboardState also runs under the fake-window harness and
    // before visualViewport exists. NaN would serialise into the CSS var
    // as "NaNpx" and silently void the whole rule.
    expect(keyboardOverlayPx({ innerHeight: undefined, vvHeight: 360, isOpen: true })).toBe(0);
    expect(keyboardOverlayPx({ innerHeight: 839, vvHeight: undefined, isOpen: true })).toBe(0);
  });
});

describe("startKeyboardState — --kb-overlay reaches the document", () => {
  // keyboardOverlayPx is pure and its unit tests above pass whether or not
  // anything ever calls it. These assert the wiring: the var is published,
  // and it is published from innerHeight rather than from the keyboard
  // height that --kb-inset carries. Seven modules in this codebase have
  // sat tested-and-uncalled; this is the assertion that would have caught
  // an eighth.
  it("publishes 0 under resizes-content while --kb-inset carries the keyboard", () => {
    // innerHeight shrinks WITH the visual viewport: Android, and what
    // index.html asks for. The two vars must disagree here — that
    // disagreement is the entire reason --kb-overlay exists.
    const { win, get: getVar, fire } = fakeWindow({ visual: 839, inner: 839 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);

    win.visualViewport.height = 360;
    win.innerHeight = 360;
    fire("vv", "resize");

    expect(getVar("--kb-inset")).toBe("479px");
    expect(getVar("--kb-overlay")).toBe("0px");
  });

  it("publishes the keyboard height under resizes-visual", () => {
    // innerHeight stays full while the visual viewport shrinks: iOS.
    // Here the two vars agree, and a fixed sheet genuinely must lift.
    const { win, get: getVar, fire } = fakeWindow({ visual: 839, inner: 839 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);

    win.visualViewport.height = 360;
    fire("vv", "resize");

    expect(getVar("--kb-inset")).toBe("479px");
    expect(getVar("--kb-overlay")).toBe("479px");
  });

  it("publishes 0 when no field is focused, like --kb-inset", () => {
    // The cold-start transient shrink. Asserted rather than assumed
    // because the gate lives in the caller, not in keyboardOverlayPx's
    // arithmetic.
    const { win, get: getVar, fire } = fakeWindow({ visual: 839, inner: 839 });
    win.document.activeElement = null;
    startKeyboardState(win);

    win.visualViewport.height = 360;
    fire("vv", "resize");

    expect(getVar("--kb-overlay")).toBe("0px");
  });
});
