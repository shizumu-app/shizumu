// When the inactivity timer may put the lock screen up.
//
// App.svelte used to read the lock state and the timeout once, at launch, so
// settings changed mid-session reached the timer only after a restart. Worse,
// a lock turned off mid-session left the timer believing it was on: the lock
// screen came up over a plain file that no passphrase opens. Settings now
// announces each change with LOCK_SETTINGS_EVENT, and this decides from the
// current values.

/** Window event Settings fires with `{ encrypted?, timeoutMin? }` in `detail`. */
export const LOCK_SETTINGS_EVENT = "shizumu:lock-settings";

/**
 * @param {{ encrypted: boolean, locked: boolean, timeoutMin: number, idleMs: number }} state
 * @returns {boolean}
 */
export function shouldAutoLock({ encrypted, locked, timeoutMin, idleMs }) {
  if (!encrypted || locked || !(timeoutMin > 0)) return false;
  return idleMs > timeoutMin * 60_000;
}

/** Tell the app the lock settings changed (see App.svelte's listener). */
export function announceLockSettings(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOCK_SETTINGS_EVENT, { detail }));
}
