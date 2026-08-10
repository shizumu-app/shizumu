// src/lib/gestures.js
//
// Unified gesture module. Exports three Svelte actions for touch and pointer
// gestures on mobile:
//   - edgeSwipe: horizontal swipes from device edges (left edge = back,
//     right edge = new page).
//   - verticalFlick: fast, mostly-vertical swipe. Swipe up opens memory.
//     The API also accepts an `onDown` handler, but nothing currently wires
//     it up — memory is the only destination this gesture drives today.
//   - drawerSwipe: left-edge swipes to open/close the sidebar drawer.
//
// All thresholds and constants live here as a single source of truth for
// gesture behavior across the app.

export const EDGE_ZONE_PX = 24;
export const EDGE_THRESHOLD_PX = 80;
export const FLICK_Y_MIN_PX = 60;
export const FLICK_X_MAX_PX = 30;
export const FLICK_T_MAX_MS = 600;
export const DRAWER_THRESHOLD_PX = 60;
export const SLIDE_SWIPE_PX = 60;

const MIN_TRACK_PX = 6; // pointermove jitter below this is ignored

// ── Cross-system arbitration ─────────────────────────────────────────
// drawerSwipe (touch events) and edgeSwipe (pointer events) can both
// resolve the same physical left-edge drag. Real browsers dispatch
// pointer events BEFORE touch events for one physical gesture:
// pointerdown → touchstart → moves interleaved → pointerup → touchend.
// That means a touchend-only claim arrives AFTER edgeSwipe's pointerup
// has already committed — too late, so both the drawer and the edge
// action would fire. drawerSwipe instead claims mid-drag, on touchmove,
// the moment its own commit condition is satisfied (see drawerSwipe
// below) — touchmove interleaves with pointermove during the drag, so
// the claim lands well before pointerup fires. edgeSwipe checks the
// claim before firing.
let lastClaimAt = 0;
export function claimGesture() { lastClaimAt = Date.now(); }
export function gestureClaimedRecently(windowMs = 400) {
  return Date.now() - lastClaimAt < windowMs;
}
export function _resetClaimForTests() { lastClaimAt = 0; }

/**
 * Edge swipe (pointer events): horizontal drags starting within
 * EDGE_ZONE_PX of the left or right edge, committing past EDGE_THRESHOLD_PX
 * of movement in the "into the screen" direction.
 *
 * Params:
 *   - onRight(dragPx):  fires on pointerup for a committed LEFT-edge drag
 *                       (dragging rightward, into the screen, from the left
 *                       edge). App.svelte wires this to "back".
 *   - onLeft(dragPx):   fires on pointerup for a committed RIGHT-edge drag
 *                       (dragging leftward, into the screen, from the right
 *                       edge). App.svelte wires this to "new page".
 *   - onProgress(info): called on every qualifying pointermove with
 *                       `{ edge: "left" | "right", dragPx: number, threshold: number }`,
 *                       so callers can render a live peek. On pointerup (or
 *                       any reset) it fires once more with `dragPx: 0` —
 *                       always call this last-with-zero so the consumer can
 *                       clear its peek UI even on an uncommitted drag.
 *   - enabled(edge):    called once per pointerdown, after classifying which
 *                       edge (if any) the touch started in ("left" | "right").
 *                       Return false to ignore the gesture for that edge —
 *                       gating is per-edge, not global.
 */
export function edgeSwipe(node, params = {}) {
  let opts = normalize(params);
  let active = false;
  let edge = null; // "left" | "right"
  let startX = 0;
  let startY = 0;
  let lastDx = 0;
  let pointerId = null;

  function normalize(p) {
    return {
      onLeft: p.onLeft || (() => {}),
      onRight: p.onRight || (() => {}),
      onProgress: p.onProgress || (() => {}),
      enabled: p.enabled || (() => true),
    };
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Don't intercept taps that originate inside the bottom action bar
    // (or any element opting out via .no-edge-swipe). The leftmost
    // button sits within the 24px edge zone and we don't want to eat
    // its click. We DO want to allow real edge drags that start above
    // the bar.
    if (e.target instanceof Element &&
        (e.target.closest(".mobile-action-bar") || e.target.closest(".no-edge-swipe"))) {
      edge = null;
      return;
    }
    const w = window.innerWidth;
    if (e.clientX <= EDGE_ZONE_PX) edge = "left";
    else if (e.clientX >= w - EDGE_ZONE_PX) edge = "right";
    else { edge = null; return; }

    // Call enabled(edge) AFTER edge classification; bail if disabled
    if (!opts.enabled(edge)) {
      edge = null;
      return;
    }

    active = true;
    startX = e.clientX;
    startY = e.clientY;
    lastDx = 0;
    pointerId = e.pointerId;
  }

  function onPointerMove(e) {
    if (!active || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // If vertical movement dominates, abandon (probably a scroll).
    if (Math.abs(dy) > Math.abs(dx) + 12) {
      reset();
      return;
    }
    // Only track movement in the "commit" direction.
    const dragPx = edge === "left" ? Math.max(0, dx) : Math.max(0, -dx);
    if (dragPx < MIN_TRACK_PX) return;
    lastDx = dragPx;
    try { node.setPointerCapture(e.pointerId); } catch {}
    opts.onProgress({ edge, dragPx, threshold: EDGE_THRESHOLD_PX });
  }

  function onPointerCancel() {
    // A cancel means the browser took over (e.g. scroll) — abort, don't commit.
    reset();
  }

  function onPointerUp(e) {
    if (!active || e.pointerId !== pointerId) return;
    const dragPx = lastDx;
    const committed = dragPx >= EDGE_THRESHOLD_PX;
    if (committed && gestureClaimedRecently()) {
      // Drawer claimed the gesture; abort without firing onLeft/onRight.
      opts.onProgress({ edge, dragPx: 0, threshold: EDGE_THRESHOLD_PX });
      reset();
      return;
    }
    if (committed && edge === "left") opts.onRight(dragPx);
    else if (committed && edge === "right") opts.onLeft(dragPx);
    // Always emit a final 0-progress event so the consumer can reset its UI.
    opts.onProgress({ edge, dragPx: 0, threshold: EDGE_THRESHOLD_PX });
    reset();
  }

  function reset() {
    active = false;
    edge = null;
    lastDx = 0;
    pointerId = null;
  }

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("pointermove", onPointerMove);
  node.addEventListener("pointerup", onPointerUp);
  node.addEventListener("pointercancel", onPointerCancel);

  return {
    update(next) { opts = normalize(next); },
    destroy() {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerCancel);
    },
  };
}

/** Vertical flick (touch): fast, mostly-vertical swipe. Ignores
 *  gestures that start in the horizontal edge zones (edge swipes own
 *  those) or inside ignoreSelector matches (scrollables own their own
 *  vertical motion). */
export function verticalFlick(node, params = {}) {
  let opts = { enabled: () => true, ignoreSelector: null, ...params };
  let startX = 0, startY = 0, startT = 0, ignore = false;

  function onTouchStart(e) {
    const t = e.touches?.[0];
    if (!t) return;
    startX = t.clientX;
    startY = t.clientY;
    startT = Date.now();
    const inEdgeZone = t.clientX <= EDGE_ZONE_PX ||
      t.clientX >= window.innerWidth - EDGE_ZONE_PX;
    ignore = inEdgeZone ||
      !!(opts.ignoreSelector && e.target instanceof Element &&
         e.target.closest(opts.ignoreSelector));
  }

  function onTouchEnd(e) {
    if (ignore || !opts.enabled()) return;
    const t = e.changedTouches?.[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startT;
    if (dt > FLICK_T_MAX_MS) return;
    if (Math.abs(dx) > FLICK_X_MAX_PX) return;
    if (Math.abs(dy) < FLICK_Y_MIN_PX) return;
    if (dy < 0) opts.onUp?.();
    else opts.onDown?.();
  }

  node.addEventListener("touchstart", onTouchStart, { passive: true });
  node.addEventListener("touchend", onTouchEnd, { passive: true });
  return {
    update(next) { opts = { enabled: () => true, ignoreSelector: null, ...next }; },
    destroy() {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchend", onTouchEnd);
    },
  };
}

/** Sheet drag-to-dismiss verdict: commit when the drag passed 30% of the
 *  sheet's height, or was a fast downward flick (> 0.5 px/ms). Upward
 *  drags never dismiss. */
export function sheetDismissVerdict({ dy, sheetHeight, dtMs }) {
  if (dy <= 0) return false;
  if (dy > sheetHeight * 0.3) return true;
  return dtMs > 0 && dy / dtMs > 0.5;
}

/** Drawer swipe (touch): left-edge swipe-right opens, swipe-left
 *  closes. `enabled` MUST verify a drawer actually exists — rendering
 *  a scrim over nothing was the old SidebarShell bug. */
export function drawerSwipe(node, params = {}) {
  let opts = { enabled: () => true, ...params };
  let startX = null;

  function onTouchStart(e) {
    if (!opts.enabled()) { startX = null; return; }
    startX = e.touches[0].clientX;
  }

  // Claim EARLY, mid-drag, rather than waiting for touchend. Real event
  // order is pointerdown → touchstart → moves interleaved → pointerup →
  // touchend, so a touchend-only claim arrives after edgeSwipe's pointerup
  // has already committed and both the drawer and the edge action fire.
  // Claiming here, the instant the commit condition is first satisfied,
  // lands the claim before pointerup because touchmove interleaves with
  // pointermove during the drag. claimGesture() is idempotent, so it's
  // fine to call it on every qualifying move.
  //
  // Trade-off: a drag that crosses the threshold and then retreats before
  // release will have already claimed the gesture, even though the drawer
  // never opens/closes. That suppresses edge-back for that one ambiguous
  // gesture — acceptable, since the alternative (claim only on commit) is
  // the too-late bug this fixes.
  function onTouchMove(e) {
    if (startX == null || !opts.enabled()) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - startX;
    if (!opts.isOpen() && startX < EDGE_ZONE_PX && dx > DRAWER_THRESHOLD_PX) {
      claimGesture();
    } else if (opts.isOpen() && dx < -DRAWER_THRESHOLD_PX) {
      claimGesture();
    }
  }

  function onTouchEnd(e) {
    if (startX == null || !opts.enabled()) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (!opts.isOpen() && startX < EDGE_ZONE_PX && dx > DRAWER_THRESHOLD_PX) {
      claimGesture(); // belt and braces — onTouchMove above already claimed
      opts.onOpen();
    } else if (opts.isOpen() && dx < -DRAWER_THRESHOLD_PX) {
      claimGesture();
      opts.onClose();
    }
    startX = null;
  }

  node.addEventListener("touchstart", onTouchStart, { passive: true });
  node.addEventListener("touchmove", onTouchMove, { passive: true });
  node.addEventListener("touchend", onTouchEnd, { passive: true });
  return {
    update(next) { opts = { enabled: () => true, ...next }; },
    destroy() {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
    },
  };
}
