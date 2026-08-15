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

export function startKeyboardState(win = typeof window !== "undefined" ? window : null) {
  if (!win || !win.document) return () => {};
  const root = win.document.documentElement;
  let baseline = 0;

  const apply = () => {
    const vvHeight = win.visualViewport?.height ?? win.innerHeight;
    if (!vvHeight) return;
    // Guarded (not just `win.document.activeElement`) because this also
    // runs under the fake-window test harness, where document/activeElement
    // may be absent or null.
    const active = win.document && win.document.activeElement;
    const isTextField = !!(active && (
      active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable
    ));
    const s = computeKeyboardState({ vvHeight, baseline, hasFocusedField: isTextField });
    baseline = s.nextBaseline;
    // A keyboard that isn't open isn't covering anything — publish 0 rather
    // than the raw measured shrink so BottomSheet/Modal/Page don't reserve
    // space for a keyboard that (per isOpen, above) isn't actually up. This
    // is also what keeps a cold-start transient shrink from nudging fixed
    // chrome before any field is ever focused.
    root.style.setProperty("--kb-inset", `${Math.round(s.isOpen ? s.keyboardPx : 0)}px`);
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
