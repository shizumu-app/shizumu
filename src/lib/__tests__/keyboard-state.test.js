import { describe, it, expect, vi, afterEach } from "vitest";
import { get } from "svelte/store";
import { computeKeyboardState, keyboardOverlayPx, startKeyboardState, keyboardOpen, isTextFieldElement, viewportOffsetTopPx, credibleViewportHeight, scaledViewportHeight, visibleBandHeight, cssPx } from "../keyboard-state.js";
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

  it("blurring after being open flips it closed via the focusout listener, with no viewport event", async () => {
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

    // ONE MICROTASK, because a focus event can arrive mid-render and the
    // publish is deferred past it — see the listener's own note. Awaiting
    // here is what pins that: delete the deferral and this still passes,
    // which is why the test below asserts the synchronous state too.
    expect(get(keyboardOpen)).toBe(true);
    await Promise.resolve();
    expect(get(keyboardOpen)).toBe(false);
  });

  it("focusing a field flips it open via the focusin listener, with no viewport event", async () => {
    const { win, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = null;
    startKeyboardState(win);

    win.visualViewport.height = 400;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(false);

    win.document.activeElement = { tagName: "TEXTAREA" };
    fire("doc", "focusin");

    await Promise.resolve();
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

  it("still closes on a genuine blur to nothing", async () => {
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

    await Promise.resolve();
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

// ── the panned visual viewport ─────────────────────────────────────────
//
// Found on a Samsung phone, Android 15, in the shell's second device pass:
// with the keyboard up the whole shell sat ~100px too high — the header
// under the status bar, and a band of bare canvas between the editor strip
// and the keyboard — but only sometimes. Under resizes-visual the layout
// viewport keeps its full height and the browser PANS the visual viewport
// inside it to reveal the caret (offsetTop > 0). A `position: fixed` frame
// is pinned to the LAYOUT viewport's top, so a pan of X carries it X off
// the top of the screen and leaves X of nothing above the keyboard. It is
// "sometimes" because the pan only happens when the caret is low enough
// to need revealing.
describe("viewportOffsetTopPx — how far the visual viewport has panned", () => {
  it("reports the pan while the keyboard is open", () => {
    expect(viewportOffsetTopPx({ offsetTop: 96, isOpen: true })).toBe(96);
  });

  it("reports 0 with the keyboard down, whatever the viewport says", () => {
    // Gated like --kb-inset and --kb-overlay: a pinch-zoom or an overscroll
    // bounce also moves offsetTop, and chrome that chased those would slide
    // around under a finger that is not typing.
    expect(viewportOffsetTopPx({ offsetTop: 96, isOpen: false })).toBe(0);
  });

  it("reports 0 for a missing, negative or non-finite offset", () => {
    // Older webviews have no offsetTop; iOS reports small negatives during
    // rubber-banding. NaN would serialise into the CSS var as "NaNpx".
    expect(viewportOffsetTopPx({ offsetTop: undefined, isOpen: true })).toBe(0);
    expect(viewportOffsetTopPx({ offsetTop: -4, isOpen: true })).toBe(0);
    expect(viewportOffsetTopPx({ offsetTop: NaN, isOpen: true })).toBe(0);
  });
});

describe("keyboardOverlayPx — a panned viewport has already cleared part of the keyboard", () => {
  it("lifts a fixed sheet by what is still covered, not by the whole keyboard", () => {
    // innerHeight 839, visual 360, panned 96: the visible band is layout
    // y 96..456, so its bottom is 383 above the layout bottom — not 479.
    // Lifting by 479 floats the sheet 96px above the keyboard, the same
    // gap the frame had.
    expect(keyboardOverlayPx({ innerHeight: 839, vvHeight: 360, offsetTop: 96, isOpen: true })).toBe(383);
  });

  it("is unchanged when nothing has panned", () => {
    expect(keyboardOverlayPx({ innerHeight: 839, vvHeight: 360, offsetTop: 0, isOpen: true })).toBe(479);
    expect(keyboardOverlayPx({ innerHeight: 839, vvHeight: 360, isOpen: true })).toBe(479);
  });
});

describe("startKeyboardState — --vv-offset-top reaches the document", () => {
  it("publishes the pan on a viewport scroll, and takes it off the overlay", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: 839, inner: 839 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);
    expect(getVar("--vv-offset-top")).toBe("0px");

    win.visualViewport.height = 360;
    fire("vv", "resize");
    win.visualViewport.offsetTop = 96;
    fire("vv", "scroll");

    expect(getVar("--vv-offset-top")).toBe("96px");
    expect(getVar("--kb-overlay")).toBe("383px");
  });

  it("publishes 0 again when the keyboard goes down", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: 839, inner: 839 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);
    win.visualViewport.height = 360;
    win.visualViewport.offsetTop = 96;
    fire("vv", "resize");
    expect(getVar("--vv-offset-top")).toBe("96px");

    win.visualViewport.height = 839;
    win.visualViewport.offsetTop = 0;
    fire("vv", "resize");
    expect(getVar("--vv-offset-top")).toBe("0px");
  });
});

// ── a baseline learned too tall ────────────────────────────────────────
//
// The same device pass, a second photograph: the editor strip sitting at
// the bottom of the screen with NO keyboard up, where the tab bar belongs.
// An edge-to-edge Android window reports its full height for a frame or
// two at launch, before the system bars' insets land; the baseline is a
// running max, so it kept that height, and from then on the settled
// viewport read as ~80px "shrunk" — right at the keyboard threshold, which
// is why it was only sometimes. Nothing corrected it short of a rotation.
describe("computeKeyboardState — the baseline heals while no field is focused", () => {
  it("takes the current height as the baseline when nothing is focused", () => {
    // No focused field means no keyboard, so whatever the viewport
    // measures now IS the keyboard-down height. A stale-tall 900 is
    // dropped for the real 812.
    const s = computeKeyboardState({ vvHeight: 812, baseline: 900, hasFocusedField: false });
    expect(s.nextBaseline).toBe(812);
    expect(s.isOpen).toBe(false);
    expect(s.keyboardPx).toBe(0);
  });

  it("does not call the healed viewport a keyboard once a field takes focus", () => {
    const healed = computeKeyboardState({ vvHeight: 812, baseline: 900, hasFocusedField: false });
    const focused = computeKeyboardState({
      vvHeight: 812, baseline: healed.nextBaseline, hasFocusedField: true,
    });
    expect(focused.isOpen).toBe(false);
  });

  it("does not heal to a height a keyboard is still holding down", () => {
    // A blur to nothing can land while the IME is still on screen. Adopting
    // that height would poison the baseline SHORT: the next real keyboard
    // would measure as no shrink, and the strip would never open. 412px of
    // excess is a keyboard, not a system bar.
    const s = computeKeyboardState({ vvHeight: 400, baseline: 812, hasFocusedField: false });
    expect(s.nextBaseline).toBe(812);
    expect(s.isOpen).toBe(false);
  });

  it("still holds the tall baseline while a field is focused, so a real keyboard reads as one", () => {
    const s = computeKeyboardState({ vvHeight: 400, baseline: 812, hasFocusedField: true });
    expect(s.nextBaseline).toBe(812);
    expect(s.isOpen).toBe(true);
    expect(s.keyboardPx).toBe(412);
  });
});

// ── the stuck strip, with a field focused ──────────────────────────────
//
// The third device pass: "sometimes the screen blocks with the button menu
// at bottom, no way to move pages" — the editor strip up with no keyboard,
// so no tab bar and no way to memory or settings. The heal above cannot
// reach it when the editor already HOLDS focus: a baseline learned from a
// full-height launch frame reads the settled viewport as ~80–120px shrunk,
// a field is focused, and that was enough to call the keyboard open for
// the whole session. No soft keyboard is that short — the smallest phone
// keyboard is well over 200 CSS px — so a shrink under 150 is chrome, not
// a keyboard, whatever has focus.
describe("computeKeyboardState — a shrink no keyboard is that short", () => {
  it("reports closed for a 120px shrink even with a field focused", () => {
    const r = computeKeyboardState({ vvHeight: 692, baseline: 812, hasFocusedField: true });
    expect(r.isOpen).toBe(false);
  });

  it("still reports the smallest real keyboard as open", () => {
    const r = computeKeyboardState({ vvHeight: 572, baseline: 812, hasFocusedField: true });
    expect(r.isOpen).toBe(true);
    expect(r.keyboardPx).toBe(240);
  });
});

// ── the keyboard that left without saying so (device, 2026-10-03) ─────────
//
// Reported from a Galaxy A34 running the phone shell: after creating a
// trail, the bottom bar kept the editor strip, the nav stayed collapsed, and
// the trail name did nothing. Closing and reopening the app fixed it every
// time. The on-screen viewport readout caught the state:
//
//     inner 447  vv 447  pan 0  scroll 0
//     app 447  inset 310  overlay 0  top 0
//     kb up  field yes  resize
//
// Read it with the screenshot beside it and the shape is plain. inner equals
// vv, so nothing covers the viewport; the app nonetheless reserves 310px for
// a keyboard; and the window on screen was back to its full height while
// these numbers say 447. The window grew back when the keyboard left and NO
// viewport event arrived to say so, which is why no rule inside
// computeKeyboardState could have saved it: the function was never called
// again.
//
// `keyboardOpen` true keeps the editor strip (toolbar-model.js gives the
// slot to navigation only when the keyboard is down) and keeps the nav
// collapsed (nav-collapse.js:36), which is the whole reported bug: no way
// off the page, no way to add a page, no way to change the trail.
describe("startKeyboardState — a keyboard that goes away without an event", () => {
  const DEVICE_TALL = 757; // 447 + the 310 inset the readout showed
  const DEVICE_SHORT = 447;

  it("control: the latch, exactly as the device reported it", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: DEVICE_TALL, inner: DEVICE_TALL });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    startKeyboardState(win);

    // The keyboard opens: under resizes-content both viewports shrink.
    win.visualViewport.height = DEVICE_SHORT;
    win.innerHeight = DEVICE_SHORT;
    fire("vv", "resize");
    expect(getVar("--kb-inset")).toBe("310px");
    expect(get(keyboardOpen)).toBe(true);

    // The keyboard goes away and the window grows back — but the webview
    // reports nothing. Every later read of the viewport would see 757; the
    // app simply never looks again.
    win.visualViewport.height = DEVICE_TALL;
    win.innerHeight = DEVICE_TALL;

    expect(getVar("--kb-inset")).toBe("310px");
    expect(get(keyboardOpen)).toBe(true);
  });

  it("a tap re-measures, which unlatches the bar", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: DEVICE_TALL, inner: DEVICE_TALL });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    startKeyboardState(win);

    win.visualViewport.height = DEVICE_SHORT;
    win.innerHeight = DEVICE_SHORT;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(true);

    win.visualViewport.height = DEVICE_TALL;
    win.innerHeight = DEVICE_TALL;

    // The user's own next touch is the trigger: finding the bar stuck, they
    // tap it. Re-measuring there costs one read of a number the browser
    // already has, and it is the moment correctness is wanted most.
    fire("doc", "pointerdown");

    expect(getVar("--kb-inset")).toBe("0px");
    expect(get(keyboardOpen)).toBe(false);
  });

  it("a tap while the keyboard really is up leaves it open", () => {
    // The guard against overcorrecting: tapping inside the document with the
    // IME genuinely on screen must not put the editor strip away mid-type.
    const { win, get: getVar, fire } = fakeWindow({ visual: DEVICE_TALL, inner: DEVICE_TALL });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    startKeyboardState(win);

    win.visualViewport.height = DEVICE_SHORT;
    win.innerHeight = DEVICE_SHORT;
    fire("vv", "resize");
    fire("doc", "pointerdown");

    expect(getVar("--kb-inset")).toBe("310px");
    expect(get(keyboardOpen)).toBe(true);
  });
});

// ── the heartbeat, for a webview that never speaks again ──────────────────
//
// The device said the tap fix is a recovery, not a cure: between the
// keyboard leaving and the next touch, the shell still believes a keyboard
// is up, and on this phone that state arrives on every first launch after
// an install. A user who cannot find the tab bar does not know that tapping
// anything brings it back — they close the app, which is exactly what was
// reported.
//
// So while the shell believes a keyboard is open, it checks. One read of
// two numbers the browser already holds, once a second, and only while the
// belief is held: with the keyboard down there is no timer at all, which is
// what the last test here pins.
describe("startKeyboardState — the open keyboard is re-checked on a timer", () => {
  const TALL = 757;
  const SHORT = 447;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops the belief when the viewport has quietly grown back", () => {
    vi.useFakeTimers();
    const { win, get: getVar, fire } = fakeWindow({ visual: TALL, inner: TALL });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    startKeyboardState(win);

    win.visualViewport.height = SHORT;
    win.innerHeight = SHORT;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(true);

    // The keyboard goes; no resize, no scroll, no focus change, no touch.
    win.visualViewport.height = TALL;
    win.innerHeight = TALL;
    vi.advanceTimersByTime(1000);

    expect(getVar("--kb-inset")).toBe("0px");
    expect(get(keyboardOpen)).toBe(false);
  });

  it("leaves a real keyboard alone, tick after tick", () => {
    vi.useFakeTimers();
    const { win, get: getVar, fire } = fakeWindow({ visual: TALL, inner: TALL });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    startKeyboardState(win);

    win.visualViewport.height = SHORT;
    win.innerHeight = SHORT;
    fire("vv", "resize");

    vi.advanceTimersByTime(5000);

    expect(getVar("--kb-inset")).toBe("310px");
    expect(get(keyboardOpen)).toBe(true);
  });

  it("runs no timer while the keyboard is down", () => {
    // The cost of this fallback is what makes it acceptable, so it is
    // asserted rather than described: idle means idle.
    vi.useFakeTimers();
    const { win, fire } = fakeWindow({ visual: TALL, inner: TALL });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    startKeyboardState(win);
    expect(vi.getTimerCount()).toBe(0);

    win.visualViewport.height = SHORT;
    win.innerHeight = SHORT;
    fire("vv", "resize");
    expect(vi.getTimerCount()).toBe(1);

    win.visualViewport.height = TALL;
    win.innerHeight = TALL;
    fire("vv", "resize");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the timer when the subscription is torn down", () => {
    vi.useFakeTimers();
    const { win, fire } = fakeWindow({ visual: TALL, inner: TALL });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    const stop = startKeyboardState(win);

    win.visualViewport.height = SHORT;
    win.innerHeight = SHORT;
    fire("vv", "resize");
    expect(vi.getTimerCount()).toBe(1);

    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ── one owner, however many callers ───────────────────────────────────────
//
// This module's header has always said it is the app's only visualViewport
// subscriber. On the phone that stopped being true: App.svelte runs
// `syncAppHeight()` (this same function, re-exported by viewport-height.js)
// for every mount, and ShellRoot.svelte calls startKeyboardState() again
// when it mounts. Two live subscriptions, each with its own `baseline` in
// its own closure, both writing --kb-inset, --app-height and the shared
// keyboardOpen store.
//
// Two baselines mean two beliefs about the keyboard, and the last writer
// wins per event — so the published state depends on listener order rather
// than on the viewport. The recheck timer made it louder still: whichever
// instance is wrong re-asserts itself every second.
//
// A second caller therefore joins the first rather than starting a rival,
// and the subscription ends when the last of them lets go.
describe("startKeyboardState — a second caller joins rather than rivals", () => {
  const TALL = 757;
  const SHORT = 447;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("installs one subscription for two callers", () => {
    vi.useFakeTimers();
    const { win, fire } = fakeWindow({ visual: TALL, inner: TALL });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };

    startKeyboardState(win);
    startKeyboardState(win);

    win.visualViewport.height = SHORT;
    win.innerHeight = SHORT;
    fire("vv", "resize");

    // One timer, not two: the heartbeat belongs to the subscription, and
    // there is one subscription.
    expect(vi.getTimerCount()).toBe(1);
  });

  it("keeps working after the first caller lets go", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: TALL, inner: TALL });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };

    const stopFirst = startKeyboardState(win);
    startKeyboardState(win);
    stopFirst();

    // ShellRoot unmounts and remounts around the onboarding gate while
    // App.svelte's effect stays live. If the first teardown killed the
    // listeners, the shell would go deaf for the rest of the session.
    win.visualViewport.height = SHORT;
    win.innerHeight = SHORT;
    fire("vv", "resize");

    expect(getVar("--kb-inset")).toBe("310px");
    expect(get(keyboardOpen)).toBe(true);
  });

  it("stops once the last caller lets go", () => {
    vi.useFakeTimers();
    const { win, get: getVar, fire } = fakeWindow({ visual: TALL, inner: TALL });
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };

    const stopFirst = startKeyboardState(win);
    const stopSecond = startKeyboardState(win);
    win.visualViewport.height = SHORT;
    win.innerHeight = SHORT;
    fire("vv", "resize");
    const inset = getVar("--kb-inset");

    stopFirst();
    stopSecond();

    expect(vi.getTimerCount()).toBe(0);
    // Deaf now: a further event changes nothing.
    win.visualViewport.height = TALL;
    win.innerHeight = TALL;
    fire("vv", "resize");
    expect(getVar("--kb-inset")).toBe(inset);
  });
});

// ── when the viewport api lies ────────────────────────────────────────────
//
// Galaxy A34, first launch after an install, every time. Android's own log
// at the moment the shell was stuck:
//
//   ITYPE_IME ... mVisible=false
//   handleResized frames=[0,0][1080,2340]  frameChanged=false
//   density={2.8125}
//
// The IME is hidden and the window is the full display: 2340 physical, less
// the 75 status bar and 135 nav bar, at density 2.8125, is 757 CSS px — the
// same 757 a healthy session reports. The webview nonetheless answered 447
// for both innerHeight and visualViewport.height, and kept answering it
// when asked again on a tap (the readout's last event was `pointerdown`).
//
// So re-measuring through those two cannot help, however often it is done.
// documentElement.clientHeight is the CSS layout viewport, maintained by
// the rendering side rather than the viewport API, and the screenshot
// agrees with it: the app's frame filled the screen instead of leaving a
// 310px band of nothing below it.
//
// Preferring it is guarded, because on iOS the same comparison means the
// opposite. There the layout viewport KEEPS its height and the keyboard
// overlays the visual one, so clientHeight legitimately exceeds vvHeight
// and the keyboard really is up. The shapes differ in innerHeight: under
// resizes-content it shrinks with the visual viewport, under
// resizes-visual it does not.
describe("credibleViewportHeight — which number to believe", () => {
  it("believes the visual viewport when all three agree", () => {
    expect(credibleViewportHeight({ vvHeight: 447, innerHeight: 447, clientHeight: 447 })).toBe(447);
  });

  it("believes the layout viewport when the other two are stale (the device case)", () => {
    expect(credibleViewportHeight({ vvHeight: 447, innerHeight: 447, clientHeight: 757 })).toBe(757);
  });

  it("keeps believing the visual viewport when the keyboard overlays it (iOS)", () => {
    // innerHeight staying tall IS the overlay: the layout viewport never
    // shrank, so clientHeight exceeding vvHeight is the keyboard, not a lie.
    expect(credibleViewportHeight({ vvHeight: 447, innerHeight: 757, clientHeight: 757 })).toBe(447);
  });

  it("ignores a missing or absurd layout height", () => {
    expect(credibleViewportHeight({ vvHeight: 447, innerHeight: 447, clientHeight: 0 })).toBe(447);
    expect(credibleViewportHeight({ vvHeight: 447, innerHeight: 447 })).toBe(447);
    // Smaller than the visual viewport: nothing to learn, and preferring it
    // would invent a keyboard.
    expect(credibleViewportHeight({ vvHeight: 757, innerHeight: 757, clientHeight: 400 })).toBe(757);
  });
});

describe("startKeyboardState — the heartbeat clears a lying viewport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops the belief when only the layout viewport tells the truth", () => {
    vi.useFakeTimers();
    const { win, get: getVar, fire } = fakeWindow({ visual: 757, inner: 757 });
    win.document.documentElement.clientHeight = 757;
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    startKeyboardState(win);

    win.visualViewport.height = 447;
    win.innerHeight = 447;
    win.document.documentElement.clientHeight = 447;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(true);

    // The keyboard goes. Android resizes the window back; the webview keeps
    // answering 447 to both viewport questions, as it did on the device.
    // Only the layout viewport reflects what is on screen.
    win.document.documentElement.clientHeight = 757;
    vi.advanceTimersByTime(1000);

    expect(getVar("--kb-inset")).toBe("0px");
    expect(get(keyboardOpen)).toBe(false);
  });
});

// ── the keyboard that was a zoom ──────────────────────────────────────────
//
// The diagnostic build settled four days of wrong guesses. On a Galaxy A34
// with the bar stuck, every window measure agreed:
//
//     inner 447  vv 447
//     client 447  html 447  avail 832  outer 447
//
// Nothing was stale. `html` is the laid-out box of the document itself, and
// it said 447 too — so the page really was 447 CSS px tall. It was painting
// about 690 px of screen, which is a page zoomed by roughly 1.5, and the
// screenshots bear it out: the text in every stuck frame is visibly larger
// than in a healthy one.
//
// So the window never shrank for a keyboard. The page scale changed, the
// layout viewport shrank to match, and this module compared that against a
// baseline learned at scale 1 — reading the difference as a 310px keyboard
// that was never there. It explains the parts that made no sense: why no
// viewport event ever arrives (nothing resized), why re-measuring returns
// the same number (it is the true number), and why only a restart clears it
// (a restart resets the scale).
//
// index.html permits this: the viewport meta sets initial-scale but neither
// user-scalable=no nor maximum-scale, so a pinch or a webview's own
// focus-zoom can change it.
describe("scaledViewportHeight — heights that mean the same at any zoom", () => {
  it("is the plain height at scale 1", () => {
    expect(scaledViewportHeight({ vvHeight: 757, scale: 1 })).toBe(757);
  });

  it("undoes the zoom, which is what makes a baseline comparable", () => {
    // 447 at 1.54x is the device's stuck state: about 688, within a few px
    // of the 757 it was before, and nowhere near a keyboard.
    expect(Math.round(scaledViewportHeight({ vvHeight: 447, scale: 1.54 }))).toBe(688);
  });

  it("falls back to the plain height when there is no scale to speak of", () => {
    // Older webviews do not report scale; a missing one must not zero the
    // height and invent a keyboard the size of the whole window.
    expect(scaledViewportHeight({ vvHeight: 757 })).toBe(757);
    expect(scaledViewportHeight({ vvHeight: 757, scale: 0 })).toBe(757);
    expect(scaledViewportHeight({ vvHeight: 757, scale: NaN })).toBe(757);
  });
});

describe("startKeyboardState — a zoom is not a keyboard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not read a page zoom as the keyboard opening", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: 757, inner: 757 });
    win.visualViewport.scale = 1;
    win.document.documentElement.clientHeight = 757;
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    startKeyboardState(win);

    // The page zooms. Every measure shrinks together, exactly as the device
    // reported, and no event says why.
    win.visualViewport.height = 447;
    win.innerHeight = 447;
    win.document.documentElement.clientHeight = 447;
    win.visualViewport.scale = 1.54;
    fire("vv", "resize");

    expect(getVar("--kb-inset")).toBe("0px");
    expect(get(keyboardOpen)).toBe(false);
  });

  it("still sees a real keyboard, which shrinks the window without zooming", () => {
    const { win, get: getVar, fire } = fakeWindow({ visual: 757, inner: 757 });
    win.visualViewport.scale = 1;
    win.document.documentElement.clientHeight = 757;
    win.document.activeElement = { tagName: "DIV", isContentEditable: true };
    startKeyboardState(win);

    win.visualViewport.height = 447;
    win.innerHeight = 447;
    win.document.documentElement.clientHeight = 447;
    fire("vv", "resize");

    expect(getVar("--kb-inset")).toBe("310px");
    expect(get(keyboardOpen)).toBe(true);
  });
});

describe("the native IME signal", () => {
  afterEach(() => { vi.useRealTimers(); });

  // THE DEVICE SHAPE, as a pair. The control is what the Galaxy A34
  // actually reported and what no rule over those numbers could fix:
  // baseline learned at 705, every viewport API frozen at 411 and never
  // growing back, the contenteditable canvas holding focus. Healing is
  // blocked twice — the 294px gap is over healBelowPx AND a field is
  // focused — so isOpen is true for the rest of the session.
  const STUCK = { vvHeight: 411, baseline: 705, hasFocusedField: true };

  it("control: the latch, exactly as the device reported it", () => {
    const r = computeKeyboardState({ ...STUCK });
    expect(r.isOpen).toBe(true);
    expect(r.keyboardPx).toBe(294);
    // And it cannot recover: the baseline it hands back is the poisoned
    // one, so the next call computes the same answer, forever.
    expect(r.nextBaseline).toBe(705);
  });

  it("android saying the keyboard is down ends the latch and heals the baseline", () => {
    const r = computeKeyboardState({ ...STUCK, native: { visible: false, heightPx: 0 } });
    expect(r.isOpen).toBe(false);
    expect(r.keyboardPx).toBe(0);
    // The baseline adopts the current height unconditionally. Without this
    // the next event with no native signal would latch all over again.
    expect(r.nextBaseline).toBe(411);
  });

  it("android saying the keyboard is up needs no shrink at all", () => {
    // The iOS/resizes-visual shape, and the "the window never shrank" case
    // at once: nothing in the viewport moved, and the keyboard is still up.
    const r = computeKeyboardState({
      vvHeight: 800, baseline: 800, hasFocusedField: true,
      native: { visible: true, heightPx: 312 },
    });
    expect(r.isOpen).toBe(true);
    expect(r.keyboardPx).toBe(312);
  });

  it("an up signal with no measurable height reports no height", () => {
    // THIS USED TO FALL BACK TO `baseline - vvHeight`, and that fallback was
    // written for adjustResize: the window had already been pulled out of
    // the IME region, so a native inset of 0 was plausible and the shrink
    // was the real height.
    //
    // Android 15 ignores adjustResize for an edge-to-edge app targeting SDK
    // 35+ and this one targets 36, so the window never moves and the shrink
    // is 0 — on the device the fallback was supposed to rescue. Worse, it
    // fires on the stuck-viewport shape too: a frozen 411 under a learned
    // 705 would be published as a 294px keyboard on a phone whose IME is
    // 310, from a signal that carried no height at all.
    //
    // A visible IME with no height is a broken publisher. Say 0 and let the
    // readout's `nat` line be the diagnosis.
    const r = computeKeyboardState({
      vvHeight: 500, baseline: 800, hasFocusedField: true,
      native: { visible: true, heightPx: 0 },
    });
    expect(r.isOpen).toBe(true);
    expect(r.keyboardPx).toBe(0);
  });

  it("does not gate the native answer on a focused field", () => {
    // The focus gate guards an INFERENCE — a cold start reports a transient
    // short viewport with nothing focused. A system-reported IME is not an
    // inference, and gating it would put the focusout race back in by
    // another door.
    const r = computeKeyboardState({
      vvHeight: 500, baseline: 800, hasFocusedField: false,
      native: { visible: true, heightPx: 300 },
    });
    expect(r.isOpen).toBe(true);
  });

  it("holds the tall baseline while the keyboard is up", () => {
    const r = computeKeyboardState({
      vvHeight: 411, baseline: 705, hasFocusedField: true,
      native: { visible: true, heightPx: 294 },
    });
    // Healing to a keyboard-down height here is the poisoning healBelowPx
    // exists to prevent, one branch over.
    expect(r.nextBaseline).toBe(705);
  });

  it("installs a receiver on the window and takes it away on release", () => {
    const { win } = fakeWindow();
    const release = startKeyboardState(win);
    expect(typeof win.__nativeKeyboard).toBe("function");
    release();
    expect(win.__nativeKeyboard).toBeUndefined();
  });

  it("publishes from the native signal alone, with no viewport event", () => {
    // No resize, no scroll, no focus change — the exact silence the
    // heartbeat was added for, except this time something has the answer.
    const { win, get: css } = fakeWindow({ visual: 500, inner: 500 });
    const release = startKeyboardState(win);
    expect(css("--kb-inset")).toBe("0px");
    expect(get(keyboardOpen)).toBe(false);

    win.__nativeKeyboard({ visible: true, heightPx: 300 });
    expect(css("--kb-inset")).toBe("300px");
    expect(get(keyboardOpen)).toBe(true);

    win.__nativeKeyboard({ visible: false, heightPx: 0 });
    expect(css("--kb-inset")).toBe("0px");
    expect(get(keyboardOpen)).toBe(false);
    release();
  });

  it("adopts a value the activity published before this module existed", () => {
    // wry calls onWebViewCreate from setWebView(), which runs BEFORE
    // loadUrl — so the first value can land before the document exists,
    // never mind before startKeyboardState. The activity stashes as well
    // as calls, and this is the half that reads the stash.
    const { win } = fakeWindow({ visual: 500, inner: 500 });
    win.__nativeKeyboardState = { visible: true, heightPx: 300 };
    const release = startKeyboardState(win);
    expect(get(keyboardOpen)).toBe(true);
    release();
  });

  it("survives a reset, because reset clears an inference and this is not one", () => {
    const { win, fire } = fakeWindow({ visual: 411, inner: 411 });
    const release = startKeyboardState(win);
    win.__nativeKeyboard({ visible: true, heightPx: 294 });
    expect(get(keyboardOpen)).toBe(true);

    // Both of reset()'s triggers. They zero the baseline, which would make
    // the ARITHMETIC answer "closed" — and must not touch the fact.
    fire("win", "orientationchange");
    expect(get(keyboardOpen)).toBe(true);
    fire("doc", "visibilitychange");
    expect(get(keyboardOpen)).toBe(true);
    release();
  });

  it("is not undone by the heartbeat", () => {
    vi.useFakeTimers();
    const { win } = fakeWindow({ visual: 411, inner: 411 });
    const release = startKeyboardState(win);
    win.__nativeKeyboard({ visible: true, heightPx: 294 });
    expect(get(keyboardOpen)).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(get(keyboardOpen)).toBe(true);
    release();
  });

  it("a second subscriber does not reinstall or clobber the receiver", () => {
    const { win } = fakeWindow();
    const release1 = startKeyboardState(win);
    const first = win.__nativeKeyboard;
    const release2 = startKeyboardState(win);
    expect(win.__nativeKeyboard).toBe(first);
    release1();
    // Still live while anyone holds a share — same rule as the listeners.
    expect(win.__nativeKeyboard).toBe(first);
    release2();
    expect(win.__nativeKeyboard).toBeUndefined();
  });

  it("ignores a malformed payload rather than believing it", () => {
    const { win } = fakeWindow({ visual: 411, inner: 411 });
    const release = startKeyboardState(win);
    win.__nativeKeyboard(null);
    win.__nativeKeyboard("up");
    // Still the arithmetic's answer: nothing focused, so closed.
    expect(get(keyboardOpen)).toBe(false);
    release();
  });
});

describe("visibleBandHeight", () => {
  // THE A16, MEASURED. Android 15 enforces edge-to-edge and ignores
  // adjustResize for targetSdk 35+ (this targets 36), so the IME resizes
  // neither viewport: innerHeight 832 and visualViewport.height 832 with a
  // 310px keyboard on screen. Every number the webview reports says there
  // is no keyboard.
  const A16 = { innerHeight: 832, vvHeight: 832 };

  it("subtracts the measured IME when neither viewport moved", () => {
    expect(visibleBandHeight({ ...A16, native: { visible: true, heightPx: 310 } })).toBe(522);
  });

  it("control: without the native height the band is the whole display", () => {
    // Not an empty assertion: 832 IS what --app-height published on the
    // device, and it is the bug — a frame full-display tall with the
    // keyboard over its bottom third and the editor strip behind it.
    expect(visibleBandHeight({ ...A16, native: null })).toBe(832);
    expect(visibleBandHeight({ ...A16, native: { visible: false, heightPx: 0 } })).toBe(832);
  });

  it("does NOT subtract twice when the layout viewport already shrank", () => {
    // THE SHAPE THIS USED TO GET WRONG, in the test as well as the code. It
    // asserted `innerHeight: 832, vvHeight: 522` and called that "the layout
    // viewport already shrank" — but 832 IS the layout viewport, so that
    // fixture is the iOS shape and the real case went untested. Under
    // resizes-content both viewports shrink TOGETHER, so the device answers
    // 522/522, and the guard that compared them to each other was false
    // exactly when it was needed: a 212px band on an 832px display, the frame
    // a quarter of the way up the screen with the writing below the fold.
    //
    // What makes it right now is the number's meaning rather than a guess
    // about the shape: the activity reports how far the IME intrudes into its
    // own window, and on a window that was moved out of the way that is 0.
    expect(visibleBandHeight({
      innerHeight: 522, vvHeight: 522, native: { visible: true, heightPx: 0 },
    })).toBe(522);
    // And the same device while nothing is up, for the pair.
    expect(visibleBandHeight({
      innerHeight: 832, vvHeight: 832, native: { visible: false, heightPx: 0 },
    })).toBe(832);
  });

  it("control: a publisher that lies about intrusion is believed", () => {
    // NOT A WISH, A BOUNDARY. There is deliberately no guard left here, so a
    // reported intrusion that the window does not actually have is subtracted
    // — 522 - 310. That is the old bug's arithmetic, and it is written down
    // rather than defended against because the defence was the bug: every
    // condition available on this side distinguishes the wrong pair of
    // shapes, and the only place that knows whether a window was moved is the
    // activity that owns it. If this number is ever wrong again, the fix is in
    // the Kotlin, and this assertion is the pointer to that.
    expect(visibleBandHeight({
      innerHeight: 522, vvHeight: 522, native: { visible: true, heightPx: 310 },
    })).toBe(212);
  });

  it("allows a pixel of disagreement between the two viewports", () => {
    // A device pass found them reading 832 and 831.6 on different events in
    // one keyboard-up sequence. An exact equality test would have fired on
    // the fractional one and published the full display height for that
    // frame — one paint of the strip behind the keyboard, which is how this
    // class of bug reads as "sometimes".
    expect(visibleBandHeight({
      innerHeight: 832, vvHeight: 831.6, native: { visible: true, heightPx: 310 },
    })).toBeCloseTo(522);
  });

  it("ignores a height it cannot use rather than returning a guess", () => {
    for (const heightPx of [0, -10, Number.NaN, undefined]) {
      expect(visibleBandHeight({ ...A16, native: { visible: true, heightPx } })).toBe(832);
    }
    expect(visibleBandHeight({ innerHeight: 0, vvHeight: 832, native: { visible: true, heightPx: 310 } })).toBe(832);
  });
});

describe("the A16's shape reaches the document", () => {
  // END TO END, through startKeyboardState, because the two published
  // numbers were BOTH wrong on the device and each for its own reason:
  // --app-height was the whole display (the frame did not shrink) and
  // --kb-overlay was 0 (innerHeight - vvHeight, with neither moving), which
  // told every fixed sheet to lift by nothing.
  //
  // This is the test that goes red without visibleBandHeight: 832px and 0px.
  it("publishes a shrunken frame and a full-height overlay", () => {
    const { win, get: css } = fakeWindow({ visual: 832, inner: 832 });
    const release = startKeyboardState(win);
    expect(css("--app-height")).toBe("832px");
    win.__nativeKeyboard({ visible: true, heightPx: 310 });
    expect(css("--app-height")).toBe("522px");
    expect(css("--kb-inset")).toBe("310px");
    // The layout viewport took nothing, so a fixed box at bottom 0 outside
    // the frame is underneath the whole keyboard.
    expect(css("--kb-overlay")).toBe("310px");
    win.__nativeKeyboard({ visible: false, heightPx: 0 });
    expect(css("--app-height")).toBe("832px");
    expect(css("--kb-overlay")).toBe("0px");
    release();
  });

  it("runs no heartbeat while the activity is the one answering", () => {
    // The poll exists to catch an INFERRED keyboard latching on when the
    // webview stops announcing changes. A native signal says when it
    // leaves, so a timer held for the whole time someone types buys
    // nothing — and this asserts the absence, because "it is only a
    // setInterval" is how an idle phone ends up polling forever.
    vi.useFakeTimers();
    const { win } = fakeWindow({ visual: 832, inner: 832 });
    const release = startKeyboardState(win);
    win.__nativeKeyboard({ visible: true, heightPx: 310 });
    expect(get(keyboardOpen)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    release();
    vi.useRealTimers();
  });
});

describe("the published numbers are CSS px, whatever the page is zoomed to", () => {
  // THE BUG THE ZOOM FIX LEFT BEHIND, and the device is the same one: a
  // Galaxy A34 reporting a 447px viewport at scale 1.54. The heights this
  // module compares are multiplied by the scale so a zoom cannot read as a
  // keyboard — and those multiplied numbers were then published.
  //
  // --app-height came out 688px for a 447px viewport. App.svelte and
  // ShellRoot both size their frame by it with overflow: hidden, so the band
  // sat 241px below the fold, unreachable (apply() un-scrolls the layout
  // viewport). Which is that device's own report — no tab bar, no way off the
  // page — surviving the fix written for it.
  const ZOOMED = { visual: 447, inner: 447 };

  it("publishes the viewport's own height, not the scaled one", () => {
    const { win, get } = fakeWindow(ZOOMED);
    win.visualViewport.scale = 1.54;
    win.document.documentElement.clientHeight = 447;
    const release = startKeyboardState(win);
    // 688px before this fix: 447 * 1.54.
    expect(get("--app-height")).toBe("447px");
    release();
  });

  it("publishes a keyboard's height in the same units", () => {
    // --kb-inset is read by Page.svelte and Modal.svelte to RESERVE space, so
    // an inflated one reserves a phantom half-keyboard of padding.
    const { win, get } = fakeWindow({ visual: 500, inner: 500 });
    win.visualViewport.scale = 1.5;
    win.document.documentElement.clientHeight = 500;
    const release = startKeyboardState(win);
    win.__nativeKeyboard({ visible: true, heightPx: 300 });
    // 300 dp at scale 1.5 is 200 CSS px. The activity measures in dp — the
    // unit the comparison above works in — and the CSS reads px.
    expect(get("--kb-inset")).toBe("200px");
    expect(get("--app-height")).toBe("300px");
    release();
  });

  it("leaves every number alone at scale 1, which is every other device", () => {
    // The guard against this fix becoming its own units bug: no scale, scale
    // 1, and a nonsense scale all publish the viewport as it was reported.
    for (const scale of [1, undefined, 0, Number.NaN, -2]) {
      const { win, get } = fakeWindow({ visual: 832, inner: 832 });
      win.visualViewport.scale = scale;
      const release = startKeyboardState(win);
      expect(get("--app-height")).toBe("832px");
      release();
    }
  });
});

describe("cssPx", () => {
  it("divides by the scale the comparison multiplied by", () => {
    expect(cssPx({ value: 688, scale: 1.54 })).toBeCloseTo(446.75);
    expect(cssPx({ value: 450, scale: 1.5 })).toBe(300);
  });

  it("returns the value untouched when there is no usable scale", () => {
    // Not a "nothing happens" assertion: a webview that reports no scale, or
    // reports 0, is the common case (every desktop, every test), and dividing
    // by it would publish Infinity into a CSS variable as "Infinitypx".
    for (const scale of [1, 0, -1, Number.NaN, undefined, null, "1.5"]) {
      expect(cssPx({ value: 447, scale })).toBe(447);
    }
    expect(cssPx({ value: Number.NaN, scale: 2 })).toBeNaN();
  });
});

describe("a focus event publishes AFTER the render, not inside it", () => {
  // THE DEFECT, caught by the device harness as an uncaught
  // `state_unsafe_mutation` two or three times per run, on every sheet that
  // opened over the editor: removing a focused element from the DOM
  // dispatches `focusout` SYNCHRONOUSLY, apply() ends in
  // `keyboardOpen.set(...)`, every subscriber of that store writes component
  // state when it fires, and Svelte 5 refuses a state write made while it is
  // rendering. Same family as the crash that once left an empty document
  // behind a working onboarding gate.
  //
  // Nothing in jsdom can reproduce "while Svelte is rendering", so this
  // asserts the property that makes it impossible instead: the publish does
  // not happen in the event's own turn.

  it("does not touch the store in the event's own turn", async () => {
    const { win, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = null;
    startKeyboardState(win);
    win.visualViewport.height = 400;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(false);

    win.document.activeElement = { tagName: "INPUT" };
    fire("doc", "focusin");
    // Still false: this is the assertion that goes red the moment the
    // listener publishes synchronously again.
    expect(get(keyboardOpen)).toBe(false);
    await Promise.resolve();
    expect(get(keyboardOpen)).toBe(true);
  });

  it("carries the event's own fields across the wait", async () => {
    // `relatedTarget` is meaningful only while the event is being
    // dispatched, so deferring the READ as well as the write would hand the
    // microtask an event whose answer has already moved on — and the
    // focusout-to-focisin race the fallback exists for would come back.
    const { win, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);
    win.visualViewport.height = 400;
    fire("vv", "resize");
    await Promise.resolve();
    expect(get(keyboardOpen)).toBe(true);

    // Focus is on its way to another field: activeElement is already BODY,
    // and only relatedTarget says the writer is still typing.
    win.document.activeElement = { tagName: "BODY" };
    fire("doc", "focusout", { type: "focusout", relatedTarget: { tagName: "TEXTAREA" } });
    await Promise.resolve();
    expect(get(keyboardOpen)).toBe(true);
  });

  it("still re-measures on a tap in the same turn", async () => {
    // Only the focus listeners are deferred. pointerdown cannot arrive
    // mid-render — a render is not a user gesture — and it is the unlatch
    // path for a webview that stopped announcing viewport changes, so it
    // keeps its synchronous answer.
    const { win, fire } = fakeWindow({ visual: 800, inner: 800 });
    win.document.activeElement = { tagName: "INPUT" };
    startKeyboardState(win);
    win.visualViewport.height = 400;
    fire("vv", "resize");
    expect(get(keyboardOpen)).toBe(true);

    win.visualViewport.height = 800;
    fire("doc", "pointerdown");
    expect(get(keyboardOpen)).toBe(false);
  });
});
