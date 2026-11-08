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

/**
 * What the timer decides from: whether this file is locked and the
 * account's inactivity timeout. Read at launch and again after every pull,
 * because another device can change either (account_lock.rs; the timeout is
 * a synced setting). A read that fails gives `undefined`, so the caller
 * keeps what it had rather than turning the lock or the timer off.
 *
 * @param {{ checkEncryptionStatus: () => Promise<boolean>, getSetting: (key: string) => Promise<string|null> }} api
 * @returns {Promise<{ encrypted: boolean|undefined, timeoutMin: number|undefined }>}
 */
export async function readLockState({ checkEncryptionStatus, getSetting }) {
  let encrypted, timeoutMin;
  try { encrypted = !!(await checkEncryptionStatus()); } catch {}
  try { timeoutMin = parseInt((await getSetting("lock_timeout_minutes")) || "0", 10) || 0; } catch {}
  return { encrypted, timeoutMin };
}

const JUST_UNLOCKED = "shizumu:just-unlocked";

/**
 * The startup lock screen's unlock reloads the app, and the boot after it
 * would put the gate up again over a file the passphrase just opened. The
 * unlock marks the reload in session storage (gone at the next cold start);
 * the boot reads the mark once. Storage that throws fails closed.
 */
export function markJustUnlocked(storage) {
  try { storage.setItem(JUST_UNLOCKED, "1"); } catch {}
}

/** @returns {boolean} true once, for the boot right after an unlock. */
export function consumeJustUnlocked(storage) {
  try {
    const was = storage.getItem(JUST_UNLOCKED) === "1";
    storage.removeItem(JUST_UNLOCKED);
    return was;
  } catch {
    return false;
  }
}
