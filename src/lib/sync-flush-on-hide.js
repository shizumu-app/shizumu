// Flush pending sync writes before the OS suspends the process.
//
// Extracted as its own pure function (CLAUDE.md testing rule: decisions go
// in pure modules, not inline in a .svelte file where nothing can reach
// them) — "does the right event fire the right call" is exactly the kind
// of thing that's easy to get backwards (fire on visible instead of
// hidden, wire pagehide to nothing) and impossible to catch once it's
// buried in App.svelte's onMount.
//
// `schedule_sync_wake` (Rust, commands.rs) only sets a flag the sync
// worker's sleep loop notices on its next poll. On Android, backgrounding
// the app can freeze that thread before it is ever scheduled again — so
// anything written in the last few seconds before the user switches away
// or locks the screen sits unsent until the app is reopened, sometimes
// indefinitely. `visibilitychange` -> "hidden" is the normal
// background/tab-switch signal; `pagehide` also fires on some Android
// app-switch and hard-teardown paths `visibilitychange` can miss — both
// are wired, not just one. Each calls `sync_flush_now`, which runs the
// upload pass inline on the Rust side instead of waiting for the worker
// thread to wake and get scheduled.
//
// Fire-and-forget by design: nothing here awaits the result or blocks
// teardown, and `sync_flush_now` itself never rejects (a fast no-op when
// sync is off/unconfigured — see its doc comment in commands.rs). The
// `.catch(() => {})` is defensive only, for a transport-level failure
// (e.g. the IPC bridge itself is gone) rather than anything the command
// body can return.
//
// @param {object} deps
// @param {() => Promise<any>} deps.syncFlushNow - the api.js wrapper around
//   the `sync_flush_now` Tauri command.
// @param {Document} [deps.doc] - injectable for tests; defaults to the
//   global `document`.
// @param {Window} [deps.win] - injectable for tests; defaults to the
//   global `window`.
// @returns {() => void} teardown — removes both listeners.
export function installSyncFlushOnHide({ syncFlushNow, doc = document, win = window }) {
  const onVisibilityChange = () => {
    if (doc.visibilityState === "hidden") {
      syncFlushNow().catch(() => {});
    }
  };
  const onPageHide = () => {
    syncFlushNow().catch(() => {});
  };

  doc.addEventListener("visibilitychange", onVisibilityChange);
  win.addEventListener("pagehide", onPageHide);

  return () => {
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    win.removeEventListener("pagehide", onPageHide);
  };
}
