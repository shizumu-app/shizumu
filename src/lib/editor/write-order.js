// write-order.js — may this save go on the wire yet?
//
// The bug this exists for, from an Android device: pin a block on a page,
// open the pins screen, the row reads `source removed`. Nobody removed the
// page. The pin was orphaned by the page's OWN save.
//
// Every save_page_content runs refresh_pin_caches (commands.rs), whose
// sweep flips any `open` pin whose id is missing from the saved content_json
// to `orphaned`, and flips it back when a later save carries the id. So the
// database's answer is whichever save it applied LAST. EditorCore could send
// two: typing schedules a save a second out, and confirmPin's stamp lands
// only after `await createPin` — a round trip. When the debounce fires
// inside that round trip, a pre-stamp save is still in flight as the
// stamped flushSave goes out, and which of the two the database applies
// last was never decided by anything.
//
// On a desktop webview the two requests reach the main thread one at a
// time, in order, so this stayed invisible. On Android the WebView answers
// each request on a thread of its own (wry's RustWebViewClient.kt calls
// into Rust from `shouldInterceptRequest`), Tauri runs a sync command inline
// on that thread (tauri-macros `body_blocking`), and the two saves become
// two threads contending for the database mutex. The later one can take it
// first. ShellApp.test.js's "a pin outlives the save it raced" models
// exactly that interleaving and went red on the code that shipped.
//
// THE RULE: one save on the wire at a time, in the order they were asked
// for. Then send order IS apply order, whatever thread answers, and the
// stamped save — always the last one sent — is always the last one
// applied. The doc is still captured at the moment the save is asked for,
// never at the moment it is sent: a save that waited must carry what the
// page held when it was scheduled, or a queued teardown flush would read a
// destroyed editor.
//
// CLAUDE.md: decisions live in pure modules, not inside a `.svelte` file
// where nothing can reach them. This is that decision.

/**
 * serialWrites — a lane that lets one write through at a time.
 *
 * `run(send)` calls `send` once every write asked for before it has
 * settled, and returns `send`'s own promise: the caller still sees its
 * result or its rejection. A rejection holds nothing up — the next write
 * goes out as if the failed one had resolved, because a save that failed
 * is a save to retry on the next edit, not a reason to stop saving.
 *
 * `send` is a thunk rather than a promise on purpose. A promise is a
 * request already on the wire; the whole point is to not make it until
 * the lane is clear.
 *
 * @returns {{ run: <T>(send: () => Promise<T> | T) => Promise<T> }}
 */
export function serialWrites() {
  let tail = Promise.resolve();
  const settle = () => {};
  return {
    run(send) {
      const turn = tail.then(() => send());
      tail = turn.then(settle, settle);
      return turn;
    },
  };
}
