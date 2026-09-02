import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { DEMO_STORAGE_KEY, parse, serialize } from "./persistence.js";
import { SEED_VERSION } from "./fixture.js";

// A minimal Storage-shaped in-memory fake, same shape persistence.test.js
// uses — not jsdom's real localStorage, so a test can inspect exactly what
// was written without depending on jsdom's own implementation quirks.
function fakeStorage() {
  const map = {};
  return {
    getItem(k) { return k in map ? map[k] : null; },
    setItem(k, v) { map[k] = v; },
    removeItem(k) { delete map[k]; },
    _map: map,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
  document.body.innerHTML = "";
  delete window.__DEMO_INVOKE__;
  delete window.__DEMO__;
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

function docWithText(text) {
  return JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
}

// jsdom's window.location.reload throws "Cannot assign to read only
// property" on a plain assignment (Location's own reload is non-writable),
// and calling the real one logs "Not implemented: navigation" - stubbing it
// this way is what lets a test both call the real onStartOver and assert the
// reload actually happened.
function stubReload() {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload },
    writable: true,
    configurable: true,
  });
  return reload;
}

// DemoStrip renders two buttons whose text is both "start over" (the pill
// that opens the confirm dialog, and the dialog's own confirm button) - the
// dialog's Modal wrapper is the only thing distinguishing them.
function startOverButton(root, { inDialog }) {
  return Array.from(root.querySelectorAll("button")).find(
    (b) => b.textContent.trim() === "start over" && Boolean(b.closest('[role="dialog"]')) === inDialog
  );
}

/** Drives the real UI path: open the confirm dialog, then confirm - the same
 *  two clicks a visitor makes, and the path the Modal/navstack race (fixed
 *  in 60523234) actually runs through. */
async function clickStartOver(host) {
  startOverButton(host, { inDialog: false }).click();
  await tick();
  startOverButton(host, { inDialog: true }).click();
  await tick();
}

describe("bootstrapDemo — flush on unload", () => {
  it("writes a pending save to storage on pagehide, without the debounce timer ever firing", async () => {
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();

    const { bootstrapDemo } = await import("./bootstrap.js");
    await bootstrapDemo();

    const { page } = await window.__DEMO_INVOKE__("get_or_create_today", {});
    // A mutating call — this is what arms scheduleSave()'s 500ms timer.
    await window.__DEMO_INVOKE__("save_page_content", {
      pageId: page.id,
      contentJson: docWithText("quick edit before reload"),
    });

    // The tab goes away right now — well inside the 500ms debounce window.
    // Fake timers are never advanced: if this test passes only because a
    // timer fired, that is a bug in the test, not proof of the fix.
    window.dispatchEvent(new Event("pagehide"));

    const raw = storage.getItem(DEMO_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const { data } = parse(raw);
    const flushed = data.pages.find(([key]) => key === `${page.date}-${page.page_number}`)?.[1];
    expect(flushed?.content_json).toContain("quick edit before reload");
  });

  // This is the actual bug report, reproduced. bootstrapDemo() registers its
  // pagehide/visibilitychange listeners before mount(App) ever runs, so
  // TipTapEditor's own listener (TipTapEditor.svelte's handleHide, wired to
  // both events around line 373-374) is always registered SECOND and fires
  // AFTER ours. handleHide calls flushSave() fire-and-forget, unawaited -
  // an event handler that cannot await and still guarantee ordering. The
  // test above awaits its mutating call before dispatching, which makes
  // `lastSnapshot` fresh by construction and cannot exercise this: it would
  // stay green even with the listener-order bug the fix addresses. This one
  // models the real sequence: a SECOND listener, registered after
  // bootstrap's own (matching real registration order), that mutates
  // through window.__DEMO_INVOKE__ WITHOUT awaiting it, exactly like
  // handleHide does.
  it("catches a same-turn mutation that arrives from a second, later-registered, un-awaited pagehide listener", async () => {
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();

    const { bootstrapDemo } = await import("./bootstrap.js");
    await bootstrapDemo();

    const { page } = await window.__DEMO_INVOKE__("get_or_create_today", {});

    // Registered strictly after bootstrapDemo()'s own pagehide listener -
    // same order real code has (mount(App), and therefore TipTapEditor,
    // only happens after bootstrapDemo() has already returned).
    window.addEventListener("pagehide", () => {
      // Deliberately not awaited - this is the part a real event handler
      // cannot do differently.
      window.__DEMO_INVOKE__("save_page_content", {
        pageId: page.id,
        contentJson: docWithText("typed right as the tab closed"),
      });
    });

    // dispatchEvent runs both listeners synchronously, in registration
    // order: bootstrap's flushNow() first (against the OLD snapshot),
    // then the listener above (the new edit, unawaited). Not advancing
    // fake timers - if this only passes because a timer fires, the fix
    // didn't actually change anything.
    window.dispatchEvent(new Event("pagehide"));

    const raw = storage.getItem(DEMO_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const { data } = parse(raw);
    const flushed = data.pages.find(([key]) => key === `${page.date}-${page.page_number}`)?.[1];
    expect(flushed?.content_json).toContain("typed right as the tab closed");
  });

  it("writes on visibilitychange -> hidden too, for browsers that never fire pagehide", async () => {
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();

    const { bootstrapDemo } = await import("./bootstrap.js");
    await bootstrapDemo();

    const { page } = await window.__DEMO_INVOKE__("get_or_create_today", {});
    await window.__DEMO_INVOKE__("update_what_matters_now", { pageId: page.id, text: "backgrounded mid-thought" });

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    const raw = storage.getItem(DEMO_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const { data } = parse(raw);
    const flushed = data.pages.find(([key]) => key === `${page.date}-${page.page_number}`)?.[1];
    expect(flushed?.what_matters_now).toBe("backgrounded mid-thought");
  });

  // Same reproduction as the pagehide race above, but for visibilitychange:
  // TipTapEditor's handleHide is wired to BOTH events (TipTapEditor.svelte
  // line 373), so the identical ordering bug applies there too.
  it("catches a same-turn mutation that arrives from a second, later-registered, un-awaited visibilitychange listener", async () => {
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();

    const { bootstrapDemo } = await import("./bootstrap.js");
    await bootstrapDemo();

    const { page } = await window.__DEMO_INVOKE__("get_or_create_today", {});

    document.addEventListener("visibilitychange", () => {
      window.__DEMO_INVOKE__("update_what_matters_now", {
        pageId: page.id,
        text: "backgrounded mid-keystroke",
      });
    });

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    const raw = storage.getItem(DEMO_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const { data } = parse(raw);
    const flushed = data.pages.find(([key]) => key === `${page.date}-${page.page_number}`)?.[1];
    expect(flushed?.what_matters_now).toBe("backgrounded mid-keystroke");
  });

  it("does not yet have the edit in storage before the timer or an unload event fires", async () => {
    // Companion to the tests above: proves the debounce path really is
    // still debounced during normal use, so "flush on unload" isn't
    // secretly writing synchronously on every keystroke instead.
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();

    const { bootstrapDemo } = await import("./bootstrap.js");
    await bootstrapDemo();

    const { page } = await window.__DEMO_INVOKE__("get_or_create_today", {});
    await window.__DEMO_INVOKE__("update_what_matters_now", { pageId: page.id, text: "still just typed" });

    const raw = storage.getItem(DEMO_STORAGE_KEY);
    const { data } = parse(raw);
    const stillOld = data.pages.find(([key]) => key === `${page.date}-${page.page_number}`)?.[1];
    expect(stillOld?.what_matters_now).not.toBe("still just typed");
  });

  it("goes back to debounced writes after pageshow (a page restored from bfcache, not actually closed)", async () => {
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();

    const { bootstrapDemo } = await import("./bootstrap.js");
    await bootstrapDemo();

    const { page } = await window.__DEMO_INVOKE__("get_or_create_today", {});
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));

    await window.__DEMO_INVOKE__("update_what_matters_now", { pageId: page.id, text: "typed after returning" });

    const raw = storage.getItem(DEMO_STORAGE_KEY);
    const { data } = parse(raw);
    const stillOld = data.pages.find(([key]) => key === `${page.date}-${page.page_number}`)?.[1];
    // Back to debounced: this edit should NOT have been written yet.
    expect(stillOld?.what_matters_now).not.toBe("typed after returning");
  });

  // Same coverage as the pageshow test above, but for the other reset path:
  // visibilitychange -> "visible" (mobile backgrounding, then returning to
  // the tab) has to clear `unloading` too, or every mutation for the rest of
  // that session keeps writing synchronously instead of debouncing. Only the
  // pagehide/pageshow pair had a test before this one.
  it("goes back to debounced writes after visibilitychange -> visible (backgrounded, then returned to)", async () => {
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    vi.useFakeTimers();

    const { bootstrapDemo } = await import("./bootstrap.js");
    await bootstrapDemo();

    const { page } = await window.__DEMO_INVOKE__("get_or_create_today", {});

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    await window.__DEMO_INVOKE__("update_what_matters_now", { pageId: page.id, text: "typed after returning" });

    const raw = storage.getItem(DEMO_STORAGE_KEY);
    const { data } = parse(raw);
    const stillOld = data.pages.find(([key]) => key === `${page.date}-${page.page_number}`)?.[1];
    // Back to debounced: this edit should NOT have been written yet.
    expect(stillOld?.what_matters_now).not.toBe("typed after returning");
  });
});

describe("bootstrapDemo — a stored payload that parses but is structurally wrong", () => {
  it("falls back to the fixture instead of throwing out of bootstrapDemo()", async () => {
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    // Parses fine, and the version matches - readStored's own two guards
    // both pass this through. What breaks it is one level deeper:
    // __demo_import does `new Map(d.pages || [])`, and a number is not
    // iterable, so that throws a TypeError the moment bootstrapDemo() tries
    // to restore it.
    storage.setItem(DEMO_STORAGE_KEY, serialize(SEED_VERSION, { pages: 42 }));
    vi.stubGlobal("localStorage", storage);

    const { bootstrapDemo } = await import("./bootstrap.js");
    // The throw must not escape - a rejection here is exactly the bug:
    // main.js's own .catch would paint "bootstrap failed: ..." into #app
    // and DemoStrip would never mount.
    await expect(bootstrapDemo()).resolves.toBeUndefined();

    // Booted to a seeded workspace, not an empty one: the fixture's own
    // "book" lineage is there.
    const lineages = await window.__DEMO_INVOKE__("get_lineages", {});
    expect(lineages.map((l) => l.name)).toContain("book");
  });

  it("overwrites the bad payload in storage with the reseeded snapshot", async () => {
    // Companion to the test above: without this, the corrupt payload sits
    // in storage until some later mutation happens to save over it, and a
    // reload before that point hits the exact same throw again.
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    storage.setItem(DEMO_STORAGE_KEY, serialize(SEED_VERSION, { pages: 42 }));
    vi.stubGlobal("localStorage", storage);

    const { bootstrapDemo } = await import("./bootstrap.js");
    await bootstrapDemo();

    const raw = storage.getItem(DEMO_STORAGE_KEY);
    const { data } = parse(raw);
    expect(Array.isArray(data.pages)).toBe(true);
    expect(data.pages.length).toBeGreaterThan(0);
  });
});

// Both cases guard the `resetting` flag itself, which shipped (commits
// 60523234, 37aa549a) with no unit test at all - only manual, instrumented
// runs. Driven through the real DemoStrip UI (clickStartOver), the same path
// a visitor uses, rather than calling onStartOver as a bare function - the
// bug this exists to catch was a race between two things wired to real DOM
// events (Modal's own $effect on close, and bootstrap's own pagehide
// listener), and a direct function call cannot exercise either.
describe("bootstrapDemo — the resetting flag", () => {
  it("after onStartOver runs, a subsequent pagehide leaves storage cleared", async () => {
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const reload = stubReload();

    const { bootstrapDemo } = await import("./bootstrap.js");
    await bootstrapDemo();

    const { page } = await window.__DEMO_INVOKE__("get_or_create_today", {});
    await window.__DEMO_INVOKE__("save_page_content", {
      pageId: page.id,
      contentJson: docWithText("this should not survive start over"),
    });
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeTruthy();

    const host = document.getElementById("demo-chrome");
    await clickStartOver(host);

    expect(reload).toHaveBeenCalledOnce();
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();

    // The reload itself is what fires this pagehide in the real browser -
    // without `resetting` latched, flushNow() would write `lastSnapshot`
    // (the pre-reset content) right back into the storage clearStored() just
    // emptied, moments before the reloaded page reads it back.
    window.dispatchEvent(new Event("pagehide"));
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });

  it("a debounce timer armed before onStartOver must not write after it", async () => {
    vi.stubEnv("VITE_DEMO", "1");
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    stubReload();
    vi.useFakeTimers();

    const { bootstrapDemo } = await import("./bootstrap.js");
    await bootstrapDemo();

    const { page } = await window.__DEMO_INVOKE__("get_or_create_today", {});

    // Deliberately NOT bootstrap's own saveTimer: this models TipTapEditor's
    // separate, longer debounce (its own debouncedSave, 1000ms - see the
    // "keeps what you wrote" comment in tests/demo/demo.spec.js for the two
    // stacked debounces), which reaches window.__DEMO_INVOKE__ - and so
    // arms bootstrap's saveTimer - only once IT fires. The edit happened
    // before start over; the write this eventually attempts does not.
    // onStartOver's clearTimeout(saveTimer) runs against whatever saveTimer
    // holds at click time (nothing, here) and has no way to reach a timer
    // that does not exist yet - only `resetting` can stop what this arms
    // once it does.
    setTimeout(() => {
      window.__DEMO_INVOKE__("save_page_content", {
        pageId: page.id,
        contentJson: docWithText("typed right before start over"),
      });
    }, 1000);

    const host = document.getElementById("demo-chrome");
    await clickStartOver(host);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();

    // The editor's own timer fires now - which calls __DEMO_INVOKE__, which
    // arms a brand new saveTimer via scheduleSave(). Not written yet: that
    // new timer's own 500ms hasn't elapsed.
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();

    // And now the new timer itself fires. Without `resetting`, this is
    // exactly the write that resurrects the pre-reset content.
    await vi.advanceTimersByTimeAsync(600);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });
});
