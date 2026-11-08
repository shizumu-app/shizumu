// What differs between the platforms the shell runs on — and nothing else.
//
// The shell is one design on every platform; only a handful of behaviours
// genuinely cannot be shared. This module is where they are named, so that
// `platformProfile` is the ONLY place in src/shell/ that looks at the OS.
// A screen that checks the OS itself is how "one look on iOS and Android"
// rots into two trees again, which is the whole reason this shell exists.
//
// isWeb beats os deliberately. The PWA, the VR harness and the dev server
// all run on top of some OS, and a browser has no Tauri haptics or status
// bar behind it — profiling an Android *browser* as native would arm plugin
// calls that simply are not there.
//
// Android's edge back is the load-bearing row. Under gesture navigation the
// system owns both screen edges; a shell-drawn edge-back competes with it,
// which is exactly how that gesture swung between firing on every scroll and
// never firing at all across the v0.6.x releases (§1, "Removed").
//
// `popstateBack` is a second axis from `back`, not a derived one: `back`
// says WHO draws the control (system chrome vs. the shell's own UI);
// popstateBack says whether a browser `popstate` event is a back gesture
// this shell must handle. Web and Android both answer true here, but for
// unrelated reasons — web because the browser's own back button fires
// popstate directly, Android because Tauri's WebView plumbs the system
// back gesture through as a `popstate` too. iOS has no popstate source at
// all: its back is shell-drawn gesture only. Without this field a shell
// root would have to re-derive "does popstate mean back here" from `os`
// itself, which is exactly the OS-check this module exists to be the one
// place for (spec §5).
//
// `exportZip` says whether settings can export every page as one zip and
// hand it to the system share sheet. Android can: the Rust side stages the
// zip and fires the share intent MainActivity already carries for
// attachments and backups (trail_export.rs, export_trail_zip_share). iOS
// cannot yet: the app has no share-sheet or document-picker code there, and
// adding it means a plugin or native Swift nobody can test without an
// iPhone. A browser has no files to pack. Where it is false, settings say
// the export works from the laptop.

const WEB = {
  back: "shell",
  backAtRoot: "none",
  edgeBackArmed: true,
  popstateBack: true,
  haptics: false,
  statusBar: false,
  exportZip: false,
};

const ANDROID = {
  back: "system",
  backAtRoot: "background",
  edgeBackArmed: false,
  popstateBack: true,
  haptics: true,
  statusBar: true,
  exportZip: true,
};

const IOS = {
  back: "shell",
  backAtRoot: "none",
  edgeBackArmed: true,
  popstateBack: false,
  haptics: true,
  statusBar: true,
  exportZip: false,
};

/**
 * @param {object} [env]
 * @param {"android"|"ios"|string|null} [env.os]  the host OS. Today it comes
 *   from `osFromUserAgent` below; `@tauri-apps/plugin-os`'s `platform()` is
 *   what it should come from, and the note on that function says why it
 *   cannot yet.
 * @param {boolean} [env.isWeb]  true in a browser: PWA, VR harness, dev server
 * @returns {Readonly<{back: "system"|"shell", backAtRoot: "background"|"none",
 *   edgeBackArmed: boolean, popstateBack: boolean, haptics: boolean, statusBar: boolean,
 *   exportZip: boolean}>}
 */
export function platformProfile({ os = null, isWeb = false } = {}) {
  if (isWeb) return Object.freeze({ ...WEB });
  if (os === "android") return Object.freeze({ ...ANDROID });
  if (os === "ios") return Object.freeze({ ...IOS });
  return Object.freeze({ ...WEB });
}

// ── reading the two facts the profile is chosen by ──────────────────────
//
// THE USER AGENT IS THE PRAGMATIC READER, NOT THE RIGHT ONE. The right one
// is `@tauri-apps/plugin-os`'s `platform()`, which asks the host rather
// than parsing a string the host is free to rewrite — and it is what the
// JSDoc above says `os` comes from. It is not reachable from this branch:
// the plugin needs a Cargo dependency, registration in `lib.rs` and a
// capabilities entry, all of which live in `src-tauri/`, which the two-tree
// rule (CLAUDE.md) puts off limits here. So the seam gets the reader it can
// have now, and swapping it for the plugin at a phase gate is a change to
// this one function and its tests, because nothing else in the shell may
// look at the OS at all.
//
// What that costs, said rather than left to be discovered: a WebView can be
// configured with any user-agent string its host likes, so a UA is evidence
// about the OS and not a statement of it. Nothing else in this file changes
// when the plugin lands.
//
// THE iPadOS TRAP, and why it is out of scope rather than handled. Safari
// on iPadOS defaults to desktop-class browsing and reports a *Macintosh*
// user agent with no iPad in it — byte-identical to Safari's on a Mac, an
// identity `platform.test.js` asserts rather than describes — so no reader
// of the UA alone can tell those two apart. The usual fix
// (`navigator.maxTouchPoints > 1` beside the string)
// is not a UA fact, and this function takes a string on purpose so it can
// be tested against real ones.
//
// It is out of scope because on this seam the misreading is unreachable.
// The Macintosh UA is a BROWSER's, and a browser is `isWeb`, which beats
// `os` outright a few lines above — an iPad running the PWA gets the web
// profile whatever this function answers, which is the profile it should
// have. The other direction is covered too: Tauri's iPad WebView is not
// desktop-class, so it reports `iPad` and lands on IOS correctly. The
// residual case is an iPad Tauri build that opts its WebView into a
// desktop-class UA — a thing this app does not do, and which would want
// `maxTouchPoints` (or the plugin) rather than another substring.
//
// `Android` before the iOS names because Android is the only one of the two
// that can appear beside `Linux`, and no shipped Android UA carries an
// iPhone/iPad token; the order is stated rather than relied on silently.

/**
 * Which phone OS a user-agent string describes, if any.
 *
 * @param {string|null|undefined} ua  `navigator.userAgent`
 * @returns {"android"|"ios"|null}  null for every desktop, and for the
 *   desktop-class iPad UA described above — see that note before "fixing" it.
 */
export function osFromUserAgent(ua) {
  if (typeof ua !== "string") return null;
  if (/\bAndroid\b/.test(ua)) return "android";
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) return "ios";
  return null;
}

/**
 * The profile for the environment this code is running in: the shell's one
 * call site reads this once and passes the fields down as props.
 *
 * `isWeb` is the absence of Tauri, spelled the way the rest of the app
 * already spells it (`src/lib/api.js`, `LockScreen.svelte`): a truthy
 * `__TAURI_INTERNALS__` on the window. A second spelling of "are we native"
 * is a second answer to it.
 *
 * @param {Window|null|undefined} [win]  defaults to the real window; passed
 *   explicitly by tests, which is the only reason it is a parameter.
 * @returns {ReturnType<typeof platformProfile>}
 */
export function currentPlatformProfile(win = typeof window === "undefined" ? null : window) {
  return platformProfile({
    os: osFromUserAgent(win?.navigator?.userAgent),
    isWeb: !win?.__TAURI_INTERNALS__,
  });
}
