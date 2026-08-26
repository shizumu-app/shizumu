// Which glyph names the "mod" key on this machine.
//
// Every mod-key handler in the app binds `e.ctrlKey || e.metaKey`
// (Page.svelte's handleKeydown, TipTapEditor's wrapper listener,
// Memory/Thread's back-to-page) and every editor keymap uses TipTap's
// "Mod-" prefix. Both resolve to ⌘ on macOS and ctrl everywhere else —
// but the shortcuts panel used to hardcode ⌘, so Linux and Windows users
// read a glyph their keyboard does not have for a chord that works.
//
// A pure module rather than a line inside the component (CLAUDE.md:
// decisions go in pure modules) for two reasons. It is testable across
// platforms without a browser, and App.svelte's own isMacOS is computed
// AFTER the `window.__VR__` early return — so a component that took the
// answer as a prop would render an empty modifier under `?vr=1`. Reading
// navigator here keeps the panel deterministic in every mode: the VR
// harness runs Linux engines, which answer "ctrl".
//
// Same test as App.svelte:94, deliberately: platform first, userAgent as
// the fallback for engines that have deprecated navigator.platform away.

/** @type {"⌘"} */
const MAC = "⌘";
/** @type {"ctrl"} */
const OTHER = "ctrl";

/**
 * @param {{ platform?: string, userAgent?: string } | null | undefined} nav
 *   Normally `navigator`. Missing or shapeless (SSR, a test, a webview
 *   that exposes neither field) answers `"ctrl"` — the majority platform,
 *   and the one whose chord still works if the guess is wrong, since a
 *   Mac reads ctrl-labelled chords as unavailable rather than as ⌘.
 * @returns {"⌘" | "ctrl"}
 */
export function modifierLabel(nav) {
  if (!nav || typeof nav !== "object") return OTHER;
  const platform = typeof nav.platform === "string" ? nav.platform : "";
  const userAgent = typeof nav.userAgent === "string" ? nav.userAgent : "";
  return platform.includes("Mac") || userAgent.includes("Macintosh") ? MAC : OTHER;
}

/** `navigator` when there is one, else undefined — the browser call site. */
export function currentModifierLabel() {
  return modifierLabel(typeof navigator === "undefined" ? undefined : navigator);
}
