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

/** Pure decision: given the visual viewport height and the tallest height
 * seen since the last reset (baseline), how much of the viewport does the
 * keyboard cover? Threshold rejects sub-keyboard shrink (URL bars).
 *
 * A soft keyboard cannot be open unless a text field has focus — a shrink
 * alone isn't proof (Android cold start reports a tall viewport, then a
 * transient short one while splash/insets settle, with no field focused and
 * no further resize to correct the misread). hasFocusedField gates `isOpen`;
 * `keyboardPx` still reports the measured shrink either way, since callers
 * that publish it may want the raw value.
 */
export function computeKeyboardState({ vvHeight, baseline, minKeyboardPx = 80, hasFocusedField = false }) {
  const nextBaseline = Math.max(baseline || 0, vvHeight);
  const raw = Math.max(0, nextBaseline - vvHeight);
  const shrunkPastThreshold = raw > minKeyboardPx;
  const isOpen = shrunkPastThreshold && hasFocusedField;
  return { keyboardPx: shrunkPastThreshold ? raw : 0, isOpen, nextBaseline };
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
 */
export function keyboardOverlayPx({ innerHeight, vvHeight, isOpen }) {
  if (!isOpen) return 0;
  if (!Number.isFinite(innerHeight) || !Number.isFinite(vvHeight)) return 0;
  return Math.max(0, innerHeight - vvHeight);
}

export function startKeyboardState(win = typeof window !== "undefined" ? window : null) {
  if (!win || !win.document) return () => {};
  const root = win.document.documentElement;
  let baseline = 0;

  const apply = (event) => {
    const vvHeight = win.visualViewport?.height ?? win.innerHeight;
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
    const s = computeKeyboardState({ vvHeight, baseline, hasFocusedField: isTextField });
    baseline = s.nextBaseline;
    // A keyboard that isn't open isn't covering anything — publish 0 rather
    // than the raw measured shrink so BottomSheet/Modal/Page don't reserve
    // space for a keyboard that (per isOpen, above) isn't actually up. This
    // is also what keeps a cold-start transient shrink from nudging fixed
    // chrome before any field is ever focused.
    root.style.setProperty("--kb-inset", `${Math.round(s.isOpen ? s.keyboardPx : 0)}px`);
    // The fixed-surface counterpart to --kb-inset above. See
    // keyboardOverlayPx: this is 0 under resizes-content and the keyboard's
    // height under resizes-visual, so a fixed sheet reads THIS and stays
    // correct on both. --kb-inset keeps its meaning for the flow-level
    // consumers (Page.svelte, Modal.svelte) that reserve space by it.
    root.style.setProperty(
      "--kb-overlay",
      `${Math.round(keyboardOverlayPx({ innerHeight: win.innerHeight, vvHeight, isOpen: s.isOpen }))}px`,
    );
    root.style.setProperty("--app-height", `${Math.round(vvHeight)}px`);
    keyboardOpen.set(s.isOpen);
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
  const reset = () => { baseline = 0; apply(); };
  const onVisibility = () => { if (win.document.visibilityState === "visible") reset(); };

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
  win.document.addEventListener("focusin", apply);
  win.document.addEventListener("focusout", apply);
  return () => {
    vv?.removeEventListener("resize", apply);
    vv?.removeEventListener("scroll", apply);
    win.removeEventListener("resize", apply);
    win.removeEventListener("orientationchange", reset);
    win.document.removeEventListener("visibilitychange", onVisibility);
    win.document.removeEventListener("focusin", apply);
    win.document.removeEventListener("focusout", apply);
  };
}
