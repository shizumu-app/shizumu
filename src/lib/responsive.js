// Responsive helpers — the canonical breakpoint set lives in CSS
// (src/styles/global.css), but JS-driven affordances (block handle reveal,
// MobileActionBar conditional mount, gesture navigation) need to branch
// on the same predicates. Keeping the matchers here means the breakpoint
// values aren't sprinkled across components.
//
// Breakpoint canon (mirrors the CSS comments in global.css):
//   --bp-phone:   480px   one-handed phone reach
//   --bp-tablet:  768px   tablet portrait; below this we hide desktop chrome
//   --bp-desktop: 1024px  full desktop layout
//
// Why three predicates instead of "is mobile":
//   - isCoarsePointer() — input *modality* (touch vs. mouse). A 1024px
//     laptop with a touchscreen is coarse-pointer-capable; a 600px
//     desktop browser window is not.
//   - isPhoneViewport() — viewport *size* (≤ 480px). Independent from
//     pointer modality: an iPad in portrait is touch + tablet, not phone.
//   - isKeyboardOpen() — soft-keyboard *occlusion* (visualViewport API).
//     Used by the slash-command menu (slash-commands.js) et al. to
//     reposition above the cursor when the keyboard would otherwise
//     occlude the popup.

// Both size tiers ask about the viewport's SHORT side, not its width.
// A phone doesn't stop being a phone when you turn it sideways, but
// landscape makes a modern handset ~890px wide — past the 480px phone rule
// AND past the 768px tablet one — so rotating handed the user the full
// desktop layout: the MobileActionBar unmounted, the edge gestures switched
// off, and the editorial header reverted. The landscape clause is the one
// Modal.svelte already used for exactly this case, so there's one spelling
// of "landscape phone" in the codebase.
//
// The height threshold stays 480px in BOTH tiers on purpose. Using 768px
// for the tablet tier would sweep in ordinary desktop windows, which are
// routinely under 768px tall.
//
// These strings are exported so the tests can stub matchMedia against the
// real query rather than a copy that can drift.
export const LANDSCAPE_PHONE_CLAUSE = "(orientation: landscape) and (max-height: 480px)";
export const PHONE_QUERY = `(max-width: 480px), ${LANDSCAPE_PHONE_CLAUSE}`;
export const TABLET_QUERY = `(max-width: 768px), ${LANDSCAPE_PHONE_CLAUSE}`;
const COARSE_POINTER_QUERY = "(pointer: coarse)";

// Cache the MediaQueryList objects — matchMedia parses the query string
// fresh every call, so reusing the list cuts overhead in tight callsites
// (gesture handlers fire on every touchmove).
function safeMatchMedia(query) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(query);
}

let coarseMql = null;
let phoneMql = null;
let tabletMql = null;

export function isCoarsePointer() {
  if (!coarseMql) coarseMql = safeMatchMedia(COARSE_POINTER_QUERY);
  return !!coarseMql && coarseMql.matches;
}

export function isPhoneViewport() {
  if (!phoneMql) phoneMql = safeMatchMedia(PHONE_QUERY);
  return !!phoneMql && phoneMql.matches;
}

export function isTabletViewport() {
  if (!tabletMql) tabletMql = safeMatchMedia(TABLET_QUERY);
  return !!tabletMql && tabletMql.matches;
}

/** Tallest innerHeight seen this session — the "no keyboard" baseline for
 *  the resizes-content branch below. Only ever grows, so a rotation or a
 *  collapsing address bar re-baselines instead of reading as a keyboard. */
let maxLayoutHeight = 0;

/** The keyboard-slack threshold, shared by both detection branches. An
 *  Android system bar can move the visible area by a few dozen px with no
 *  keyboard involved; a keyboard is always far bigger than this. */
const KEYBOARD_SLACK_PX = 100;

/** Soft-keyboard occlusion check. Two viewport modes have to be handled,
 *  because they present the keyboard completely differently:
 *
 *  - `resizes-visual` (the browser default, and what older WebViews do):
 *    the layout viewport keeps its full height and only the visual
 *    viewport shrinks, so visualViewport.height falls below innerHeight.
 *
 *  - `resizes-content` (what index.html asks for, so the shell can't be
 *    taller than the screen and get scrolled out from under the user):
 *    the layout viewport shrinks too. visualViewport.height then tracks
 *    innerHeight and the first comparison never fires — the keyboard has
 *    to be read from innerHeight falling below the tallest height we've
 *    seen instead. */
export function isKeyboardOpen() {
  if (typeof window === "undefined" || !window.visualViewport) return false;
  const inner = window.innerHeight;
  if (window.visualViewport.height < inner - KEYBOARD_SLACK_PX) return true;
  if (inner > maxLayoutHeight) maxLayoutHeight = inner;
  return maxLayoutHeight - inner > KEYBOARD_SLACK_PX;
}

/** Test seam — the baseline is module state that would otherwise leak
 *  between cases. Not used by app code. */
export function _resetKeyboardBaseline() {
  maxLayoutHeight = 0;
}

/** Subscribe to a media query — fires `cb(matches)` immediately and on
 *  every transition. Returns an unsubscribe function. Used by Svelte
 *  components that need to react to viewport changes during the
 *  session (e.g., MobileActionBar's mount conditionally on phone
 *  viewport while the user resizes a dev window). */
export function watchMedia(query, cb) {
  const mql = safeMatchMedia(query);
  if (!mql) {
    cb(false);
    return () => {};
  }
  cb(mql.matches);
  const handler = (e) => cb(e.matches);
  // addEventListener is the modern API; older Safari needs addListener.
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }
  mql.addListener(handler);
  return () => mql.removeListener(handler);
}

export function watchCoarsePointer(cb) { return watchMedia(COARSE_POINTER_QUERY, cb); }
export function watchPhoneViewport(cb) { return watchMedia(PHONE_QUERY, cb); }
export function watchTabletViewport(cb) { return watchMedia(TABLET_QUERY, cb); }

/** Mobile navigation chrome + gestures predicate. One rule for the
 *  MobileActionBar mount, its CSS breakpoint, and gesture enablement,
 *  closing the 481-768px hole where gestures were on but the bar was
 *  absent. Phone viewports always qualify; larger viewports qualify
 *  only when they are BOTH touch-first and tablet-sized. */
export function isMobileNav() {
  return isPhoneViewport() || (isCoarsePointer() && isTabletViewport());
}

/** Subscribe to isMobileNav() transitions. Watches all three underlying
 *  media queries and recomputes on any change. Fires immediately. */
export function watchMobileNav(cb) {
  let last = null;
  const recompute = () => {
    const next = isMobileNav();
    if (next !== last) {
      last = next;
      cb(next);
    }
  };
  const unsubs = [
    watchMedia(PHONE_QUERY, recompute),
    watchMedia(COARSE_POINTER_QUERY, recompute),
    watchMedia(TABLET_QUERY, recompute),
  ];
  return () => unsubs.forEach((u) => u());
}

const LANDSCAPE_QUERY = "(orientation: landscape)";
let landscapeMql = null;

export function isLandscape() {
  if (!landscapeMql) landscapeMql = safeMatchMedia(LANDSCAPE_QUERY);
  return !!landscapeMql && landscapeMql.matches;
}

export function watchLandscape(cb) { return watchMedia(LANDSCAPE_QUERY, cb); }

/** Subscribe to soft-keyboard open/close transitions. Fires `cb(open)`
 *  immediately and on every height threshold cross. Returns unsubscribe.
 *  Uses the existing `isKeyboardOpen()` heuristic: visualViewport.height
 *  shrinks below innerHeight - 100px when the IME is showing. */
export function watchKeyboardOpen(cb) {
  if (typeof window === "undefined" || !window.visualViewport) {
    cb(false);
    return () => {};
  }
  let lastOpen = isKeyboardOpen();
  cb(lastOpen);
  const handler = () => {
    const next = isKeyboardOpen();
    if (next !== lastOpen) {
      lastOpen = next;
      cb(next);
    }
  };
  window.visualViewport.addEventListener("resize", handler);
  window.visualViewport.addEventListener("scroll", handler);
  // Under resizes-content the keyboard changes the LAYOUT viewport, which
  // is a window resize. visualViewport fires too on current Chrome, but
  // window is the event that mode is actually defined in terms of — listen
  // to both rather than depend on the overlap holding.
  window.addEventListener("resize", handler);
  return () => {
    window.visualViewport.removeEventListener("resize", handler);
    window.visualViewport.removeEventListener("scroll", handler);
    window.removeEventListener("resize", handler);
  };
}
