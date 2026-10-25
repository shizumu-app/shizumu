// keyboard-state.js — the app's ONLY visualViewport subscriber.
//
// Every keyboard-coupled behavior (sheet lift, what-shifted lift, bar
// hiding, modal padding, app-shell height) reads the state published here:
// `--kb-inset` / `--app-height` on :root and the `keyboardOpen` store.
// Before this module, four components each re-derived keyboard state from
// their own listeners and their disagreements were user-visible bugs
// (field hidden behind the keyboard; nav bar latched hidden until app
// restart). One owner, one truth.
import { writable } from "svelte/store";

export const keyboardOpen = writable(false);

/** THE RAW NUMBERS THIS MODULE DECIDED FROM, for the one surface allowed
 *  to look at them: a diagnostic readout (src/shell/ui/ViewportReadout,
 *  off in every normal build).
 *
 *  It exists because of an iOS report — with the keyboard up the writing
 *  ends behind it — that no test in this tree can settle. The shell's VR
 *  keyboard states inject iOS-SHAPED numbers and pass; what has never
 *  been observed is what a real WKWebView reports. Every other file is
 *  forbidden from reading the visual viewport (shell-rules.test.js scans
 *  for it), and a debug overlay is not a reason to make a second reader
 *  — so the reader publishes, and the overlay subscribes.
 *
 *  Inert when nothing subscribes: a store write per viewport event, which
 *  is the same cadence as the three CSS properties beside it. */
export const viewportSnapshot = writable({
  innerHeight: 0,
  vvHeight: 0,
  offsetTop: 0,
  scrollY: 0,
  appHeight: 0,
  kbInset: 0,
  kbOverlay: 0,
  vvOffsetTop: 0,
  isOpen: false,
  focused: false,
  event: "",
  native: null,
});

/** Pure decision: given the visual viewport height and the tallest height
 * seen since the last reset (baseline), how much of the viewport does the
 * keyboard cover? Threshold rejects sub-keyboard shrink (URL bars, and the
 * system bars a full-height launch frame counts that the settled window
 * does not). It was 80 until the third device pass: a baseline learned
 * tall read the settled viewport as ~80–120px shrunk, and with the editor
 * holding focus that called the keyboard open for the whole session — the
 * editor strip up where the tab bar belongs, and no way off the page. The
 * smallest phone keyboard is well over 200 CSS px, so 150 separates the
 * two with room on both sides.
 *
 * A soft keyboard cannot be open unless a text field has focus — a shrink
 * alone isn't proof (Android cold start reports a tall viewport, then a
 * transient short one while splash/insets settle, with no field focused and
 * no further resize to correct the misread). hasFocusedField gates `isOpen`;
 * `keyboardPx` still reports the measured shrink either way, since callers
 * that publish it may want the raw value.
 *
 * `native` is Android's own answer — `{visible, heightPx}` from the IME
 * window insets, or null everywhere else. When present it REPLACES the
 * inference rather than joining it; see the branch for why that is the only
 * honest arrangement on a webview whose viewport can go stale.
 */
export function computeKeyboardState({ vvHeight, baseline, minKeyboardPx = 150, healBelowPx = 160, hasFocusedField = false, native = null }) {
  // The baseline is the keyboard-DOWN height, learned as a running max —
  // and a running max cannot come back down. An edge-to-edge Android
  // window reports its full height for a frame or two at launch, before
  // the system bars' insets land; the max kept that, and the settled
  // viewport then read as ~80px "shrunk" for the life of the session,
  // right at the keyboard threshold: the phone shell showed its editor
  // strip with no keyboard up, where the tab bar belongs.
  //
  // So the baseline HEALS, under two conditions that together rule out a
  // real keyboard. No field is focused — a keyboard is open FOR a field.
  // And the excess is smaller than any keyboard (`healBelowPx`): a blur
  // to nothing can land while the IME is still on screen, and adopting
  // THAT height would poison the baseline short, after which the next
  // real keyboard measures as no shrink at all and never opens the strip.
  // System bars are tens of px; the shortest soft keyboard is ~200.
  const tallest = Math.max(baseline || 0, vvHeight);

  // THE NATIVE ANSWER IS NOT A VOTE.
  //
  // Everything below this branch infers a keyboard from arithmetic on
  // numbers the webview reports. On a Galaxy A34 those numbers froze at the
  // keyboard-up height and never came back — visualViewport.height,
  // innerHeight and documentElement.clientHeight all reading 411 on a
  // screen painting ~740, at zoom 1.00 — and no rule written over them can
  // tell that apart from a real keyboard. The readout photographed it; four
  // fixes reasoned from those numbers before it did.
  //
  // Android does not have to infer. When it has spoken, it decides, and the
  // arithmetic below is what desktop, the browser demo, iOS and every test
  // still run on (`native` is null there and nothing changes).
  //
  // NOT gated on hasFocusedField, deliberately. That gate exists because a
  // measured shrink is weak evidence — a cold start reports a transient
  // short viewport with nothing focused. An IME the system reports visible
  // is not evidence, it is the fact, and gating it would put the focusout
  // race back in by another door.
  if (native) {
    if (!native.visible) {
      // Down, and the baseline adopts the current height unconditionally.
      // That is what breaks the latch: healing could not, because it needs
      // the gap under healBelowPx (it was 294) AND nothing focused (the
      // canvas is contenteditable, so the caret always counts).
      return { keyboardPx: 0, isOpen: false, nextBaseline: vvHeight };
    }
    // Up, and the height is the one the activity measured — with no
    // fallback to the shrink, which is the trap this used to carry. That
    // fallback was written for adjustResize: the window had already been
    // pulled out of the IME region, so a native inset of 0 was plausible
    // and `tallest - vvHeight` was the real height. Android 15 ignores
    // adjustResize for an edge-to-edge app targeting SDK 35+ (this targets
    // 36), so the window never moves, `tallest - vvHeight` is 0, and the
    // fallback reported a keyboard 0px tall on the one device that needs
    // the number most. A visible IME whose height did not arrive is a
    // broken publisher, not a keyboard to guess at, so report 0 and let
    // the readout's `nat` line say so.
    //
    // Hold the tall baseline either way: healing to a keyboard-down height
    // here is the poisoning healBelowPx exists to prevent.
    const measured = Number.isFinite(native.heightPx) && native.heightPx > 0 ? native.heightPx : 0;
    return { keyboardPx: measured, isOpen: true, nextBaseline: tallest };
  }

  const excess = tallest - vvHeight;
  const heals = !hasFocusedField && excess > 0 && excess < healBelowPx;
  const nextBaseline = heals ? vvHeight : tallest;
  const raw = Math.max(0, nextBaseline - vvHeight);
  const shrunkPastThreshold = raw > minKeyboardPx;
  const isOpen = shrunkPastThreshold && hasFocusedField;
  return { keyboardPx: shrunkPastThreshold ? raw : 0, isOpen, nextBaseline };
}

/** A height that means the same thing whatever the page is zoomed to.
 *
 *  THE BUG THIS ENDS. A Galaxy A34 kept the editor strip where the tab bar
 *  belongs, with no keyboard on screen and no way off the page. For four
 *  days it looked like a stale viewport, and it was not: every measure
 *  agreed (inner 447, vv 447, client 447, html 447) while the display
 *  stayed 832. `html` is the document's own laid-out box, so the page
 *  really was 447 tall — and painting about 690px of screen, which is a
 *  page zoomed by about 1.5.
 *
 *  So the window never shrank. The page scale changed, the layout viewport
 *  shrank with it, and the baseline — learned at scale 1 — read the
 *  difference as a 310px keyboard. Multiplying by the scale puts every
 *  measurement back in the units the baseline was learned in, which is the
 *  only way a comparison across a zoom can mean anything.
 *
 *  A missing scale (older webviews) or an absurd one falls through to the
 *  plain height: zero would otherwise invent a keyboard the size of the
 *  whole window. */
export function scaledViewportHeight({ vvHeight, scale }) {
  if (!Number.isFinite(vvHeight)) return vvHeight;
  if (!Number.isFinite(scale) || scale <= 0) return vvHeight;
  return vvHeight * scale;
}

/** Which height to believe, when the three the browser offers disagree.
 *
 *  THE DEVICE CASE. A Galaxy A34, first launch after an install, every
 *  time: Android's log said the IME was hidden and the window was the full
 *  display (2340 physical, less a 75 status bar and a 135 nav bar, at
 *  density 2.8125 — 757 CSS px), while the webview answered 447 for BOTH
 *  innerHeight and visualViewport.height, and went on answering 447 when
 *  asked again on a tap. Re-measuring through those two cannot recover
 *  from that, however often it runs.
 *
 *  documentElement.clientHeight is the CSS layout viewport, maintained by
 *  the rendering side rather than the viewport API, and on that device it
 *  is the one that matches what is on screen — the app's frame filled the
 *  display instead of leaving a 310px band of nothing beneath it.
 *
 *  WHY IT IS GUARDED. On iOS the same comparison means the opposite. The
 *  layout viewport keeps its height there and the keyboard overlays the
 *  visual one, so clientHeight exceeding vvHeight is the keyboard rather
 *  than a stale reading. innerHeight separates the two shapes: under
 *  resizes-content it shrinks with the visual viewport, under
 *  resizes-visual it stays tall. So the layout viewport is preferred only
 *  when innerHeight has shrunk WITH the visual one and the layout viewport
 *  disagrees with both — which is precisely the lie, and nothing else. */
export function credibleViewportHeight({ vvHeight, innerHeight, clientHeight }) {
  if (!Number.isFinite(vvHeight)) return vvHeight;
  const layout = Number.isFinite(clientHeight) ? clientHeight : 0;
  if (layout <= vvHeight) return vvHeight;
  // resizes-visual (iOS): the layout viewport never shrank, so its height
  // says nothing about whether a keyboard is up.
  if (Number.isFinite(innerHeight) && innerHeight > vvHeight + 1) return vvHeight;
  return layout;
}

/**
 * Forget the learned baseline for this window and re-measure.
 *
 * THE ONLY OPERATION THAT CANNOT FAIL. Everything else that tries to clear a
 * stale `keyboardOpen` re-reads a number: the heartbeat, the tap-to-
 * remeasure, the focus listeners. On a webview whose viewport has frozen,
 * that number is the same wrong one every time. Zeroing the baseline ignores
 * it — `tallest` becomes the current height, the shrink becomes 0, and the
 * flag goes down whatever the viewport claims and whatever has focus.
 *
 * It was reachable only from `orientationchange` and `visibilitychange`
 * until the editor strip's exit needed it: blurring alone works through the
 * focus gate, which a contenteditable canvas can undo by taking focus
 * straight back.
 *
 * A no-op when nothing is subscribed on this window, which is every test
 * that never started the owner.
 *
 * @param {Window} [win]
 */
export function resetKeyboardBaseline(win = typeof window !== "undefined" ? window : null) {
  if (!win) return;
  subscriptions.get(win)?.reset?.();
}

/** Reads the live `--app-height` published by startKeyboardState() — the
 * visible-viewport height with the keyboard already accounted for. For code
 * that needs the raw px number in JS (menu placement, IME-aware scroll)
 * rather than a bound CSS property. Falls back to innerHeight before
 * startKeyboardState() has run its first apply(). */
export function getViewportHeight(win = typeof window !== "undefined" ? window : null) {
  if (!win || !win.document) return 0;
  const raw = getComputedStyle(win.document.documentElement).getPropertyValue("--app-height");
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : win.innerHeight || 0;
}

/** Is this the kind of element the soft keyboard is open FOR?
 *
 *  Exported because the caller below has to ask it about two different
 *  elements, and a predicate spelled twice inline is a predicate that
 *  drifts. */
export function isTextFieldElement(el) {
  return !!(el && (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable
  ));
}

/** Back from the baseline's units into the CSS px every consumer lays out in.
 *
 * THE BUG THIS ENDS, and it is the one the zoom fix left behind. The heights
 * this module compares are multiplied by the page scale (scaledViewportHeight)
 * so a zoom cannot read as a keyboard. Those same multiplied numbers were
 * then PUBLISHED: on the device that motivated the zoom fix — a 447px
 * viewport reporting scale 1.54 — `--app-height` came out 688px.
 *
 * Every consumer of that variable lays out in CSS px. App.svelte and
 * ShellRoot both size their frame by it with `overflow: hidden`, so a frame
 * 241px taller than the screen puts the bottom band below the fold with no
 * way to scroll to it (apply() also un-scrolls the layout viewport) — which
 * is the Galaxy A34's own report, no tab bar and no way off the page,
 * surviving the fix that was written for it. `--kb-inset` had the same
 * inflation, reserving half a phantom keyboard in Page and Modal.
 *
 * So the comparison keeps the scaled units and the publishing converts back.
 * At scale 1 — every device but the zoomed one, and every test that does not
 * set it — this returns its argument and nothing moves.
 */
export function cssPx({ value, scale }) {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(scale) || scale <= 0) return value;
  return value / scale;
}

/** THE HEIGHT OF THE BAND THE APP MAY DRAW IN — `--app-height`, and the
 * `vvHeight` term every other expression in this file is fed.
 *
 * Normally that is the visual viewport's height: it means "what is visible"
 * under resizes-content and resizes-visual alike, which is why one
 * expression served both platforms.
 *
 * Android 15 is a third shape, and it is the one this app ships into. For an
 * app targeting SDK 35+ the platform ENFORCES edge-to-edge and IGNORES
 * windowSoftInputMode="adjustResize" — so the IME resizes NEITHER viewport.
 * Measured on an A16, keyboard down then up: innerHeight 832 both times,
 * visualViewport.height 832 both times, a 310px keyboard on screen. Every
 * number the webview reports says there is no keyboard, which is not a lie
 * the arithmetic can catch — it is the arithmetic's input being constant.
 *
 * The consequences were all one bug: `--app-height` stayed 832, so the
 * shell's frame was full-display tall with the IME over its bottom third
 * and the editor strip behind it; and `innerHeight - vvHeight` was 0, so
 * `--kb-overlay` told the sheets to lift by nothing.
 *
 * The activity measures the IME exactly (WindowInsetsCompat.Type.ime(), via
 * scripts/patch-android-keyboard.py). Subtracting it from the layout
 * viewport gives the band the keyboard is not covering — and feeding THAT
 * in as `vvHeight` leaves every expression downstream correct unchanged,
 * rather than adding a platform branch to each of them.
 *
 * WHAT MAKES THE SUBTRACTION SAFE IS WHAT THE NUMBER MEANS, and there is no
 * guard here because a guard cannot know it. `native.heightPx` is how far the
 * IME intrudes into THIS WINDOW (scripts/patch-android-keyboard.py reports
 * `getInsets(ime())`, which is the definition of an inset). On an Android that
 * honours adjustResize the window is moved out of the IME's way, nothing
 * intrudes, the activity reports 0, and the early return below hands back the
 * already-shrunken viewport. One number, correct in both shapes.
 *
 * A GUARD WAS TRIED HERE AND WAS WRONG, which is worth keeping because the
 * reasoning is seductive. It read `if (vvHeight < innerHeight - 1) return
 * vvHeight` — "only subtract while the visual viewport still measures the full
 * layout viewport" — on the theory that a resized window would show up as a
 * disagreement between the two. It does not: under resizes-content BOTH
 * viewports shrink together, so they agree at 522/522 and the guard is false,
 * and the subtraction ran anyway. 832px display, 310px keyboard, a 212px
 * band: the frame a quarter of the way up the screen with the writing below
 * the fold. What that condition actually separates is the iOS shape, which is
 * not the case it was written for. The fix belongs where the fact lives — in
 * the activity, which knows whether its own window was moved — and the
 * matching half of it is the removal of the fallback that used to manufacture
 * a height there.
 *
 * Returns vvHeight untouched everywhere else: iOS, desktop, the browser
 * demo and every test pass `native` null and nothing here runs.
 */
export function visibleBandHeight({ innerHeight, vvHeight, native = null }) {
  if (!native || !native.visible) return vvHeight;
  // 0 IS AN ANSWER, not a missing one: it is what an adjustResize device
  // reports with the keyboard up, and its band is the viewport it already has.
  if (!Number.isFinite(native.heightPx) || native.heightPx <= 0) return vvHeight;
  if (!Number.isFinite(innerHeight) || innerHeight <= 0) return vvHeight;
  if (!Number.isFinite(vvHeight)) return vvHeight;
  return Math.max(0, innerHeight - native.heightPx);
}

/** How much of the soft keyboard the LAYOUT viewport has NOT already
 * removed — which is the only amount a `position: fixed` surface anchored
 * to the viewport bottom should lift itself by.
 *
 * `--kb-inset` is the keyboard's HEIGHT. That is the right number for a
 * flow-level box reserving space, and the wrong one for a fixed sheet,
 * because whether a fixed `bottom: 0` is already keyboard-clear depends on
 * which viewport the browser shrank:
 *
 *   resizes-content (Android, and what index.html asks for): the LAYOUT
 *     viewport shrinks, so innerHeight == visualViewport.height and
 *     `bottom: 0` already sits on top of the keyboard. Lifting by the
 *     keyboard's height moves the sheet a second keyboard off the screen.
 *   resizes-visual (iOS/WKWebView, which ignores interactive-widget): only
 *     the VISUAL viewport shrinks. innerHeight stays full, `bottom: 0` is
 *     underneath the keyboard, and the sheet must lift by the difference.
 *
 * innerHeight - visualViewport.height is 0 in the first case and the
 * keyboard's height in the second, so one expression is correct on both
 * and no surface needs to know which platform it is on.
 *
 * Written after both of this app's bottom sheets were measured entirely
 * off the top of the screen with the keyboard up: the trail sheet's box
 * at y -261..-119 in a 360px viewport with --kb-inset at 479px, its
 * max-height cap no help because the sheet's BOTTOM edge was already above
 * y=0. The scrim was still painted, so the page dimmed and there was
 * nothing on it to type into. index.html gained
 * interactive-widget=resizes-content on 2026-08-07 (74b6562d) and both
 * sheets had been written against the resizes-visual behaviour that
 * predated it.
 *
 * Gated on isOpen for the same reason --kb-inset is: a keyboard that is
 * not up is not covering anything, and a cold-start transient shrink with
 * no field focused must not nudge fixed chrome.
 *
 * `offsetTop` is the third term, added after a Samsung phone on Android 15
 * showed the frame and the sheets floating ~100px above the keyboard: under
 * resizes-visual the browser also PANS the visual viewport inside the
 * layout viewport to reveal the caret, and a viewport panned by X has its
 * bottom X lower in layout coordinates than its height alone says. What is
 * still covered below a fixed `bottom: 0` is innerHeight - (offsetTop +
 * vvHeight). Absent or zero, this is the old expression exactly.
 */
export function keyboardOverlayPx({ innerHeight, vvHeight, offsetTop = 0, isOpen }) {
  if (!isOpen) return 0;
  if (!Number.isFinite(innerHeight) || !Number.isFinite(vvHeight)) return 0;
  const pan = Number.isFinite(offsetTop) && offsetTop > 0 ? offsetTop : 0;
  return Math.max(0, innerHeight - vvHeight - pan);
}

/** How far the visual viewport has panned down inside the layout viewport,
 * which is how far a `position: fixed` frame sized to the visual viewport
 * must move down to stay on screen.
 *
 * The shell's frame is `position: fixed; top: 0; height: var(--app-height)`.
 * Fixed positioning resolves against the LAYOUT viewport. Under
 * resizes-visual (iOS always; Android when the window is edge-to-edge and
 * the IME no longer resizes it, which Android 15 enforces) the layout
 * viewport keeps its full height, the visual viewport shrinks, and the
 * browser pans the visual one to keep the caret in view. A pan of X leaves
 * the frame's top X above the screen — the header under the status bar —
 * and X of bare canvas between the frame's bottom and the keyboard. Both
 * were photographed on the same screen, and only "sometimes", because the
 * pan happens only when the caret sits low enough to need revealing.
 *
 * Published as `--vv-offset-top`; the frame reads it as its `top`. Gated on
 * isOpen like its two siblings: a pinch-zoom or an overscroll bounce moves
 * offsetTop too, and chrome that chased those would slide under a finger
 * that is not typing. Negative (iOS rubber-banding) and non-finite values
 * are 0 — NaN would serialise into the CSS var as "NaNpx".
 */
export function viewportOffsetTopPx({ offsetTop, isOpen }) {
  if (!isOpen) return 0;
  if (!Number.isFinite(offsetTop) || offsetTop <= 0) return 0;
  return offsetTop;
}

/** How often an open keyboard is re-checked. A second is slow enough to be
 *  invisible on a battery graph and fast enough that a user reaching for
 *  the tab bar finds it there. */
const KEYBOARD_RECHECK_MS = 1000;

/** The live subscription per window, so a second caller joins the first.
 *
 *  This module has always described itself as the app's only
 *  visualViewport subscriber, and on the desktop tree it was: App.svelte
 *  runs `syncAppHeight()` (this function, re-exported by
 *  viewport-height.js) and nothing else called it. The phone shell broke
 *  that quietly — ShellRoot.svelte calls startKeyboardState() on mount, so
 *  both are live, each with its own `baseline` in its own closure, both
 *  writing --kb-inset, --app-height and the shared keyboardOpen store.
 *
 *  Two baselines are two beliefs about the keyboard, and the last writer
 *  per event decides what the app shows: the published state then depends
 *  on listener order rather than on the viewport. The recheck timer made
 *  it worse, since whichever instance is wrong re-asserts itself every
 *  second.
 *
 *  Keyed by window rather than a module-level single, so a test's fake
 *  window never inherits another test's subscription — and weakly, so a
 *  closed window takes its entry with it. */
const subscriptions = new WeakMap();

export function startKeyboardState(win = typeof window !== "undefined" ? window : null) {
  if (!win || !win.document) return () => {};

  // Someone is already listening on this window: take a share of it. The
  // apply() below would compute the same answer anyway; what must not
  // happen is a second set of listeners, a second baseline, and a second
  // heartbeat racing the first.
  const live = subscriptions.get(win);
  if (live) {
    live.count += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      live.count -= 1;
      if (live.count === 0) {
        subscriptions.delete(win);
        live.stop();
      }
    };
  }
  const root = win.document.documentElement;
  let baseline = 0;

  // ── Android's own answer ────────────────────────────────────────────
  //
  // `baseline` is an inference and it can be poisoned; this is a fact and
  // it cannot. The activity publishes IME visibility here through
  // scripts/patch-android-keyboard.py — see that script for the Kotlin and
  // for why the value is read from the window's unconsumed insets.
  //
  // THE STASH MATTERS. wry calls onWebViewCreate from setWebView(), which
  // runs BEFORE loadUrl — so the first value can land before the document
  // exists, never mind before this module runs. The activity writes
  // `__nativeKeyboardState` as well as calling, and this adopts whatever
  // is already there.
  let native = null;
  const onNative = (state) => {
    if (!state || typeof state !== "object") return;
    native = {
      visible: !!state.visible,
      heightPx: Number.isFinite(state.heightPx) ? state.heightPx : 0,
    };
    apply({ type: "native" });
  };

  const apply = (event) => {
    // Not the raw visual viewport: see credibleViewportHeight for the
    // device that answers a stale number to both viewport questions and
    // keeps answering it.
    // Measured in scale-independent units, or a zoom reads as a keyboard —
    // see scaledViewportHeight for the device that proved it.
    const scale = win.visualViewport?.scale;
    const unzoom = (height) => scaledViewportHeight({ vvHeight: height, scale });
    const vvHeight = credibleViewportHeight({
      vvHeight: unzoom(win.visualViewport?.height ?? win.innerHeight),
      innerHeight: unzoom(win.innerHeight),
      clientHeight: unzoom(win.document?.documentElement?.clientHeight),
    });
    if (!vvHeight) return;
    // Guarded (not just `win.document.activeElement`) because this also
    // runs under the fake-window test harness, where document/activeElement
    // may be absent or null.
    const active = win.document && win.document.activeElement;
    // On focusout the browser has ALREADY moved activeElement to BODY, so
    // asking it alone answers "nothing is focused" even when focus is on
    // its way to another field. That published keyboardOpen false and
    // --kb-inset 0 for one paint: the phone header un-collapsed and the
    // page's bottom padding grew, mid-tap. Touch fires
    // blur -> mouseup -> click with a real gap between them (see
    // editor/touch-reveal-dismiss.js, which is a history of exactly this),
    // so that reflow lands BETWEEN the tap and the click and the control
    // moves out from under the finger.
    //
    // relatedTarget is where focus is GOING. Null on a genuine blur to
    // nothing, which is the case that should close the keyboard, so the
    // fallback to activeElement stays correct.
    const incoming = event && event.type === "focusout" ? event.relatedTarget : null;
    const isTextField = isTextFieldElement(incoming) || isTextFieldElement(active);
    const s = computeKeyboardState({ vvHeight, baseline, hasFocusedField: isTextField, native });
    baseline = s.nextBaseline;
    // THE ONE CORRECTION, APPLIED ONCE. See visibleBandHeight: on a webview
    // whose viewports do not move for the IME, this is the only number that
    // knows the keyboard is there, and every expression below is fed it in
    // place of the viewport's own answer. `vvHeight` stays raw from here on
    // only in the snapshot, where the readout's job is to show what the
    // webview actually said.
    const band = visibleBandHeight({ innerHeight: unzoom(win.innerHeight), vvHeight, native });
    // AND BACK INTO CSS PX FOR EVERYTHING PUBLISHED. See cssPx: the heights
    // above are in the baseline's scaled units, and every consumer of these
    // variables lays out in CSS px. `innerHeight` is unzoomed on the line
    // above for the same reason the band is — visibleBandHeight compares the
    // two, so they have to be in one unit.
    const toCss = (value) => cssPx({ value, scale });
    const bandCss = toCss(band);
    const kbInset = toCss(s.isOpen ? s.keyboardPx : 0);
    // A keyboard that isn't open isn't covering anything — publish 0 rather
    // than the raw measured shrink so BottomSheet/Modal/Page don't reserve
    // space for a keyboard that (per isOpen, above) isn't actually up. This
    // is also what keeps a cold-start transient shrink from nudging fixed
    // chrome before any field is ever focused.
    root.style.setProperty("--kb-inset", `${Math.round(kbInset)}px`);
    // The fixed-surface counterpart to --kb-inset above. See
    // keyboardOverlayPx: this is 0 under resizes-content and the keyboard's
    // height under resizes-visual, so a fixed sheet reads THIS and stays
    // correct on both. --kb-inset keeps its meaning for the flow-level
    // consumers (Page.svelte, Modal.svelte) that reserve space by it.
    const offsetTop = win.visualViewport?.offsetTop;
    const kbOverlay = keyboardOverlayPx({
      // CSS px on both sides of the subtraction: innerHeight as the browser
      // reports it, and the band converted back from the comparison's units.
      innerHeight: win.innerHeight,
      vvHeight: bandCss,
      offsetTop,
      isOpen: s.isOpen,
    });
    root.style.setProperty("--kb-overlay", `${Math.round(kbOverlay)}px`);
    // Where the visible band STARTS, for a fixed frame sized to it — see
    // viewportOffsetTopPx. The vv "scroll" listener below is what delivers
    // a pan that arrives without a resize.
    root.style.setProperty(
      "--vv-offset-top",
      `${Math.round(viewportOffsetTopPx({ offsetTop, isOpen: s.isOpen }))}px`,
    );
    root.style.setProperty("--app-height", `${Math.round(bandCss)}px`);
    keyboardOpen.set(s.isOpen);
    // What it all came from, for the readout — see viewportSnapshot.
    viewportSnapshot.set({
      innerHeight: Math.round(win.innerHeight || 0),
      vvHeight: Math.round(vvHeight),
      offsetTop: Math.round(Number.isFinite(offsetTop) ? offsetTop : 0),
      scrollY: Math.round(win.scrollY || 0),
      appHeight: Math.round(bandCss),
      kbInset: Math.round(kbInset),
      kbOverlay: Math.round(kbOverlay),
      vvOffsetTop: Math.round(viewportOffsetTopPx({ offsetTop, isOpen: s.isOpen })),
      isOpen: s.isOpen,
      focused: isTextField,
      event: event?.type ?? "apply",
      // ── the numbers that are only here to be read on a device ────────
      //
      // Three fixes have now failed to clear a latched bar on a Galaxy
      // A34, each one reasoning from a screenshot about which viewport
      // number lies. These four put the question on screen: clientHeight
      // is the CSS layout viewport, the <html> box is what layout
      // actually produced, screen.availHeight is the display minus the
      // system bars and never moves with a keyboard, and outerHeight is
      // the window as the browser sees it. Whichever of them reads 705
      // while vv reads 411 is the one worth believing — and if all of
      // them read 411 while the app plainly fills the screen, then no
      // number inside this webview can be trusted and the fix has to come
      // from the native side.
      clientHeight: Math.round(win.document?.documentElement?.clientHeight || 0),
      htmlBox: Math.round(
        win.document?.documentElement?.getBoundingClientRect?.().height || 0,
      ),
      availHeight: Math.round(win.screen?.availHeight || 0),
      outerHeight: Math.round(win.outerHeight || 0),
      // The number that explained all of it: a page zoom the baseline knew
      // nothing about. On the readout so a device says so directly, rather
      // than being inferred from how large the text looks in a screenshot.
      scale: Number.isFinite(win.visualViewport?.scale) ? win.visualViewport.scale : 1,
      // Whether the arithmetic above was consulted at all. On the readout
      // as `nat`: a dash means the activity never spoke, which is the
      // whole diagnosis for a build where the Kotlin half did not land —
      // and no amount of reasoning in here would have found it.
      native,
    });
    // THE HEARTBEAT. See its definition below: held only while the shell
    // believes a keyboard is up, so an idle page runs no timer at all —
    // and only while the belief is the app's own. The poll exists because a
    // webview can stop announcing viewport changes and leave an INFERRED
    // keyboard latched on. An IME the activity reports is not inferred: it
    // arrives from two Kotlin triggers and it says when it leaves, so there
    // is nothing for a timer to catch and no reason to hold one open for
    // the whole time someone is typing.
    if (s.isOpen && !native) startHeartbeat(); else stopHeartbeat();
    // Under resizes-visual the browser scrolls the layout viewport to keep
    // a focused field visible; the shell is exactly the visible height, so
    // any offset is the shell dragged out from under the user — put it back.
    // EXCEPT while a text field has focus: that scroll is the browser
    // legitimately revealing the field the user is typing into, and it
    // fires a whole stream of vv resize/scroll events while Android
    // animates the IME open. Yanking scrollY back to 0 on each of those
    // fights the animation and can drop focus mid-type (the trail sheet's
    // "keyboard appears then collapses" bug) — so defer to the focused
    // field instead of fighting it.
    if (win.scrollY && !isTextField) win.scrollTo(0, 0);
  };

  // Rotation and app-resume invalidate the learned baseline — the next
  // apply() re-learns it from the current height, so a stale tall
  // baseline can never hold `keyboardOpen` true (the latched-bar bug).
  //
  // It deliberately does NOT clear `native`: this zeroes an inference, and
  // the native signal is not one.
  const reset = () => { baseline = 0; apply(); };

  // ── the heartbeat ──────────────────────────────────────────────────────
  //
  // Every listener below assumes the webview announces viewport changes. On
  // a Galaxy A34 it does not: on the first launch after an install, the
  // keyboard goes away and nothing fires — no resize, no scroll, no focus
  // change — leaving `keyboardOpen` true for the rest of the session. The
  // consequence is not subtle, because the bottom slot and the nav both key
  // off that flag: no tab bar, no trail row, no way to add a page, and a
  // trail name whose control is not on screen to be tapped. The reporter's
  // response was to close the app, which is the only thing that cleared it.
  //
  // The pointerdown listener below recovers from that, but only once the
  // user touches something — and someone who cannot find the tab bar has no
  // reason to believe tapping will bring it back. So while the belief is
  // held, it is checked: one read of two numbers the browser already has,
  // once a second. With the keyboard down there is no timer, which the
  // tests assert rather than assume.
  //
  // Not a replacement for the events. They are faster and they carry the
  // pan (offsetTop) that a poll would only sample. This exists for the one
  // case they do not cover: silence.
  let heartbeat = null;
  const startHeartbeat = () => {
    if (heartbeat === null) heartbeat = setInterval(apply, KEYBOARD_RECHECK_MS);
  };
  const stopHeartbeat = () => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  const onVisibility = () => { if (win.document.visibilityState === "visible") reset(); };

  if (win.__nativeKeyboardState) onNative(win.__nativeKeyboardState);
  win.__nativeKeyboard = onNative;

  apply();
  const vv = win.visualViewport;
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  win.addEventListener("resize", apply);
  win.addEventListener("orientationchange", reset);
  win.document.addEventListener("visibilitychange", onVisibility);
  // isOpen now depends on focus as well as viewport height (see
  // computeKeyboardState) — focus can change with no accompanying vv
  // resize/scroll event (e.g. blurring a field without the keyboard
  // animating away), so re-run apply() on focus changes too, or the flag
  // goes stale until the next unrelated viewport event.
  //
  // AND THEY PUBLISH AFTER THE RENDER, not inside it. A focus event is the
  // one input to this module that can arrive in the middle of a Svelte
  // render: removing a focused element from the DOM dispatches `focusout`
  // SYNCHRONOUSLY, which is what a sheet opening over the editor does every
  // time. apply() ends in `keyboardOpen.set(...)`, every subscriber of that
  // store writes component state when it fires, and Svelte 5 refuses a state
  // write made while it is rendering — so the app threw
  // `state_unsafe_mutation` two or three times per device run, on every
  // sheet. Same family as the crash that once left an empty document behind
  // a working onboarding gate.
  //
  // The EVENT's own fields are read first and carried over, because
  // `relatedTarget` is only meaningful while the event is being dispatched;
  // deferring the whole read would hand the microtask an event whose answer
  // has already moved on. What is deferred is the publishing, by one
  // microtask — after the flush, before the next paint, so nothing a writer
  // can see arrives late.
  const applyAfterRender = (event) => {
    const carried = { type: event?.type, relatedTarget: event?.relatedTarget ?? null };
    queueMicrotask(() => apply(carried));
  };
  win.document.addEventListener("focusin", applyAfterRender);
  win.document.addEventListener("focusout", applyAfterRender);
  // A TAP RE-MEASURES, because a keyboard can leave without saying so.
  //
  // Everything above assumes the webview reports viewport changes. A Galaxy
  // A34 running the phone shell showed that it does not always: after the
  // trail sheet closed, the on-screen readout sat at `inner 447 vv 447 ...
  // inset 310 ... kb up field yes` while the window on screen had already
  // grown back to its full height. No resize, no scroll, no focus change —
  // so apply() was simply never called again, and `keyboardOpen` stayed
  // true for the rest of the session. That left the editor strip where the
  // tab bar belongs (toolbar-model.js) and the nav collapsed
  // (nav-collapse.js), which is to say: no way off the page, no way to add
  // a page, and a trail name that does nothing. Only an app restart cleared
  // it, which is exactly how it was reported.
  //
  // No rule inside computeKeyboardState could have helped, because the
  // function was never reached. The fix is another trigger, and the
  // cheapest honest one is the user's own next touch: finding the bar
  // stuck, they tap it. That costs one read of numbers the browser already
  // has, and it happens at the moment correctness is wanted most.
  //
  // Capture phase and passive: this must not depend on anything downstream
  // calling stopPropagation, and it never calls preventDefault. When the
  // keyboard really is up, re-measuring finds the same shrink and changes
  // nothing — the test for that sits beside the one for this bug.
  win.document.addEventListener("pointerdown", apply, { capture: true, passive: true });
  // The real teardown, run once the last share is released.
  const stop = () => {
    vv?.removeEventListener("resize", apply);
    vv?.removeEventListener("scroll", apply);
    win.removeEventListener("resize", apply);
    win.removeEventListener("orientationchange", reset);
    win.document.removeEventListener("visibilitychange", onVisibility);
    win.document.removeEventListener("focusin", applyAfterRender);
    win.document.removeEventListener("focusout", applyAfterRender);
    win.document.removeEventListener("pointerdown", apply, { capture: true });
    if (win.__nativeKeyboard === onNative) delete win.__nativeKeyboard;
    stopHeartbeat();
  };

  const record = { count: 1, stop, reset };
  subscriptions.set(win, record);

  let released = false;
  return () => {
    // Idempotent: svelte can run a cleanup more than once across a
    // remount, and a double release would otherwise drop the count below
    // the number of live callers and deafen the app mid-session.
    if (released) return;
    released = true;
    record.count -= 1;
    if (record.count === 0) {
      subscriptions.delete(win);
      stop();
    }
  };
}
