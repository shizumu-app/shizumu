import { describe, it, expect } from "vitest";
import { wipeReadiness, mayWipeNow } from "./wipe-readiness.js";

const on = { configured: true, enabled: true, revoked: false };

describe("wipeReadiness", () => {
  it("a device that never set sync up has no other device to lose writing to", () => {
    // local_only rows are normal here: nothing was ever going to upload them
    expect(wipeReadiness({ configured: false, enabled: false }, { local_only: 40, pending_upload: 0 }).clear).toBe(true);
    // the browser mock answers null for sync_status: it has no account either
    expect(wipeReadiness(null, null).clear).toBe(true);
  });

  it("everything uploaded goes straight through with the plain confirm", () => {
    const r = wipeReadiness(on, { local_only: 0, pending_upload: 0 });
    expect(r.clear).toBe(true);
    expect(r.confirmLabel).toBe("confirm");
  });

  it("an op waiting to upload, or one mid-upload, warns and offers to send", () => {
    for (const stats of [{ local_only: 1, pending_upload: 0 }, { local_only: 0, pending_upload: 1 }]) {
      const r = wipeReadiness(on, stats);
      expect(r.clear).toBe(false);
      expect(r.canSend).toBe(true);
      expect(r.confirmLabel).toBe("delete anyway");
      expect(r.line).toMatch(/not reached your other devices/);
    }
  });

  it("after a send that left something waiting, it says the send failed", () => {
    const r = wipeReadiness(on, { local_only: 2 }, { triedSend: true });
    expect(r.line).toMatch(/could not be sent/);
    expect(r.canSend).toBe(true);
  });

  it("sync off cannot send (the flush is a no-op there), so it does not offer to", () => {
    const r = wipeReadiness({ ...on, enabled: false }, { local_only: 2 });
    expect(r.canSend).toBe(false);
    expect(r.line).toMatch(/turn sync on/);
  });

  it("a revoked device can never send, so it points at export", () => {
    const r = wipeReadiness({ ...on, revoked: true }, { local_only: 2 });
    expect(r.canSend).toBe(false);
    expect(r.line).toMatch(/export/);
  });

  it("a read that failed warns rather than passing as nothing waiting", () => {
    expect(wipeReadiness(null, null, { failed: true }).clear).toBe(false);
    expect(wipeReadiness(on, null).clear).toBe(false);
  });

  it("every warning leaves a way through: an offline laptop can still be wiped", () => {
    expect(wipeReadiness(on, { local_only: 1 }).confirmLabel).toBe("delete anyway");
    expect(wipeReadiness({ ...on, enabled: false }, { local_only: 1 }).confirmLabel).toBe("delete anyway");
  });

  it("no warning uses the retired word or an exclamation", () => {
    for (const r of [wipeReadiness(on, { local_only: 1 }), wipeReadiness(null, null, { failed: true })]) {
      expect(r.line).not.toMatch(/\bsink|\bsunk|!/);
    }
  });
});

describe("mayWipeNow", () => {
  const clear = wipeReadiness(on, { local_only: 0 });
  const warned = wipeReadiness(on, { local_only: 1 });

  it("goes through when nothing waits, and when the warning was seen", () => {
    expect(mayWipeNow(clear, clear)).toBe(true);
    expect(mayWipeNow(warned, warned)).toBe(true);
    expect(mayWipeNow(warned, clear)).toBe(true);
  });

  it("stops when writing started waiting after the row said nothing did", () => {
    expect(mayWipeNow(clear, warned)).toBe(false);
    expect(mayWipeNow(null, warned)).toBe(false);
  });
});
