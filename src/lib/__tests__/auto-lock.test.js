import { describe, it, expect } from "vitest";
import { shouldAutoLock } from "../auto-lock.js";

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
