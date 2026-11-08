// Where the system bars are, on a platform that will not say in CSS.
//
// THE BUG: on a Galaxy A16 the shell's bottom row sat in the same strip as
// Android's own navigation buttons. Measured: the webview's viewport is
// 832 CSS px at 2.8125x = 2340 physical, which is the WHOLE display —
// status bar and navigation bar included.
//
// WHY, AND WHY THE EXISTING PATCH DOES NOT HELP. scripts/patch-android-
// insets.py removes the generated activity's `enableEdgeToEdge()` call so
// the system fits the window and the app does not draw under the bars. That
// worked until `targetSdk` reached 35: Android 15 ENFORCES edge-to-edge for
// apps targeting 35 and above, and this app targets 36. The call is gone and
// the behaviour is back anyway.
//
// So the app draws edge to edge, and the second half of that bargain —
// knowing how tall the bars are — has to come from somewhere. It does not
// come from CSS: an Android WebView does not translate window insets into
// `env(safe-area-inset-*)`, which is why `--safe-bottom` reads 0 there while
// it is correct on iOS. patch-android-insets.py's own docstring names the
// fix: a window-insets listener in the activity that publishes the measured
// values. scripts/patch-android-keyboard.py already installs that listener
// for the IME; this is the other thing it can see.
//
// WHAT THIS FILE IS. The arithmetic, as a pure function, plus the receiver
// that applies it. global.css keeps its `env()` definitions and stays the
// only place that reads them — this overrides the variables at the root the
// same way keyboard-state.js overrides `--app-height`, so every surface goes
// on reading `var(--safe-bottom)` and none of them learns a second rule.
import { writable } from "svelte/store";

/** What the activity last reported, for the diagnostic readout. Null until
 *  something publishes, which on iOS and desktop is never. */
export const nativeInsets = writable(null);

/**
 * The CSS the root should carry for a set of native insets.
 *
 * Returns only the sides that were measured, so a platform that reports
 * nothing changes nothing and the `env()` fallback in global.css keeps
 * answering — which is what iOS needs, where `env()` is correct and this
 * never runs.
 *
 * @param {{top?: number, bottom?: number, left?: number, right?: number}|null} insets
 *   dp, as the activity reports them
 * @returns {Record<string, string>} CSS custom properties to set on :root
 */
export function safeAreaStyle(insets) {
  if (!insets || typeof insets !== "object") return {};
  const out = {};
  for (const [side, name] of [
    ["top", "--safe-top"],
    ["bottom", "--safe-bottom"],
    ["left", "--safe-left"],
    ["right", "--safe-right"],
  ]) {
    const value = insets[side];
    // A missing side is not a zero one. `0` is a real answer — a phone with
    // gesture navigation and no bar to clear — and must be applied, or the
    // CSS fallback keeps a guess alive underneath it. `undefined` is "not
    // measured" and is left alone.
    if (!Number.isFinite(value) || value < 0) continue;
    out[name] = `${Math.round(value)}px`;
  }
  return out;
}

/** Session storage key for the last insets the activity told this session. */
const KEPT = "shizumu:native-insets";

/**
 * Listen for the activity's window insets and publish them.
 *
 * Mirrors keyboard-state.js's shape: one owner, a stash for values that
 * arrive before this module does (wry calls onWebViewCreate before loadUrl),
 * and an idempotent release.
 *
 * @param {Window} [win]
 * @returns {() => void} release
 */
export function startSafeArea(win = typeof window !== "undefined" ? window : null) {
  if (!win || !win.document) return () => {};
  const root = win.document.documentElement;

  const apply = (insets) => {
    if (!insets || typeof insets !== "object") return;
    const style = safeAreaStyle(insets);
    for (const [name, value] of Object.entries(style)) root.style.setProperty(name, value);
    nativeInsets.set({ ...insets });
    try { win.sessionStorage?.setItem(KEPT, JSON.stringify(insets)); } catch {}
  };

  // The activity tells each page once, keyed by URL, and location.reload()
  // keeps the URL, so a reloaded page is never told (the startup lock
  // screen's unlock reloads; A16, 2026-11-08). The same activity's bars do
  // not move across a reload, so the last insets told to this session stand
  // in until the activity speaks again. Its own stash, when there is one,
  // wins.
  let kept = null;
  try { kept = JSON.parse(win.sessionStorage?.getItem(KEPT) || "null"); } catch {}
  if (win.__nativeInsetsState) apply(win.__nativeInsetsState);
  else if (kept) apply(kept);
  win.__nativeInsets = apply;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (win.__nativeInsets === apply) delete win.__nativeInsets;
  };
}
