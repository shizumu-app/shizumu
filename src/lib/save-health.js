// IS THE WRITING BEING KEPT?
//
// Both editors save on a one-second debounce and, until 2026-10-15, caught a
// failed save with console.error and nothing else. A full disk, a locked or
// damaged database, a backend that panicked: the writer kept typing into a
// page that was no longer being written anywhere, and the screen said
// nothing. Found by the readiness council, confirmed in TipTapEditor's and
// EditorCore's flushSave.
//
// The editor reports each outcome here; the page shows one quiet line while
// saves are failing and takes it away when one lands. The editor also
// retries on its own, on the delays below, so a passing fault (a lock held
// by a backup, a moment's I/O error) heals without the writer doing anything.

import { writable } from "svelte/store";

const HEALTHY = Object.freeze({ failing: false, attempts: 0 });
const store = writable(HEALTHY);
let state = HEALTHY;

export const saveHealth = { subscribe: store.subscribe };

/** A save did not land. Returns how many have failed in a row. */
export function saveFailed(err) {
  state = { failing: true, attempts: state.attempts + 1 };
  store.set(state);
  console.error("save failed:", err);
  return state.attempts;
}

/** A save landed. Publishes only when it ends a run of failures. */
export function saveSucceeded() {
  if (!state.failing) return;
  state = HEALTHY;
  store.set(state);
}

/** How long to wait before retrying, after this many failures in a row. */
export function retryDelayMs(attempts) {
  return [2000, 5000, 10000][attempts - 1] ?? 30000;
}

/** The backend's answer when the page being saved no longer exists. A page
 *  the writer is LEAVING that was just deleted is not writing lost: deleting
 *  the open page switches to its neighbour, and the switch flushes the page
 *  just removed (measured on an A16 as this exact message). */
export function isGonePageError(err) {
  return String(err?.message ?? err ?? "").includes("Query returned no rows");
}

export function _resetSaveHealth() {
  state = HEALTHY;
  store.set(state);
}
