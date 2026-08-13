// block-hover-guard.js — pure timestamp guard for the desktop block-title
// hover reveal driven by TipTapEditor.svelte's handleEditorMouseMove.
//
// Why this exists: the block-title reveal used to be a CSS-only rule gated
// behind `@media (hover: hover)` (added for the D-6 QA-sweep fix — see
// global.css history). That gate assumed `matchMedia('(hover: hover)')`
// reliably detects a genuine mouse. It doesn't: the real webkit2gtk engine
// (the desktop app's actual webview on Linux) was reproduced reporting
// `(hover: hover): false` under its GDK X11 backend even with a real mouse
// and zero touch hardware — silently killing hover-reveal for X11-backed
// desktop users while Chromium (correctly reporting hover:hover=true) never
// showed the regression in dev/browser testing. See
// .superpowers/hover-title-fix-report.md for the reproduction.
//
// The fix drives the reveal from the editor's real mousemove tracking
// instead of trusting the media query (see the `.block-mouse-hovered`
// class in global.css and hoveredMouseBlock in TipTapEditor.svelte). But
// mousemove alone isn't a safe "this is a deliberate desktop hover" signal
// — Chromium (and, given webkitgtk's fragility around interaction media
// features, plausibly other engines too) synthesizes a compat
// mousemove/mouseover immediately after ANY touch tap, anywhere on a
// block. Trusting that compat event would reopen the exact D-6 hole this
// guard exists to keep closed: a touch tap must never reveal (and thus
// pointer-events:auto-enable) the title slot.
//
// isTrustedMouseHover() is the guard: a mousemove is only treated as a
// deliberate desktop hover if it lands more than `guardMs` after the most
// recent real touch pointerdown.

export const TOUCH_COMPAT_GUARD_MS = 800;

/**
 * @param {number} lastTouchAt - timestamp (ms) of the most recent real touch
 *   pointerdown (`event.pointerType === "touch"`), or 0/falsy if there has
 *   been none yet this session.
 * @param {number} now - current timestamp (ms). Caller-supplied (rather than
 *   read internally via Date.now()) so this stays a pure, deterministically
 *   testable function.
 * @param {number} [guardMs] - guard window in ms. Defaults to
 *   TOUCH_COMPAT_GUARD_MS.
 * @returns {boolean} true if a mousemove at `now` should be trusted as a
 *   genuine desktop hover, not touch-compat noise.
 */
export function isTrustedMouseHover(lastTouchAt, now, guardMs = TOUCH_COMPAT_GUARD_MS) {
  if (!lastTouchAt) return true;
  return now - lastTouchAt > guardMs;
}

/**
 * resolveHoveredMouseBlock — the single decision point for what
 * hoveredMouseBlock should be, given the current mousemove result.
 *
 * Code-review finding (post-7af09e1): gating the CLEAR path (not just the
 * REVEAL path) behind isTrustedMouseHover() left two bugs. (1) On a hybrid
 * touch+mouse device, a touch landing anywhere in the editor while a title
 * was already revealed would freeze that reveal in place for up to
 * guardMs, because the not-found branch's clear was also guarded — a real
 * mousemove leaving the block couldn't clear it. (2) Moving the mouse from
 * block A to block B within the guard window computed `found = B`, was
 * correctly blocked from revealing B, but never cleared A either, leaving
 * A's title stuck open under a cursor that's no longer over it.
 *
 * Clearing must always be the default; only REVEALING a block is gated.
 * This function makes that the only possible shape: it returns `found`
 * itself if (and only if) `found` exists AND the hover is trusted, and
 * `null` in every other case — no caller-side branching, no way to
 * accidentally carry a stale block forward.
 *
 * @param {Element|null} found - the block under the cursor this mousemove
 *   (or null if the cursor isn't over any block).
 * @param {number} lastTouchAt - see isTrustedMouseHover.
 * @param {number} now - see isTrustedMouseHover.
 * @param {number} [guardMs] - see isTrustedMouseHover.
 * @returns {Element|null} what hoveredMouseBlock should become.
 */
export function resolveHoveredMouseBlock(found, lastTouchAt, now, guardMs = TOUCH_COMPAT_GUARD_MS) {
  if (found && isTrustedMouseHover(lastTouchAt, now, guardMs)) {
    return found;
  }
  return null;
}

/**
 * hoverClassTarget — which element (if any) should carry `.block-mouse-hovered`.
 *
 * The class exists for ONE purpose: revealing a board's title slot on hover
 * (global.css). Its only consumers are `.block-shell` and `.code-block-wrap`.
 * Stamping it on any OTHER NodeView root — an image/attachment wrapper
 * (`.local-image-wrap`) above all — mutates that NodeView's own element, which
 * ProseMirror's MutationObserver treats as a foreign DOM change and reconciles
 * by REBUILDING the NodeView. For a Svelte NodeView that remounts the component
 * and tears down the <img>; because mousemove re-runs the stamp on every pixel,
 * the image flickers the whole time the cursor is over it.
 *
 * Returning the element only when it is a board keeps the stamp where it does
 * something and off everything that was only ever paying the rebuild cost.
 *
 * @param {Element|null} el - the currently hovered block element, or null.
 * @returns {Element|null} `el` if it is a board that uses the class, else null.
 */
export function hoverClassTarget(el) {
  if (
    el &&
    el.classList &&
    (el.classList.contains("block-shell") || el.classList.contains("code-block-wrap"))
  ) {
    return el;
  }
  return null;
}
