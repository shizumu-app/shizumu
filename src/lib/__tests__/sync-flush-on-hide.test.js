import { describe, it, expect, vi } from "vitest";
import { installSyncFlushOnHide } from "../sync-flush-on-hide.js";

// Minimal fake document/window — real EventTarget so addEventListener/
// dispatchEvent behave exactly like the DOM, with a mutable
// `visibilityState` the fake document doesn't otherwise expose.
function fakeDoc(initialVisibility = "visible") {
  const target = new EventTarget();
  target.visibilityState = initialVisibility;
  return target;
}

describe("installSyncFlushOnHide", () => {
  it("calls syncFlushNow when visibilitychange fires with the doc hidden", () => {
    const syncFlushNow = vi.fn(() => Promise.resolve());
    const doc = fakeDoc("visible");
    const win = new EventTarget();
    installSyncFlushOnHide({ syncFlushNow, doc, win });

    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));

    expect(syncFlushNow).toHaveBeenCalledTimes(1);
  });

  it("does NOT call syncFlushNow when visibilitychange fires with the doc still visible", () => {
    const syncFlushNow = vi.fn(() => Promise.resolve());
    const doc = fakeDoc("visible");
    const win = new EventTarget();
    installSyncFlushOnHide({ syncFlushNow, doc, win });

    // e.g. a spurious/compat visibilitychange firing while the page is
    // still in the foreground — must not trigger a flush.
    doc.dispatchEvent(new Event("visibilitychange"));

    expect(syncFlushNow).not.toHaveBeenCalled();
  });

  it("calls syncFlushNow on pagehide regardless of visibilityState", () => {
    const syncFlushNow = vi.fn(() => Promise.resolve());
    const doc = fakeDoc("visible");
    const win = new EventTarget();
    installSyncFlushOnHide({ syncFlushNow, doc, win });

    win.dispatchEvent(new Event("pagehide"));

    expect(syncFlushNow).toHaveBeenCalledTimes(1);
  });

  it("never lets a rejected syncFlushNow escape as an unhandled rejection", async () => {
    const syncFlushNow = vi.fn(() => Promise.reject(new Error("ipc gone")));
    const doc = fakeDoc("visible");
    const win = new EventTarget();
    installSyncFlushOnHide({ syncFlushNow, doc, win });

    doc.visibilityState = "hidden";
    expect(() => doc.dispatchEvent(new Event("visibilitychange"))).not.toThrow();
    // Let the rejected promise's microtask settle; a missing .catch would
    // surface as an unhandledRejection on the test process, not a thrown
    // error here — this just proves the call completes without one.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("teardown removes both listeners", () => {
    const syncFlushNow = vi.fn(() => Promise.resolve());
    const doc = fakeDoc("hidden");
    const win = new EventTarget();
    const teardown = installSyncFlushOnHide({ syncFlushNow, doc, win });

    teardown();
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("pagehide"));

    expect(syncFlushNow).not.toHaveBeenCalled();
  });
});
