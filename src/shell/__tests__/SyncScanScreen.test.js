import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import SyncScanScreen from "../SyncScanScreen.svelte";
import { scannerNote } from "../scanner-lifecycle.js";

// THE DECODER IS MOCKED AND NOTHING ELSE IS. jsdom has no
// `navigator.mediaDevices`, so the one part of this path it genuinely
// cannot run is the part that opens a camera and reads pixels — and
// without standing in for it, the only observable behaviour left would be
// "the tap failed", which proves nothing about a stream being released
// because no stream ever existed.
//
// So this stands in for `@zxing/browser` at exactly the seam QrScanner
// uses it: `decodeFromConstraints` hands back a `controls` object with a
// `stop`, and calls a decode callback when a symbol lands. Everything
// above it is the real thing — QrScanner's own consent gate, its own
// `onDestroy`, the screen's listeners, `scanner-lifecycle`'s reducer. What
// this buys is the assertion the whole task turns on: `stop` was called,
// which is the camera actually being released rather than a component
// merely leaving the DOM.
const zxing = vi.hoisted(() => ({
  /** Set to a message to make opening the stream fail, which is what a
   *  refusal, an absent camera and a dead device all look like from
   *  QrScanner's side. */
  fail: null,
  stop: vi.fn(),
  /** QrScanner's decode callback, once the reader has been started. */
  emit: null,
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    async decodeFromConstraints(_constraints, _video, callback) {
      if (zxing.fail) throw new Error(zxing.fail);
      zxing.emit = callback;
      return { stop: zxing.stop };
    }
  },
}));

beforeEach(() => {
  zxing.fail = null;
  zxing.emit = null;
  zxing.stop = vi.fn();
});

afterEach(() => {
  cleanupAll();
  visible();
});

// jsdom's `document.visibilityState` is a getter with no setter, so
// redefining it is the only way to drive the real listener with a real
// event. Configurable, and put back after every test.
function setVisibility(value) {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
}
const hidden = () => {
  setVisibility("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  flushSync();
};
const visible = () => {
  setVisibility("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  flushSync();
};

// The borrowed component's own root. Its presence is what "a stream is
// allowed to exist" looks like from here: QrScanner opens the camera
// inside itself and stops it in its own onDestroy, so mounting it is this
// shell's only camera switch.
const camera = (target) => target.querySelector(".scanner");

/** Press QrScanner's own consent button and let its async start settle. */
async function startCamera(target) {
  camera(target).querySelector("button").click();
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

describe("SyncScanScreen", () => {
  it("is a screen with the same back every other pushed screen has", () => {
    // §2 says "full-screen camera with its own back". Its own back is
    // NavBar's, calling the same onBack the edge flick, Esc and the
    // Android system button all converge on through navstack — a private
    // exit here would be a second navigation beside the stack.
    const onBack = vi.fn();
    const { target } = render(SyncScanScreen, { onBack });
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("scan");
    target.querySelector(".shell-navbar-back").click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("opens on the camera, behind the borrowed component's own consent gate", () => {
    const { target } = render(SyncScanScreen, {});
    expect(camera(target)).not.toBeNull();
    // QrScanner does not call getUserMedia until this is pressed, which
    // is part of why the shell reuses it rather than opening a stream of
    // its own: the reader gets a sentence about why the camera is wanted
    // before the OS asks them anything.
    expect(camera(target).textContent).toContain("start camera");
  });
});

describe("SyncScanScreen — the camera it owns", () => {
  it("releases the stream when the screen is popped mid-scan", async () => {
    // The whole reason this screen is a decision rather than markup. A
    // pop removes the element from Stack's `entries`, which unmounts this
    // screen, which unmounts QrScanner, whose onDestroy stops the stream.
    // Hanging it on the mount is what makes every door work: the nav
    // bar's back, the edge flick, the system button, and `goRoot`
    // emptying the whole stack on a tab tap all remove the element, and
    // none of them has to know a camera existed.
    const { target, cleanup } = render(SyncScanScreen, {});
    await startCamera(target);
    expect(zxing.stop).not.toHaveBeenCalled();

    cleanup();

    expect(zxing.stop).toHaveBeenCalledOnce();
  });

  it("releases the stream when the app goes to the background", async () => {
    // Nothing unmounts when a WebView backgrounds. Without this listener
    // the lens stays on behind whatever app the writer switched to, and
    // the drain gets attributed to the phone rather than to a notebook.
    const { target } = render(SyncScanScreen, {});
    await startCamera(target);

    hidden();

    expect(zxing.stop).toHaveBeenCalledOnce();
    expect(camera(target)).toBeNull();
  });

  it("releases it on pagehide too, which android fires where visibilitychange does not", async () => {
    // installSyncFlushOnHide's finding (src/lib/sync-flush-on-hide.js):
    // pagehide covers app-switch and teardown paths visibilitychange can
    // miss. Wiring one of the two is how a camera survives exactly the
    // exit that matters.
    const { target } = render(SyncScanScreen, {});
    await startCamera(target);

    window.dispatchEvent(new Event("pagehide"));
    flushSync();

    expect(zxing.stop).toHaveBeenCalledOnce();
  });

  it("puts the camera back at its consent gate when the app returns", async () => {
    const { target } = render(SyncScanScreen, {});
    await startCamera(target);
    hidden();

    visible();

    expect(camera(target)).not.toBeNull();
    // Remounted, so the reader taps again rather than the lens coming
    // back on by itself. That is the cost of not editing a desktop
    // component to add a resume door, and it is the honest reading
    // anyway: the camera was off, and it goes back on when someone asks.
    expect(camera(target).textContent).toContain("start camera");
  });

  it("releases the stream the moment a code is read, before the host acts on it", async () => {
    const onRead = vi.fn();
    const { target } = render(SyncScanScreen, { onRead });
    await startCamera(target);

    zxing.emit({ getText: () => "the-payload" }, null);
    flushSync();

    expect(onRead).toHaveBeenCalledExactlyOnceWith("the-payload");
    expect(zxing.stop).toHaveBeenCalledOnce();
    expect(camera(target)).toBeNull();
  });

  it("ignores a decode frame that carried no symbol", async () => {
    // Not "nothing happens": QrScanner's callback fires on EVERY frame,
    // with a null result for the overwhelming majority of them. A screen
    // that treated a frame as a read would pop itself the instant the
    // camera opened.
    const onRead = vi.fn();
    const { target } = render(SyncScanScreen, { onRead });
    await startCamera(target);

    zxing.emit(null, new Error("NotFoundException"));
    flushSync();

    expect(onRead).not.toHaveBeenCalled();
    expect(camera(target)).not.toBeNull();
  });
});

describe("SyncScanScreen — when the camera will not open", () => {
  it("says the phone's own sentence, not the desktop's", async () => {
    // QrScanner renders its own message on this error, and its message
    // names the "type words" TAB — which exists in SyncSettings.svelte
    // and nowhere in this tree. Unmounting it on the error is what keeps
    // an instruction a phone cannot follow off the phone.
    zxing.fail = "NotAllowedError: Permission denied";
    const { target } = render(SyncScanScreen, {});

    await startCamera(target);

    expect(camera(target)).toBeNull();
    expect(target.textContent).not.toContain("type words");
    expect(target.querySelector(".shell-note").textContent.trim()).toBe(scannerNote("refused"));
  });

  it("names the fix for a refusal, which on android is the expected first answer", async () => {
    // Nothing in this repo grants the Android WebView its camera
    // permission — there is no AndroidManifest.xml in the tree and no
    // onPermissionRequest handling; the only grant that exists is the
    // Linux webkit2gtk hook in src-tauri/src/lib.rs. So this sentence is
    // the common case on the platform P4's gate is a device pass for.
    zxing.fail = "NotAllowedError";
    const { target } = render(SyncScanScreen, {});

    await startCamera(target);

    expect(target.querySelector(".shell-note").textContent).toContain("system settings");
  });

  it("tells a missing camera from a refused one", async () => {
    zxing.fail = "NotFoundError: no device";
    const { target } = render(SyncScanScreen, {});

    await startCamera(target);

    expect(target.querySelector(".shell-note").textContent.trim()).toBe(scannerNote("absent"));
  });

  it("lets a failure be retried after a trip to system settings", async () => {
    // The recovery the refusal sentence sends the reader on. Leaving the
    // app to grant the permission and coming back has to arrive at a
    // scanner that can try again, not at a frozen apology over a camera
    // that would now work.
    zxing.fail = "NotAllowedError";
    const { target } = render(SyncScanScreen, {});
    await startCamera(target);
    expect(camera(target)).toBeNull();

    hidden();
    zxing.fail = null;
    visible();

    expect(camera(target)).not.toBeNull();
    await startCamera(target);
    expect(zxing.emit).not.toBeNull();
  });
});

describe("SyncScanScreen — what this file cannot prove", () => {
  it("takes its listeners with it when it leaves", () => {
    // A pop unmounts this screen. A listener that outlived it would keep
    // a destroyed component's state machine running on every app switch
    // for the rest of the session.
    const { cleanup } = render(SyncScanScreen, {});
    // The listener is attached from onMount, which Svelte schedules as an
    // effect — without the flush this spy is installed before the
    // subscription exists and would report an empty teardown whether the
    // screen cleaned up or not.
    flushSync();
    const removed = [];
    const spy = vi
      .spyOn(document, "removeEventListener")
      .mockImplementation((type) => removed.push(type));
    cleanup();
    spy.mockRestore();
    expect(removed).toContain("visibilitychange");
  });

  it("still finds a stop for the stream in the component it borrows", () => {
    // Said plainly, because the mock at the top of this file is what
    // makes every `stop` assertion above possible: the release runs
    // through QrScanner's own onDestroy, in a file this branch may not
    // edit, and a mocked `controls` is not a camera. What the mock proves
    // is that the SHELL reaches the stop on every path it owns; what it
    // cannot prove is that stopping those controls stops a real lens.
    //
    // This is the other half — the line existing at all — guarded as text
    // the way shell-rules.test.js guards the stack entry's background, and
    // for the same reason: to stop the one line that matters being
    // deleted as redundant by someone whose suite also cannot see it. The
    // rest is a device.
    const qrScanner = readFileSync("src/components/QrScanner.svelte", "utf8");
    const teardown = qrScanner.slice(qrScanner.indexOf("onDestroy("));
    expect(teardown, "QrScanner no longer stops its stream on destroy").toMatch(
      /controls\?\.stop\(\)/,
    );
  });
});
