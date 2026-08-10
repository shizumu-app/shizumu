import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  edgeSwipe, verticalFlick, drawerSwipe, sheetDismissVerdict,
  claimGesture, gestureClaimedRecently, _resetClaimForTests,
  EDGE_ZONE_PX, EDGE_THRESHOLD_PX, FLICK_Y_MIN_PX, SLIDE_SWIPE_PX,
  DRAWER_THRESHOLD_PX,
} from "./gestures.js";

function fireTouch(node, type, x, y) {
  const ev = new Event(type, { bubbles: true });
  const touch = { clientX: x, clientY: y };
  if (type === "touchend") ev.changedTouches = [touch];
  else ev.touches = [touch];
  node.dispatchEvent(ev);
}

function firePointer(node, type, x, y, id = 1) {
  const ev = new Event(type, { bubbles: true });
  ev.clientX = x;
  ev.clientY = y;
  ev.pointerId = id;
  ev.pointerType = "touch";
  node.dispatchEvent(ev);
}

let node;
beforeEach(() => {
  node = document.createElement("div");
  node.setPointerCapture = vi.fn();
  document.body.appendChild(node);
  Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
  _resetClaimForTests();
});
afterEach(() => node.remove());

describe("edgeSwipe", () => {
  it("commits back (onRight) for a left-edge drag past threshold", () => {
    const onRight = vi.fn();
    const action = edgeSwipe(node, { onRight, onLeft: vi.fn() });
    firePointer(node, "pointerdown", 10, 300);
    firePointer(node, "pointermove", 10 + EDGE_THRESHOLD_PX + 5, 300);
    firePointer(node, "pointerup", 10 + EDGE_THRESHOLD_PX + 5, 300);
    expect(onRight).toHaveBeenCalled();
    action.destroy();
  });

  it("gates each edge independently via enabled(edge)", () => {
    const onLeft = vi.fn();
    const action = edgeSwipe(node, {
      onLeft, onRight: vi.fn(),
      enabled: (edge) => edge !== "right", // right edge disabled
    });
    firePointer(node, "pointerdown", 395, 300); // right edge
    firePointer(node, "pointermove", 395 - EDGE_THRESHOLD_PX - 5, 300);
    firePointer(node, "pointerup", 395 - EDGE_THRESHOLD_PX - 5, 300);
    expect(onLeft).not.toHaveBeenCalled();
    action.destroy();
  });

  it("commits new-page (onLeft) for a right-edge drag past threshold", () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    // window.innerWidth stubbed to 400 in beforeEach — right edge zone starts
    // at innerWidth - EDGE_ZONE_PX.
    const startX = 400 - EDGE_ZONE_PX;
    const action = edgeSwipe(node, { onLeft, onRight });
    firePointer(node, "pointerdown", startX, 300);
    firePointer(node, "pointermove", startX - EDGE_THRESHOLD_PX - 5, 300);
    firePointer(node, "pointerup", startX - EDGE_THRESHOLD_PX - 5, 300);
    expect(onLeft).toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
    action.destroy();
  });

  it("reports onProgress with the drag distance while moving, then a final 0 on release", () => {
    const onProgress = vi.fn();
    const action = edgeSwipe(node, { onLeft: vi.fn(), onRight: vi.fn(), onProgress });
    const startX = 10;
    const moveDx = 30; // below threshold, just checking the protocol shape
    firePointer(node, "pointerdown", startX, 300);
    firePointer(node, "pointermove", startX + moveDx, 300);
    firePointer(node, "pointerup", startX + moveDx, 300);

    expect(onProgress).toHaveBeenCalledWith({
      edge: "left",
      dragPx: moveDx,
      threshold: EDGE_THRESHOLD_PX,
    });
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
    expect(lastCall[0]).toEqual({ edge: "left", dragPx: 0, threshold: EDGE_THRESHOLD_PX });
    action.destroy();
  });
});

describe("verticalFlick", () => {
  it("fires onUp for a fast upward flick", () => {
    const onUp = vi.fn();
    const action = verticalFlick(node, { onUp });
    fireTouch(node, "touchstart", 200, 400);
    fireTouch(node, "touchend", 200, 400 - FLICK_Y_MIN_PX - 10);
    expect(onUp).toHaveBeenCalled();
    action.destroy();
  });

  it("ignores flicks starting in the horizontal edge zones", () => {
    const onUp = vi.fn();
    const action = verticalFlick(node, { onUp });
    fireTouch(node, "touchstart", EDGE_ZONE_PX - 4, 400); // left edge zone
    fireTouch(node, "touchend", EDGE_ZONE_PX - 4, 300);
    expect(onUp).not.toHaveBeenCalled();
    action.destroy();
  });

  it("ignores flicks starting inside ignoreSelector targets", () => {
    const inner = document.createElement("div");
    inner.className = "tiptap-editor";
    node.appendChild(inner);
    const onUp = vi.fn();
    const action = verticalFlick(node, { onUp, ignoreSelector: ".tiptap-editor" });
    fireTouch(inner, "touchstart", 200, 400);
    fireTouch(inner, "touchend", 200, 300);
    expect(onUp).not.toHaveBeenCalled();
    action.destroy();
  });

  // Regression: Page.svelte wraps the whole writing surface (including any
  // open BottomSheet — date calendar, pages list, trail picker) in this
  // action. A fast vertical drag scrolling a sheet's body used to also
  // register as a swipe-to-memory flick, tearing the sheet down mid-scroll.
  // ".sheet" joined the multi-selector ignore list (Page.svelte's actual
  // callsite) to fix it — this locks the comma-joined selector still
  // matches per-class, not just the single-selector case above.
  it("ignores flicks starting inside a comma-joined ignoreSelector match (.sheet)", () => {
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    node.appendChild(sheet);
    const onUp = vi.fn();
    const action = verticalFlick(node, {
      onUp,
      ignoreSelector: ".tiptap-editor, .thread-scroll, .scrollable, .panel-list, .memory-list, .sheet, textarea, input",
    });
    fireTouch(sheet, "touchstart", 200, 400);
    fireTouch(sheet, "touchend", 200, 300);
    expect(onUp).not.toHaveBeenCalled();
    action.destroy();
  });
});

describe("drawerSwipe", () => {
  it("does nothing when disabled (no sidebar) — the phantom scrim fix", () => {
    const onOpen = vi.fn();
    const action = drawerSwipe(node, {
      onOpen, onClose: vi.fn(), isOpen: () => false, enabled: () => false,
    });
    fireTouch(node, "touchstart", 10, 300);
    fireTouch(node, "touchend", 90, 300);
    expect(onOpen).not.toHaveBeenCalled();
    action.destroy();
  });

  it("opens on a left-edge swipe-right when enabled", () => {
    const onOpen = vi.fn();
    const action = drawerSwipe(node, {
      onOpen, onClose: vi.fn(), isOpen: () => false, enabled: () => true,
    });
    fireTouch(node, "touchstart", 10, 300);
    fireTouch(node, "touchend", 90, 300);
    expect(onOpen).toHaveBeenCalled();
    action.destroy();
  });
});

describe("sheetDismissVerdict", () => {
  it("dismisses past 30% of sheet height", () => {
    expect(sheetDismissVerdict({ dy: 151, sheetHeight: 500, dtMs: 1000 })).toBe(true);
    expect(sheetDismissVerdict({ dy: 149, sheetHeight: 500, dtMs: 1000 })).toBe(false);
  });
  it("dismisses on a fast flick regardless of distance", () => {
    expect(sheetDismissVerdict({ dy: 60, sheetHeight: 500, dtMs: 100 })).toBe(true);
  });
  it("never dismisses upward or zero drags", () => {
    expect(sheetDismissVerdict({ dy: 0, sheetHeight: 500, dtMs: 100 })).toBe(false);
    expect(sheetDismissVerdict({ dy: -200, sheetHeight: 500, dtMs: 100 })).toBe(false);
  });
});

describe("gesture claim arbitration", () => {
  // Real browsers dispatch pointer events BEFORE touch events for one
  // physical gesture: pointerdown → touchstart → moves interleaved →
  // pointerup → touchend. These tests fire events in that order so they
  // actually exercise the race the arbitration code defends against.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("edgeSwipe aborts its commit when a drawer claimed the gesture mid-drag", () => {
    const onRight = vi.fn();
    const edgeAction = edgeSwipe(node, { onRight, onLeft: vi.fn() });
    const drawerAction = drawerSwipe(node, {
      onOpen: vi.fn(), onClose: vi.fn(), isOpen: () => false, enabled: () => true,
    });
    const dragX = 10 + EDGE_THRESHOLD_PX + 5;

    firePointer(node, "pointerdown", 10, 300);
    fireTouch(node, "touchstart", 10, 300);
    // Moves interleave; drawerSwipe's touchmove claims the instant its
    // own commit condition is met — before pointerup ever fires.
    firePointer(node, "pointermove", dragX, 300);
    fireTouch(node, "touchmove", dragX, 300);
    firePointer(node, "pointerup", dragX, 300);
    fireTouch(node, "touchend", dragX, 300);

    expect(onRight).not.toHaveBeenCalled();
    edgeAction.destroy();
    drawerAction.destroy();
  });

  it("a stale claim does not block a later gesture", () => {
    claimGesture();
    vi.advanceTimersByTime(500);
    expect(gestureClaimedRecently()).toBe(false);
  });

  it("drawerSwipe claims during the drag (touchmove), before touchend commits", () => {
    const action = drawerSwipe(node, {
      onOpen: vi.fn(), onClose: vi.fn(), isOpen: () => false, enabled: () => true,
    });
    fireTouch(node, "touchstart", 10, 300);
    fireTouch(node, "touchmove", 10 + DRAWER_THRESHOLD_PX + 5, 300);
    // Claimed already — before touchend, and before onOpen even fires.
    expect(gestureClaimedRecently()).toBe(true);
    action.destroy();
  });
});
