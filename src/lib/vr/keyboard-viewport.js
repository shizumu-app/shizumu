// The soft keyboard, in the two shapes a browser reports it — and what the
// VR harness has to do to produce each one.
//
// WHY THIS EXISTS. Every keyboard state in tests/vr/states.js raises the
// keyboard the same way: `page.setViewportSize({ height: 360 })`. That is
// Android's shape and it is the right shape for the Android projects,
// because index.html asks for `interactive-widget=resizes-content`, so the
// IME shrinks the LAYOUT viewport and `window.innerHeight` falls together
// with the visual viewport's height. Measured on this host before this
// module was written: on chromium, setViewportSize moved innerHeight and
// the visual viewport's height together and kept them within a pixel of
// each other, both before and after (1996/1995.7, then 857/856.3 — a bare
// page with no viewport meta, so those are not the app's own numbers and
// only the tracking is the finding). Moving together is exactly
// resizes-content, which is why the technique is faithful there.
//
// A NOTE ON THE WORDING, because it looks like an oversight and is not.
// The browser API this module is entirely about is never named by its own
// identifier anywhere in this file: single-viewport-owner.test.js scans
// every .js and .svelte under src/ as plain text and allows that name in
// keyboard-state.js and nowhere else. The scan is dumb on purpose — the
// rule it guards is "one subscriber, ever", and any cleverer matcher would
// let a second one through spelled slightly differently. This module is
// arithmetic and touches no window at all, so the way to respect the rule
// rather than to carve an exception into it is to write the thing in
// words. tests/vr/states.js is outside src/ and names it freely; that is
// where the seam actually lives, and where a grep for it should land.
//
// iOS/WKWebView ignores `interactive-widget` and does the other thing:
// only the VISUAL viewport shrinks. `innerHeight` stays the full device
// height, so a `position: fixed; bottom: 0` surface is left UNDER the
// keyboard and has to lift itself by the difference — which is what
// `--kb-overlay` (keyboardOverlayPx, keyboard-state.js) is for. That
// branch of the arithmetic has unit tests and, until this module, had
// never been photographed on any engine: it is 0 in every capture the
// suite holds.
//
// The numbers here are written out rather than imported from
// keyboard-state.js, for the reason states.js gives about captions:
// a caption derived from the thing it describes cannot disagree with it.
// keyboardOverlayPx computes `innerHeight - vvHeight`; `kbOverlay` below
// says what that must COME TO in each mode. Two independent statements of
// one rule is the only arrangement in which either can catch the other.
//
// WHAT IS STILL DEVICE-ONLY. This module says which numbers iOS reports.
// It cannot make an engine report them: no Playwright API moves the visual
// viewport independently of the layout one, so the harness has to shadow
// the visual viewport's height itself (raiseKeyboard, tests/vr/states.js),
// and that is a seam, not real input. What the seam buys is the app's own
// arithmetic, CSS and layout running on WebKit against iOS-shaped numbers;
// what it cannot buy is proof that WKWebView reports those numbers, which
// is the §5 flag that stays on the device pass.

/**
 * The two `interactive-widget` behaviours, by the names the CSSOM spec and
 * this codebase's comments both use.
 */
export const WIDGET_MODE = {
  /** Android below API 35, and what index.html asks for: the layout
   *  viewport shrinks. */
  RESIZES_CONTENT: "resizes-content",
  /** iOS/WKWebView, which ignores the meta: only the visual viewport does. */
  RESIZES_VISUAL: "resizes-visual",
  /** ANDROID 15 AND ABOVE, which is where this app actually ships, and
   *  neither of the two above.
   *
   *  The platform enforces edge-to-edge for apps targeting SDK 35+ (this
   *  targets 36) and does not resize an edge-to-edge window for the IME, so
   *  `windowSoftInputMode="adjustResize"` and
   *  `interactive-widget=resizes-content` are both set and both ignored.
   *  NEITHER viewport moves: measured on an A16, innerHeight 832 and the
   *  visual viewport's height 832 with the keyboard down AND with a 310px
   *  keyboard up. (Named in prose rather than by its API, because the
   *  single-owner scan over this tree is a plain substring match and this
   *  module's own header says it may not write the identifier.)
   *
   *  The keyboard's height arrives from the activity instead
   *  (scripts/patch-android-keyboard.py publishes Type.ime()), and
   *  keyboard-state.js subtracts it from the layout viewport
   *  (visibleBandHeight) to get the band. Every capture in this suite was
   *  produced by resizing a viewport, which is the one thing the device does
   *  not do — so until this mode existed, no VR state could photograph the
   *  shape the app ships into, and both numbers the shell lays out from
   *  (`--app-height`, `--kb-overlay`) were wrong on the device while every
   *  keyboard baseline was green. */
  NATIVE_IME: "native-ime",
};

// computeKeyboardState's own `minKeyboardPx` default. Written out rather
// than imported for the reason in the header: a fixture that asked for a
// keyboard at or under this threshold would publish `--kb-inset: 0px` and
// `--kb-overlay: 0px`, and every assertion built on it would be trivially
// satisfied by an app that had never noticed a keyboard at all. That is the
// vacuous pass TRAIL_SHEET_KEYBOARD's `fieldFocused` guard exists to
// prevent, arriving through the other door.
const MIN_KEYBOARD_PX = 150;

/**
 * The viewport a soft keyboard of `keyboardPx` leaves behind on a device
 * `deviceHeight` tall, in `mode` — and what the harness must do to get it.
 *
 * Returns:
 *   innerHeight            what `window.innerHeight` must read
 *   vvHeight               what the visual viewport's height must read
 *   vvOffsetTop            what the visual viewport's offset must read
 *   kbInset                what `--kb-inset` must become (the keyboard's height)
 *   kbOverlay              what `--kb-overlay` must become
 *   visibleBottom          the lowest y the user can see, in layout-viewport px
 *   resizeTo               a viewport height to set, or null
 *   overrideVisualHeight   a visual-viewport height to shadow, or null
 *
 * `resizeTo` and `overrideVisualHeight` are the load-bearing pair, and they
 * are why this is a module rather than two numbers inline in a driver.
 * Under resizes-visual the harness must NOT resize the layout viewport:
 * doing so would put `innerHeight` back in step with the visual viewport and
 * silently turn the iOS fixture back into the Android one — a capture
 * filed under "ios" that photographs Android's numbers, which is the P1c
 * failure (fourteen baselines passing every check while showing the wrong
 * tree) with a different subject. Exactly one of the two is non-null in
 * each mode, and the driver asserts what it got afterwards.
 *
 * `vvOffsetTop` is 0 in both modes, and that is a claim about the fixture
 * rather than about iOS. A real WKWebView scrolls the layout viewport to
 * reveal a focused field, which moves the visual viewport's offset — but
 * the shell is exactly `--app-height` tall (ShellRoot's `.shell-root`), so
 * there is nothing under it to scroll to, and keyboard-state.js's apply()
 * defers to a focused field rather than yanking scrollY back. A device
 * that scrolls it anyway is one of the things only the device pass can
 * show; the arithmetic below is written to take an offset so that a future
 * fixture which can produce one does not have to re-derive the band.
 */
export function keyboardFixture({ mode, deviceHeight, keyboardPx }) {
  const MODES = [WIDGET_MODE.RESIZES_CONTENT, WIDGET_MODE.RESIZES_VISUAL, WIDGET_MODE.NATIVE_IME];
  if (!MODES.includes(mode)) {
    throw new Error(
      `keyboardFixture: unknown widget mode "${mode}" — expected one of ` +
      MODES.map((m) => `"${m}"`).join(", "),
    );
  }
  if (!Number.isFinite(deviceHeight) || deviceHeight <= 0) {
    throw new Error(`keyboardFixture: deviceHeight must be a positive number, got ${deviceHeight}`);
  }
  if (!Number.isFinite(keyboardPx) || keyboardPx <= MIN_KEYBOARD_PX) {
    throw new Error(
      `keyboardFixture: a ${keyboardPx}px keyboard is at or under computeKeyboardState's ` +
      `${MIN_KEYBOARD_PX}px threshold, so the app would publish no keyboard at all and the ` +
      "fixture would assert nothing",
    );
  }
  if (keyboardPx >= deviceHeight) {
    throw new Error(
      `keyboardFixture: a ${keyboardPx}px keyboard on a ${deviceHeight}px device leaves ` +
      "nothing visible — there would be no band to photograph",
    );
  }

  const visible = deviceHeight - keyboardPx;
  const visual = mode === WIDGET_MODE.RESIZES_VISUAL;
  const nativeIme = mode === WIDGET_MODE.NATIVE_IME;
  return {
    mode,
    deviceHeight,
    keyboardPx,
    // WHICH VIEWPORTS MOVED, which is the source of every other difference
    // below. resizes-content moves both; resizes-visual moves the visual
    // one; native-ime moves NEITHER, and the height comes from the activity.
    innerHeight: visual || nativeIme ? deviceHeight : visible,
    vvHeight: nativeIme ? deviceHeight : visible,
    vvOffsetTop: 0,
    // What the activity must publish, or null where there is no activity.
    // This is the whole of native-ime's input: the harness sets no viewport
    // size and shadows no height, it hands the app the number a phone would.
    nativeKeyboard: nativeIme ? { visible: true, heightPx: keyboardPx } : null,
    // What `--app-height` must become. Equal to vvHeight in the first two
    // modes, which is why it never needed stating before — and NOT equal to
    // it under native-ime, which is the bug this mode exists to catch: the
    // frame stayed full-display tall with the keyboard over its lower third.
    appHeight: visible,
    kbInset: keyboardPx,
    // 0 under resizes-content because `bottom: 0` is already keyboard-clear
    // there, and lifting by anything subtracts the same keyboard twice —
    // the defect that put both of this app's bottom sheets off the top of
    // the display (y -261..-119 in a 360px viewport). The full height under
    // the other two, for opposite reasons that come to the same number: the
    // layout viewport took nothing off the bottom, so a fixed surface
    // anchored there is under the whole keyboard.
    kbOverlay: visual || nativeIme ? keyboardPx : 0,
    visibleBottom: visible,
    resizeTo: visual || nativeIme ? null : visible,
    overrideVisualHeight: visual ? visible : null,
  };
}

/**
 * The rectangle of the LAYOUT viewport the user can actually see.
 *
 * This is the reader `assertSheetShape` in tests/vr/states.js now judges a
 * sheet's bottom edge with, and it replaced one that could not see the iOS
 * failure at all: `sheet.bottom > sheet.viewport`, with `viewport` read as
 * `window.innerHeight`. That is correct under resizes-content — where
 * innerHeight IS the visible height — and vacuous under resizes-visual,
 * where innerHeight is the full device and a sheet sitting flat on it is a
 * sheet entirely behind the keyboard. A check that cannot fail on the bug
 * it is written for is the "nothing happens" assertion in another costume.
 *
 * One expression, correct in both modes, for keyboardOverlayPx's reason:
 * under resizes-content the visual viewport equals the layout one and the
 * offset is 0, so this returns 0..innerHeight and nothing changes for the
 * Android states.
 *
 * Falls back to the layout viewport when the visual one is missing or
 * nonsense, because a band of zero height would report every box on screen
 * as off it — a harness that failed loudly on every capture at once because
 * an engine stopped exposing a visual viewport would be reporting its own
 * gap as a wall of product defects.
 *
 * `appHeight` IS THE THIRD MODE, and it is why this takes a fourth argument
 * rather than growing a branch. Under native-ime NEITHER viewport moves, so
 * `vvHeight` is the full display and the two-argument version returns
 * 0..832 with a 310px keyboard on screen — vacuous in exactly the way the
 * expression it replaced was vacuous on iOS, and on the platform this app
 * ships to. The band there is what the app PUBLISHED as `--app-height`
 * (keyboard-state.js, visibleBandHeight), so the driver reads that and
 * passes it, and the fixture states it independently. In the other two
 * modes `--app-height` equals the visual viewport's height, so passing it
 * changes nothing — which is what makes it safe to pass always, rather than
 * per mode.
 */
export function visibleBand({ innerHeight, vvHeight, vvOffsetTop = 0, appHeight = null }) {
  const layout = Number.isFinite(innerHeight) && innerHeight > 0 ? innerHeight : 0;
  const band = Number.isFinite(appHeight) && appHeight > 0 ? appHeight : vvHeight;
  if (!Number.isFinite(band) || band <= 0) return { top: 0, bottom: layout };
  const top = Number.isFinite(vvOffsetTop) && vvOffsetTop > 0 ? vvOffsetTop : 0;
  return { top, bottom: top + band };
}

// Sub-pixel slack. The visual viewport reports a fractional height under
// device emulation (856.31 against an 857px innerHeight, measured on
// chromium here), and every box in states.js is rounded before it gets
// here, so a box flush against the band can round one px past it. One px,
// no more: the failure this catches is a whole keyboard, not a rounding.
const EDGE_TOLERANCE_PX = 1;

/**
 * Why this box is not fully on screen, or null if it is.
 *
 * A sentence rather than a boolean, because the two ways to fail have
 * different causes and a driver that reported "not visible" would leave
 * the diagnosis to whoever next opens the PNG — which, for a sheet that is
 * not in the frame at all, is a blank image and no explanation. Above the
 * band is the double-count (lifted twice); below it is the keyboard
 * covering the thing the writer is typing into.
 */
export function offScreenReason(box, band) {
  const { top, bottom } = box ?? {};
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
    return `the box is ${top}..${bottom}, which is not a rectangle this can judge`;
  }
  if (top < band.top - EDGE_TOLERANCE_PX) {
    return (
      `the box is ${top}..${bottom} and the visible band is ${band.top}..${band.bottom} — ` +
      "its top edge is off the top of the screen, which is what lifting a fixed surface by " +
      "the keyboard's height on top of a viewport that already shrank looks like"
    );
  }
  if (bottom > band.bottom + EDGE_TOLERANCE_PX) {
    return (
      `the box is ${top}..${bottom} and the visible band is ${band.top}..${band.bottom} — ` +
      "its bottom edge is under the keyboard, which is what a fixed surface that did not " +
      "lift at all looks like when only the visual viewport shrank"
    );
  }
  return null;
}
