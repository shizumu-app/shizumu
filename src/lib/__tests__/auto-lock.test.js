import { describe, it, expect } from "vitest";
import { shouldAutoLock, readLockState, markJustUnlocked, consumeJustUnlocked } from "../auto-lock.js";

const MIN = 60_000;

describe("shouldAutoLock", () => {
  it("locks an encrypted, unlocked app idle past its timeout", () => {
    expect(shouldAutoLock({ encrypted: true, locked: false, timeoutMin: 5, idleMs: 5 * MIN + 1 })).toBe(true);
  });

  it("waits until the timeout has passed", () => {
    expect(shouldAutoLock({ encrypted: true, locked: false, timeoutMin: 5, idleMs: 5 * MIN })).toBe(false);
  });

  // The case that locked writers out: the lock turned off mid-session while
  // a timeout was still set. A plain file has no passphrase, so a lock
  // screen over it could never be opened again until a restart.
  it("never locks an app whose lock is off, whatever the timeout says", () => {
    expect(shouldAutoLock({ encrypted: false, locked: false, timeoutMin: 1, idleMs: 60 * MIN })).toBe(false);
  });

  // 0 is the "never" choice in settings.
  it("never locks when the timeout is never", () => {
    expect(shouldAutoLock({ encrypted: true, locked: false, timeoutMin: 0, idleMs: 600 * MIN })).toBe(false);
  });

  // Already behind the lock screen: locking again would re-close a database
  // that is already closed.
  it("does nothing while already locked", () => {
    expect(shouldAutoLock({ encrypted: true, locked: true, timeoutMin: 1, idleMs: 60 * MIN })).toBe(false);
  });
});

// The timeout follows the account like the lock does. On the A16 run of
// 2026-11-08 (J17.3) the laptop chose five minutes, the setting reached the
// phone, and the phone never locked: App.svelte re-read only whether the
// file was locked after a pull, so its timer kept launch's "never".
// readLockState is what launch AND every pull read.
describe("readLockState", () => {
  it("reads the timeout another device chose, with the lock", async () => {
    const st = await readLockState({
      checkEncryptionStatus: async () => true,
      getSetting: async (k) => (k === "lock_timeout_minutes" ? "5" : null),
    });
    expect(st).toEqual({ encrypted: true, timeoutMin: 5 });
  });

  it("reads no timeout as never, and a failed read as unknown rather than off", async () => {
    // A failed read must not turn the timer off or the lock off: undefined
    // tells the caller to keep what it had.
    expect(await readLockState({ checkEncryptionStatus: async () => false, getSetting: async () => null }))
      .toEqual({ encrypted: false, timeoutMin: 0 });
    expect(await readLockState({ checkEncryptionStatus: async () => { throw new Error("x"); }, getSetting: async () => { throw new Error("y"); } }))
      .toEqual({ encrypted: undefined, timeoutMin: undefined });
  });
});

// The launch that could not open the file shows the startup lock screen;
// its unlock reloads the app, which then found the file encrypted and put
// the shell's gate up: the same passphrase asked twice, back to back (A16,
// 2026-11-08). The unlock marks the reload; the boot after it reads the mark
// once.
describe("just unlocked", () => {
  const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

  it("lets the one boot after an unlock skip the gate, and only that one", () => {
    const s = memory();
    markJustUnlocked(s);
    expect(consumeJustUnlocked(s)).toBe(true);
    expect(consumeJustUnlocked(s)).toBe(false);
  });

  it("asks at every boot with no mark, and when storage throws", () => {
    // Failing closed: a storage that cannot be read must not open the app.
    expect(consumeJustUnlocked(memory())).toBe(false);
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    expect(() => markJustUnlocked(broken)).not.toThrow();
    expect(consumeJustUnlocked(broken)).toBe(false);
  });
});
