// Runs before the Svelte app mounts, and only in a VITE_DEMO build.
//
// Everything below the build-time gate is dead code in a normal build, so
// Rollup drops the dynamic imports and never emits the demo chunks - absent
// from the app, not merely unreachable inside it. Same discipline as
// src/lib/vr/bootstrap.js, for the same reason.

function safeStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Blocked site data throws on property access, not on use.
    return null;
  }
}

export async function bootstrapDemo() {
  if (!import.meta.env.VITE_DEMO) return;

  const [api, fixture, persistence, unavailable, svelte, DemoStrip] = await Promise.all([
    import("../api.js"),
    import("./fixture.js"),
    import("./persistence.js"),
    import("./unavailable.js"),
    import("svelte"),
    import("./DemoStrip.svelte").then((m) => m.default),
  ]);

  const storage = safeStorage();
  const base = api.createMockInvoke();

  // readStored already guards unparseable JSON and a version mismatch, but
  // a payload that parses AND matches SEED_VERSION can still be structurally
  // wrong - `d.pages` (etc.) not an iterable of entries - which throws
  // inside __demo_import's `new Map(...)` calls. That throw must not escape
  // bootstrapDemo(): main.js's own .catch paints "bootstrap failed: ..."
  // into #app and rethrows, which never mounts DemoStrip - no start-over
  // button, so a visitor with a corrupted payload has no recovery short of
  // clearing site data by hand. Falling back to the fixture here is what
  // spec section 4.3 actually promises ("corrupt or unparseable JSON
  // reseeds from the fixture rather than throwing") - readStored only ever
  // covered the "unparseable" half of that sentence.
  const stored = persistence.readStored(storage, fixture.SEED_VERSION);
  let restored = false;
  if (stored) {
    try {
      await base("__demo_import", { data: stored });
      restored = true;
    } catch {
      restored = false;
    }
  }
  if (!restored) {
    await fixture.seedDemo(base, new Date());
  }

  let canPersist = storage !== null;
  let saveTimer = null;
  // Set once the page is actually on its way out (pagehide, or
  // visibilitychange -> hidden) and cleared again if it comes back
  // (pageshow from bfcache, or visibilitychange -> visible). While it's
  // true, every mutation below writes to storage immediately instead of
  // debouncing - see window.__DEMO_INVOKE__ and the comment on `unloading`
  // below for why that specifically is what closes the race.
  let unloading = false;
  // Set once, by "start over", and never cleared - the reload it triggers
  // discards this whole JS instance, so there is no "coming back" state to
  // return it to. Where `unloading` exists to make a LATE write LAND (don't
  // lose an edit the visitor is walking away from), `resetting` exists to
  // make a late write NOT LAND: a save already in flight when the reset
  // happens - the debounce timer, or the pagehide flush the reload itself
  // triggers - would otherwise resurrect exactly the content clearStored()
  // just told storage to forget, moments before the reloaded page reads
  // storage back. Every write path below checks it.
  let resetting = false;

  // base's own switch body (createMockInvoke, src/lib/api.js) has no
  // internal awaits: every case applies its mutation to the store
  // SYNCHRONOUSLY, the instant the case runs - only the wrapping in a
  // Promise (because the function is declared `async`) is deferred. So
  // `base.__demoSnapshot()` - a plain synchronous function attached to the
  // invoke function - always returns the current, fully up-to-date store,
  // callable the moment after `base(cmd, args)` has been CALLED (not
  // necessarily awaited). That is what makes the code below able to keep
  // `lastSnapshot` genuinely current with zero microtask lag, and what
  // makes flushNow()'s write a plain synchronous localStorage.setItem.
  let lastSnapshot = base.__demoSnapshot();

  function writeSnapshot(snapshot) {
    if (!canPersist || snapshot === null || resetting) return;
    // A false return means the quota is gone. The demo keeps running in
    // memory rather than throwing out of somebody's keystroke.
    canPersist = persistence.writeStored(storage, fixture.SEED_VERSION, snapshot);
  }

  function saveNow() {
    writeSnapshot(lastSnapshot);
  }

  function scheduleSave() {
    if (!canPersist) return;
    clearTimeout(saveTimer);
    // Debounced, and off the typing path on purpose: a synchronous write per
    // keystroke is exactly what the 50k-word latency target would notice.
    saveTimer = setTimeout(saveNow, 500);
  }

  // The emergency exit: writes `lastSnapshot` right now, synchronously, no
  // awaiting, and arms `unloading` so any mutation still to come in this
  // same unload sequence also writes immediately rather than debouncing.
  //
  // That second part is the actual fix, not the write itself. TipTapEditor
  // has its own pagehide listener (TipTapEditor.svelte, around line 823)
  // that flushes its pending save fire-and-forget, unawaited - and because
  // this bootstrap runs and registers its own pagehide listener before
  // mount(App), OUR listener fires first, before the editor's save has
  // even been called. A single flush here, alone, would durably write the
  // store as it stood BEFORE that last edit arrived - exactly the failure
  // this exists to fix, just moved one layer down. What actually closes it:
  // the editor's later save still reaches window.__DEMO_INVOKE__ below in
  // this same synchronous dispatch, and because `unloading` is already
  // true by then, that call writes the fresh snapshot out immediately
  // instead of scheduling.
  function flushNow() {
    // A reset is already in flight (onStartOver already set this before
    // this pagehide/visibilitychange could ever fire): nothing here is
    // wanted. writeSnapshot() below would already refuse the write on its
    // own `resetting` check, but returning before even touching `unloading`
    // keeps this function's own job legible without having to trace into
    // writeSnapshot to know it is a no-op right now.
    if (resetting) return;
    unloading = true;
    clearTimeout(saveTimer);
    saveTimer = null;
    writeSnapshot(lastSnapshot);
  }

  if (typeof window !== "undefined") {
    // Covers normal navigation, tab close, and reload in desktop browsers.
    window.addEventListener("pagehide", flushNow);
    // A page pagehide put into the back/forward cache (rather than actually
    // discarded) can come back to life via pageshow - go back to debounced
    // writes rather than staying in synchronous-write mode for the rest of
    // that session.
    window.addEventListener("pageshow", () => { unloading = false; });
  }
  if (typeof document !== "undefined") {
    // Mobile browsers routinely never fire pagehide at all — backgrounding
    // an app is not a navigation there. visibilitychange -> "hidden" is the
    // one signal reliably fired on that path, so both are wired rather than
    // either alone.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushNow();
      else unloading = false;
    });
  }

  // Also covers the corrupt-payload fallback above: `stored` truthy but
  // `restored` false means storage still holds the bad payload, and without
  // this it stays there until some later mutation happens to save over it.
  if (!restored) writeSnapshot(lastSnapshot);

  const host = document.createElement("div");
  host.id = "demo-chrome";
  document.body.appendChild(host);

  const strip = svelte.mount(DemoStrip, {
    target: host,
    props: {
      onStartOver: () => {
        // Order matters: `resetting` must be true before clearStored() runs,
        // so that ANY write still to come - a debounce timer already
        // in flight, or the pagehide flush this reload is about to trigger -
        // sees it and refuses, rather than racing clearStored() and winning.
        resetting = true;
        clearTimeout(saveTimer);
        saveTimer = null;
        persistence.clearStored(storage);
        window.location.reload();
      },
    },
  });

  // The alias stub (src/lib/demo/tauri-stub.js) reaches the strip through this,
  // because it is imported by app code that has no other way to speak to us.
  window.__DEMO_NOTICE__ = (text) => strip.setNotice(text);

  window.__DEMO_INVOKE__ = async (cmd, args) => {
    const kind = unavailable.classifyCommand(cmd);
    if (kind === "quiet") return unavailable.quietAnswer(cmd);
    if (kind === "noticed") {
      strip.setNotice(unavailable.noticeFor(cmd).text);
      // A resolved value, never a rejection: nothing has gone wrong here that
      // the visitor should be shown an error about.
      return null;
    }

    // Call base FIRST, then read the snapshot synchronously, in the same
    // turn, before awaiting anything - see the note on `lastSnapshot`
    // above. Calling base(cmd, args) (not yet awaiting it) already applies
    // the mutation; __demoSnapshot() right after it is what a caller who
    // never awaits this function at all (TipTapEditor's own pagehide
    // flush) still leaves behind for us to work with.
    const resultPromise = base(cmd, args);
    lastSnapshot = base.__demoSnapshot();

    if (unloading) {
      // The page is already on its way out - write immediately rather than
      // debouncing, since a scheduled write may never get to run.
      writeSnapshot(lastSnapshot);
    } else {
      scheduleSave();
    }

    return await resultPromise;
  };
}
