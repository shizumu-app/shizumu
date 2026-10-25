// The window on a Linux phone: what changes when the phone shell boots
// inside a desktop window.
//
// ── WHICH LAYOUT A LINUX PHONE GETS IS NOT DECIDED HERE ───────────────
//
// shell/shell-boot.js's `shouldBootShell` already answers that, and it asks
// nothing about the OS: a phone-shaped viewport (`isMobileNav()`), a COARSE
// primary pointer, and a `try_new_shell` that is unset or "true". A Linux
// phone meets all three without help:
//
//   - Phosh and Plasma Mobile run a Librem 5 or a PinePhone (720 px wide)
//     at scale 2, so the page is 360 CSS px wide and PHONE_QUERY matches.
//     Phones with a wider logical screen still land under TABLET_QUERY's
//     768 px, which counts for a coarse pointer.
//   - WebKitGTK answers `(pointer: coarse)` from the GDK seat's
//     capabilities (WebKit, UIProcess/glib/WebProcessPoolGLib.cpp and
//     WebProcess/glib/WebProcessGLib.cpp): a seat with touch and no pointer
//     is a touchscreen primary; any pointer capability makes the primary a
//     mouse, so the answer is `fine`. A phone with nothing plugged in is
//     coarse; the same phone docked to a mouse is fine and gets the desktop
//     tree, which is the docked case the shell gate already watches for.
//   - A desktop or a laptop always has a pointer, so it stays fine, and
//     the desktop tree it has today.
//
// The stored "false" stays authoritative because shouldBootShell reads it
// first and nothing below reaches the boot fork. The tests beside this file
// hold those three Linux cases against shouldBootShell itself, so a change
// to the gate that dropped Linux phones would show up here too.
//
// One case it cannot see: launched under XWayland (GDK_BACKEND=x11), the
// X11 seat always carries the core pointer, so WebKitGTK reports `fine` on
// a touch-only phone. The deb and rpm launcher forces x11 for a Plasma 6
// input bug; src-tauri/src/gdk_backend.rs lifts it on a phone session.
//
// ── WHAT IS DECIDED HERE: THE WINDOW'S MINIMUM SIZE ───────────────────
//
// tauri.conf.json gives the window minWidth 360 and minHeight 480, a
// desktop floor that stops a mouse user dragging the window to nothing.
// On Phosh the on-screen keyboard (squeekboard) does not lay itself over
// the app the way Android's does: it takes an exclusive zone and the
// compositor RESIZES the window to the space left, which on a 720 px tall
// logical screen, less the top bar and the keyboard, is under 480. (Not
// measured on a device: no Linux phone was at hand.) GTK will not shrink a window below its minimum, so
// with 480 the lower part of the window would sit under the keyboard, and
// keyboard-state.js would size `--app-height` to a band the reader cannot
// see. With no minimum, the window shrinks, the visual viewport shrinks
// with it, keyboard-state's baseline path reads the drop as an open
// keyboard, and `--kb-overlay` is 0 because nothing is covered — the same
// resize-not-overlay shape Android's adjustResize produces.
//
// So: on Linux, while the phone shell is booted, the minimum is cleared;
// when the shell gives way to the desktop tree (a phone docked to a
// mouse), the desktop floor comes back. Everywhere else the window is
// never touched — Android and iOS have no window to size, and a desktop
// Linux window keeps the floor tauri.conf.json gave it without a single
// call, because the floor is what it already has.

/** tauri.conf.json's floor. Spelled here rather than imported so the
 *  frontend bundle does not carry the whole config; the test reads the
 *  config and fails if the two part. */
export const DESKTOP_MIN_SIZE = Object.freeze({ width: 360, height: 480 });

/**
 * Is this the Tauri app on a Linux host — desktop or phone, but not
 * Android, whose user agent also says Linux.
 *
 * WebKitGTK's user agent names the platform as `X11; Linux <arch>` on
 * Wayland as well as on X11. A browser on Linux is not this: it has no
 * window to size, and `isTauri` is what says so.
 *
 * @param {object} input
 * @param {string|null|undefined} input.userAgent  navigator.userAgent
 * @param {boolean} input.isTauri                  the app's own isTauri
 * @returns {boolean}
 */
export function isLinuxAppHost({ userAgent, isTauri }) {
  if (isTauri !== true || typeof userAgent !== "string") return false;
  return /\bLinux\b/.test(userAgent) && !/\bAndroid\b/.test(userAgent);
}

/**
 * Which minimum the window should have.
 *
 * @param {object} input
 * @param {boolean} input.linuxHost  isLinuxAppHost(...)
 * @param {boolean} input.bootShell  App.svelte's boot fork
 * @returns {"phone"|"desktop"|null}  null: not a window this module sizes
 */
export function windowMinSizeFor({ linuxHost, bootShell }) {
  if (linuxHost !== true) return null;
  return bootShell === true ? "phone" : "desktop";
}

/**
 * The call to make, given what the window has now and what it should have.
 * The window starts with the desktop floor (tauri.conf.json), so `applied`
 * starts at "desktop" and a desktop Linux launch makes no call at all.
 *
 * @param {object} input
 * @param {"phone"|"desktop"} input.applied  what the window has now
 * @param {"phone"|"desktop"|null} input.wanted  windowMinSizeFor(...)
 * @returns {{size: {width:number,height:number}|null}|null}
 *   null: make no call. `{size: null}`: clear the minimum (setMinSize(null)).
 */
export function minSizeCall({ applied, wanted }) {
  if (wanted === null || wanted === applied) return null;
  return { size: wanted === "phone" ? null : { ...DESKTOP_MIN_SIZE } };
}

/**
 * Whether the frameless window's resize grips render. They hand a press at
 * the window's edge to the compositor's interactive resize, which a phone
 * shell has no use for: on a phone the compositor sizes the window, and a
 * thumb at the edge is reaching for the shell's own controls. Global CSS
 * already hides them under 480 px; this covers a phone whose logical width
 * is wider than that, where the shell boots through the tablet query.
 *
 * @param {object} input
 * @param {boolean} input.isTauri
 * @param {boolean} input.isMobilePlatform  Android or iOS by user agent
 * @param {boolean} input.bootShell
 * @returns {boolean}
 */
export function resizeGripsShown({ isTauri, isMobilePlatform, bootShell }) {
  return isTauri === true && isMobilePlatform !== true && bootShell !== true;
}
