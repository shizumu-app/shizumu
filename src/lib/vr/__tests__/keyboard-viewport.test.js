import { describe, it, expect } from "vitest";
import {
  WIDGET_MODE, keyboardFixture, visibleBand, offScreenReason,
} from "../keyboard-viewport.js";

// The two devices these numbers come from, so no test invents a phone:
//  - Pixel 7 at 915px tall, which every existing keyboard state shrinks to
//    360 (KEYBOARD_VIEWPORT_HEIGHT, tests/vr/states.js). The 839/479/360
//    set below is the one the historical defect was measured in — see
//    scenes.js's BLOCK_SHEET note, "y -299..-119 in a 360px viewport".
//  - iPhone 14 at 664px tall (Playwright's device descriptor), with the
//    336px keyboard Sheet.svelte's own comment names for a 390pt phone.
const ANDROID = { deviceHeight: 839, keyboardPx: 479 };
const IPHONE = { deviceHeight: 664, keyboardPx: 336 };
//  - A Galaxy A16 at 832 CSS px with a 310px keyboard, read off the device
//    over wifi adb. Both numbers were MEASURED rather than chosen, which is
//    the point of the third mode: nothing in the suite had ever asserted
//    against a phone whose viewports do not move for the IME.
const A16 = { deviceHeight: 832, keyboardPx: 310 };

describe("keyboardFixture — the numbers each widget mode leaves behind", () => {
  it("moves both viewports together under resizes-content", () => {
    // Android, and what index.html asks for. innerHeight tracks the visual
    // viewport, so a fixed `bottom: 0` is already above the keyboard and
    // --kb-overlay must be 0: any lift at all subtracts the same keyboard
    // twice.
    const f = keyboardFixture({ mode: WIDGET_MODE.RESIZES_CONTENT, ...ANDROID });
    expect(f.innerHeight).toBe(360);
    expect(f.vvHeight).toBe(360);
    expect(f.kbInset).toBe(479);
    expect(f.kbOverlay).toBe(0);
  });

  it("leaves the layout viewport alone under resizes-visual", () => {
    // iOS/WKWebView. innerHeight stays the full device height while the
    // visual viewport shrinks, so `bottom: 0` is UNDER the keyboard and
    // --kb-overlay carries the whole difference.
    const f = keyboardFixture({ mode: WIDGET_MODE.RESIZES_VISUAL, ...IPHONE });
    expect(f.innerHeight).toBe(664);
    expect(f.vvHeight).toBe(328);
    expect(f.kbInset).toBe(336);
    expect(f.kbOverlay).toBe(336);
  });

  it("asks the harness to resize under one mode and to shadow under the other", () => {
    // The pair the whole fixture turns on. A driver that called
    // setViewportSize on the iOS path would put innerHeight back in step
    // with the visual viewport and photograph Android's numbers under an
    // iPhone filename — so exactly one of these is non-null per mode, and
    // the driver asserts afterwards which one it got.
    const content = keyboardFixture({ mode: WIDGET_MODE.RESIZES_CONTENT, ...ANDROID });
    expect(content.resizeTo).toBe(360);
    expect(content.overrideVisualHeight).toBe(null);

    const visual = keyboardFixture({ mode: WIDGET_MODE.RESIZES_VISUAL, ...IPHONE });
    expect(visual.resizeTo).toBe(null);
    expect(visual.overrideVisualHeight).toBe(328);
  });

  it("lands a bottom-anchored fixed surface on the visible edge in both modes", () => {
    // The rule, stated once: a `position: fixed; bottom: 0` box lifted by
    // --kb-overlay ends exactly on the lowest visible pixel, whichever
    // viewport the browser shrank. That is the invariant keyboardOverlayPx
    // exists to hold, checked here against numbers written independently
    // of it.
    for (const [mode, device] of [
      [WIDGET_MODE.RESIZES_CONTENT, ANDROID],
      [WIDGET_MODE.RESIZES_VISUAL, IPHONE],
    ]) {
      const f = keyboardFixture({ mode, ...device });
      expect(f.innerHeight - f.kbOverlay).toBe(f.visibleBottom);
      expect(f.visibleBottom).toBe(visibleBand(f).bottom);
    }
  });

  it("moves no viewport at all under native-ime, and says so natively", () => {
    // ANDROID 15, WHICH IS WHERE THIS APP SHIPS. It enforces edge-to-edge
    // for targetSdk 35+ and does not resize an edge-to-edge window for the
    // IME, so adjustResize and interactive-widget=resizes-content are both
    // set and both ignored. Every viewport number says there is no keyboard.
    const f = keyboardFixture({ mode: WIDGET_MODE.NATIVE_IME, ...A16 });
    expect(f.innerHeight).toBe(832);
    expect(f.vvHeight).toBe(832);
    // So the height has to arrive from the activity, and this is the whole
    // of the harness's input in this mode.
    expect(f.nativeKeyboard).toEqual({ visible: true, heightPx: 310 });
    expect(f.resizeTo).toBeNull();
    expect(f.overrideVisualHeight).toBeNull();
    // THE TWO NUMBERS THAT WERE WRONG ON THE DEVICE. --app-height published
    // 832, so the shell's frame was full-display tall with the keyboard over
    // its lower third and the editor strip behind it; --kb-overlay published
    // 0 (innerHeight - vvHeight, with neither moving), so every fixed sheet
    // was told to lift by nothing.
    expect(f.appHeight).toBe(522);
    expect(f.kbOverlay).toBe(310);
    expect(f.kbInset).toBe(310);
  });

  it("keeps appHeight and vvHeight in step in the two modes that resize", () => {
    // Which is why --app-height never needed stating before this mode, and
    // why passing it to visibleBand is safe everywhere rather than per mode.
    for (const [mode, device] of [
      [WIDGET_MODE.RESIZES_CONTENT, ANDROID],
      [WIDGET_MODE.RESIZES_VISUAL, IPHONE],
    ]) {
      const f = keyboardFixture({ mode, ...device });
      expect(f.appHeight).toBe(f.vvHeight);
    }
  });

  it("lands a bottom-anchored fixed surface on the visible edge under native-ime too", () => {
    const f = keyboardFixture({ mode: WIDGET_MODE.NATIVE_IME, ...A16 });
    expect(f.innerHeight - f.kbOverlay).toBe(f.visibleBottom);
    expect(f.visibleBottom).toBe(visibleBand(f).bottom);
  });

  it("refuses a keyboard the app would not notice", () => {
    // computeKeyboardState ignores a shrink of 80px or less (URL bars), so
    // a fixture asking for one would publish --kb-inset: 0px and every
    // assertion downstream would pass against an app that never saw a
    // keyboard. Vacuous, so it throws rather than returning numbers.
    expect(() => keyboardFixture({ mode: WIDGET_MODE.RESIZES_VISUAL, deviceHeight: 664, keyboardPx: 80 }))
      .toThrow(/threshold/);
  });

  it("refuses a keyboard taller than the device and an unknown mode", () => {
    expect(() => keyboardFixture({ mode: WIDGET_MODE.RESIZES_VISUAL, deviceHeight: 664, keyboardPx: 664 }))
      .toThrow(/nothing visible/);
    expect(() => keyboardFixture({ mode: "resizes-nothing", ...IPHONE }))
      .toThrow(/unknown widget mode/);
  });
});

describe("visibleBand — which rectangle the user can actually see", () => {
  it("is the whole layout viewport under resizes-content", () => {
    // Not a "nothing happens" assertion: this is the compatibility claim.
    // Every Android keyboard state in the suite measures boxes against
    // window.innerHeight today, and this says the band reader agrees with
    // them exactly, so adopting it changes no existing capture.
    const f = keyboardFixture({ mode: WIDGET_MODE.RESIZES_CONTENT, ...ANDROID });
    expect(visibleBand(f)).toEqual({ top: 0, bottom: 360 });
    expect(visibleBand(f).bottom).toBe(f.innerHeight);
  });

  it("is the band the app published under native-ime, not the viewport", () => {
    // THE VACUOUS READING THIS CLOSES: with neither viewport moving,
    // vvHeight is 832 and the two-argument band says 0..832 — so a sheet
    // sitting flat on the bottom of the display, entirely behind a 310px
    // keyboard, reads as fully on screen. That is the iOS failure
    // visibleBand was written for, arriving on Android.
    const f = keyboardFixture({ mode: WIDGET_MODE.NATIVE_IME, ...A16 });
    expect(visibleBand(f)).toEqual({ top: 0, bottom: 522 });
    expect(visibleBand({ innerHeight: f.innerHeight, vvHeight: f.vvHeight }))
      .toEqual({ top: 0, bottom: 832 });
    expect(offScreenReason({ top: 400, bottom: 832 }, visibleBand(f)))
      .toMatch(/under the keyboard/);
  });

  it("is the top of the layout viewport under resizes-visual", () => {
    const f = keyboardFixture({ mode: WIDGET_MODE.RESIZES_VISUAL, ...IPHONE });
    expect(visibleBand(f)).toEqual({ top: 0, bottom: 328 });
    // And it is emphatically NOT innerHeight, which is the whole point.
    expect(visibleBand(f).bottom).not.toBe(f.innerHeight);
  });

  it("follows the offset when the browser has scrolled the layout viewport", () => {
    // WKWebView moves visualViewport.offsetTop to reveal a focused field.
    // The fixture cannot produce that (see keyboardFixture's doc), but the
    // band takes it so a future one does not have to re-derive the reader.
    expect(visibleBand({ innerHeight: 664, vvHeight: 328, vvOffsetTop: 120 }))
      .toEqual({ top: 120, bottom: 448 });
  });

  it("falls back to the layout viewport when there is no visual one", () => {
    // A zero-height band would report every box on screen as off it, so an
    // engine that stopped exposing visualViewport would fail every capture
    // at once and read as a wall of product defects. Falling back reports
    // nothing rather than reporting everything.
    expect(visibleBand({ innerHeight: 664, vvHeight: undefined })).toEqual({ top: 0, bottom: 664 });
    expect(visibleBand({ innerHeight: 664, vvHeight: 0 })).toEqual({ top: 0, bottom: 664 });
  });
});

describe("offScreenReason — the two ways a keyboard-up sheet leaves the screen", () => {
  it("says nothing about a sheet inside the band", () => {
    // The half detent of a shell sheet on an iPhone with the keyboard up:
    // 0.5 x --app-height (328) = 164, sitting on the visible bottom edge.
    const band = visibleBand(keyboardFixture({ mode: WIDGET_MODE.RESIZES_VISUAL, ...IPHONE }));
    expect(offScreenReason({ top: 164, bottom: 328 }, band)).toBe(null);
  });

  it("catches the iOS sheet an innerHeight check cannot", () => {
    // THE REASON THIS MODULE EXISTS. assertSheetShape (tests/vr/states.js)
    // asks `sheet.bottom > sheet.viewport` with viewport read as
    // window.innerHeight. Under resizes-visual a sheet whose --kb-overlay
    // resolved to 0 sits flat on the layout viewport at 500..664 — wholly
    // behind the keyboard, and 664 > 664 is false, so that check reports
    // it fine. The band says otherwise, by name.
    const f = keyboardFixture({ mode: WIDGET_MODE.RESIZES_VISUAL, ...IPHONE });
    const unlifted = { top: 500, bottom: 664 };
    expect(unlifted.bottom > f.innerHeight).toBe(false);
    expect(offScreenReason(unlifted, visibleBand(f))).toMatch(/under the keyboard/);
  });

  it("catches the double-count that put both sheets off the top", () => {
    // The historical defect, in its own numbers: 839px device, 479px
    // keyboard, 360px viewport, a sheet lifted by --kb-inset instead of
    // --kb-overlay under resizes-content. scenes.js records the box as
    // y -299..-119, and that is what is asserted here rather than a
    // rounder number, so the test and the record cannot drift apart.
    const f = keyboardFixture({ mode: WIDGET_MODE.RESIZES_CONTENT, ...ANDROID });
    const doubled = { top: -299, bottom: -119 };
    expect(f.innerHeight - f.kbInset).toBe(doubled.bottom);
    expect(offScreenReason(doubled, visibleBand(f))).toMatch(/off the top of the screen/);
  });

  it("allows one pixel of slack and no more", () => {
    // visualViewport.height is fractional under device emulation (856.31
    // against an 857px innerHeight, measured on chromium here) and every
    // box reaching here is rounded, so a box flush against the band can
    // round one px past it. Two px is a layout fact, not a rounding.
    const band = { top: 0, bottom: 328 };
    expect(offScreenReason({ top: 164, bottom: 329 }, band)).toBe(null);
    expect(offScreenReason({ top: 164, bottom: 330 }, band)).toMatch(/under the keyboard/);
    expect(offScreenReason({ top: -1, bottom: 328 }, band)).toBe(null);
    expect(offScreenReason({ top: -2, bottom: 328 }, band)).toMatch(/off the top/);
  });

  it("refuses to judge a box it was not given", () => {
    // sheetState returns null for `top`/`bottom` when the element is gone.
    // Reporting "on screen" for a sheet that is not in the DOM would be
    // the vacuous pass this whole file is written against.
    const band = { top: 0, bottom: 328 };
    expect(offScreenReason(null, band)).toMatch(/not a rectangle/);
    expect(offScreenReason({ top: null, bottom: null }, band)).toMatch(/not a rectangle/);
  });
});
