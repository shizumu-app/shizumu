import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import ShellApp from "../ShellApp.svelte";

// THE PLATFORM SEAM'S FIRST CALLER, from the app.
//
// `platformProfile` was written, documented and unit-tested in P1 and read
// by nothing until this file's subject landed, so every profile field was a
// fact the shell held and never acted on. The one that cost something is
// `edgeBackArmed`: Android gesture navigation owns BOTH screen edges, and a
// shell-drawn edge back competes with the system's — which is exactly how
// that gesture swung between firing on every scroll and never firing at all
// across the v0.6.x releases (§1, "Removed"). ANDROID's profile has said
// `edgeBackArmed: false` the whole time; nothing read it.
//
// TWO MECHANISMS CAN HIDE EACH OTHER, which is why the regression is held
// in two places rather than one. `ShellRoot` decides who OWNS an edge
// stroke and `Stack` decides whether the screen follows the finger; both
// default the flag to `true`, independently, so a probe of either alone
// stays green while the other stays armed. THIS file holds ShellRoot's
// half — the router's answer for an edge stroke — and ShellApp.test.js
// holds Stack's ("leaves the same edge flick to the system inside the
// Android app"), where the pushed-screen machinery already lives.
//
// It is a file of its own because ShellRoot's half can only be seen through
// the ownership table's INPUTS. Both of its answers here — "back" and
// "system" — are owners `routeGesture` deliberately performs nothing for
// (Stack performs back; the OS performs system), so nothing in the DOM
// separates them and no assertion on the app's own state can tell the two
// apart. Recording the call is the only honest way to watch that prop
// arrive.

// gesture-owner.js, WRAPPED rather than replaced: every call runs the real
// table and returns the real answer, and the wrapper only writes down what
// it was asked. A hand-written stub would let this file pass with the table
// deleted; `EDGE_PX` comes through the spread untouched, which matters
// because Stack imports it from the same module.
const seen = vi.hoisted(() => []);
vi.mock("../gesture-owner.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    gestureOwner: (g) => {
      const owner = actual.gestureOwner(g);
      seen.push({ ...g, owner });
      return owner;
    },
  };
});

// The backend, mocked at the module boundary for ShellApp.test.js's reason:
// api.js would otherwise fall through to its in-memory mock invoke, and a
// save scheduled by a real editor against an undefined command lands as an
// unhandled rejection after the test that caused it has finished.
const api = vi.hoisted(() => ({
  getOrCreateToday: vi.fn(),
  getPageCountForDate: vi.fn(() => Promise.resolve(1)),
  getLineages: vi.fn(() => Promise.resolve([])),
  getThread: vi.fn(() => Promise.resolve([])),
  getFocusesForDate: vi.fn(() => Promise.resolve([])),
  getPage: vi.fn(() => Promise.resolve(null)),
  createNewPage: vi.fn(() => Promise.resolve(null)),
  createLineage: vi.fn(() => Promise.resolve(null)),
  setFocusLineage: vi.fn(() => Promise.resolve()),
  getCarryForwardPins: vi.fn(() => Promise.resolve([])),
  savePageContent: vi.fn(() => Promise.resolve()),
  saveTrailContent: vi.fn(() => Promise.resolve()),
  createPin: vi.fn(() => Promise.resolve({ id: "pin-1" })),
  getPins: vi.fn(() => Promise.resolve([])),
  attachmentAddBytes: vi.fn(() => Promise.resolve({})),
  updatePinContent: vi.fn(() => Promise.resolve()),
  updatePinStatus: vi.fn(() => Promise.resolve()),
  updatePinAutoInsert: vi.fn(() => Promise.resolve()),
  deletePin: vi.fn(() => Promise.resolve()),
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
  searchPages: vi.fn(() => Promise.resolve([])),
  searchPagesForMention: vi.fn(() => Promise.resolve([])),
  searchPinsForMention: vi.fn(() => Promise.resolve([])),
  syncStatus: vi.fn(() =>
    Promise.resolve({ configured: false, enabled: false, revoked: false, device_id: null }),
  ),
  listDevices: vi.fn(() => Promise.resolve([])),
  pairExistingStart: vi.fn(() => Promise.resolve({ pair_token: "a", qr_payload: "{}" })),
  pairExistingFetchSas: vi.fn(() => Promise.reject(new Error("404"))),
  pairExistingConfirm: vi.fn(() => Promise.resolve()),
  pairNewJoin: vi.fn(() => Promise.resolve({ sas: "1234" })),
  pairNewComplete: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../lib/api.js", () => api);

// Tauri's Android WebView, verbatim. `wv` is what marks it as an embedded
// WebView rather than Chrome; `Android` is the token the reader keys off.
const ANDROID_WEBVIEW_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.101 " +
  "Mobile Safari/537.36";

/** Make this environment look like the Tauri Android app to the seam: a
 *  Tauri window and the WebView's own user agent, which are the two facts
 *  `currentPlatformProfile` reads. Restored by the caller — a leaked
 *  Android window would disarm the edge for every later test in the file,
 *  and the web control below would then pass for the wrong reason. */
function asAndroidApp() {
  window.__TAURI_INTERNALS__ = {};
  Object.defineProperty(navigator, "userAgent", {
    value: ANDROID_WEBVIEW_UA,
    configurable: true,
  });
  return () => {
    delete window.__TAURI_INTERNALS__;
    // Deletes the own property and uncovers the prototype accessor jsdom
    // defines, which is the real restore — assigning back the old string
    // would leave a shadowing own property behind.
    delete navigator.userAgent;
  };
}

// A real pointer event with a real timestamp — ShellRoot.test.js's helper,
// for its reason: jsdom stamps an event at construction, so a stroke built
// in one synchronous statement lands on a single millisecond and every
// velocity the recogniser reports comes out 0.
function pointer(type, { x, y, t, id = 1 }) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: id,
  });
  Object.defineProperty(event, "timeStamp", { value: t, configurable: true });
  return event;
}

function stroke(from, pts) {
  from.dispatchEvent(pointer("pointerdown", pts[0]));
  for (const p of pts.slice(1, -1)) from.dispatchEvent(pointer("pointermove", p));
  from.dispatchEvent(pointer("pointerup", pts[pts.length - 1]));
  flushSync();
}

/** A drag right, starting inside EDGE_PX of x=0. The same shape
 *  ShellRoot.test.js and ShellApp.test.js both use for this gesture. */
const EDGE_FLICK = [
  { x: 4, y: 300, t: 0 },
  { x: 160, y: 304, t: 40 },
  { x: 320, y: 308, t: 80 },
];

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

/** What the router asked the table about the edge stroke. Filtered rather
 *  than read off the tail: a screen mounting or unmounting emits nothing
 *  here, but reading `at(-1)` would still be a claim about ordering that
 *  this test does not need to make. */
function edgeCalls() {
  return seen.filter((g) => g.atLeftEdge && g.gesture === "drag-right");
}

beforeEach(() => {
  seen.length = 0;
  api.getOrCreateToday.mockResolvedValue({
    page: { id: "p1", date: "2026-09-03", page_number: 1, lineage_id: null },
    lines: [],
    session_markers: [],
  });
});

afterEach(() => {
  cleanupAll();
  vi.restoreAllMocks();
});

describe("ShellApp — the platform seam reaches the gesture router", () => {
  it("arms the shell's own edge back on web", () => {
    // The control, and the reason the Android test below is not vacuous.
    // jsdom is a browser with no Tauri on it, so the seam answers with the
    // WEB profile — which is the profile the whole existing suite has been
    // running on, and why wiring this changed no other test in the tree.
    const { target } = render(ShellApp, {});
    flushSync();

    stroke(target.querySelector(".shell-root"), EDGE_FLICK);

    expect(edgeCalls()).toHaveLength(1);
    expect(edgeCalls()[0].edgeBackArmed).toBe(true);
    expect(edgeCalls()[0].owner).toBe("back");
  });

  it("leaves the edge to the system inside the Android app", () => {
    // THE REGRESSION, ShellRoot's half. Byte-identical stroke to the
    // control above; the only difference is the platform underneath, and
    // the owner comes back opposite.
    //
    // "system" is not "nothing happens": Android's own back still fires,
    // and the shell's whole job at this edge is to stay out of its way.
    // What must not happen is the shell ALSO claiming the stroke.
    //
    // Delete `edgeBackArmed={platform.edgeBackArmed}` from `<ShellRoot>` in
    // ShellApp and this goes red on `true` / "back" — proven by doing it —
    // while Stack's half in ShellApp.test.js stays green, which is the
    // whole reason the pair exists.
    const restore = asAndroidApp();
    try {
      const { target } = render(ShellApp, {});
      flushSync();

      stroke(target.querySelector(".shell-root"), EDGE_FLICK);

      expect(edgeCalls()).toHaveLength(1);
      expect(edgeCalls()[0].edgeBackArmed).toBe(false);
      expect(edgeCalls()[0].owner).toBe("system");
    } finally {
      restore();
    }
  });

  it("reads the platform once, not per screen", async () => {
    // The module's own rule ("the ONLY place in src/shell/ that looks at
    // the OS") stated as behaviour rather than as prose: the app switches
    // roots, which unmounts one screen and mounts another, and the profile
    // that reaches the router must be the same one throughout. A second
    // reader somewhere downstream would show up here as an armed edge on a
    // screen the first read had disarmed.
    const restore = asAndroidApp();
    try {
      const { target } = render(ShellApp, {});
      await settle();

      stroke(target.querySelector(".shell-root"), EDGE_FLICK);
      target.querySelector('[data-tab-id="memory"]')?.click();
      await settle();
      stroke(target.querySelector(".shell-root"), EDGE_FLICK);

      expect(edgeCalls()).toHaveLength(2);
      expect(edgeCalls().map((g) => g.edgeBackArmed)).toEqual([false, false]);
    } finally {
      restore();
    }
  });
});
