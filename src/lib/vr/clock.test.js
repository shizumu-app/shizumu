import { describe, it, expect, afterEach } from "vitest";
import { installFixedClock, installSeqUuid, resetVrDeterminism } from "./clock.js";

afterEach(() => resetVrDeterminism());

describe("vr clock", () => {
  it("freezes Date.now and arg-less new Date", () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    expect(Date.now()).toBe(Date.parse("2026-01-15T09:00:00.000Z"));
    expect(new Date().toISOString()).toBe("2026-01-15T09:00:00.000Z");
    // parameterized Date still works
    expect(new Date("2020-02-02T00:00:00.000Z").getUTCFullYear()).toBe(2020);
  });

  it("produces sequential uuids", () => {
    installSeqUuid("vr");
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    expect(a).toBe("vr-0000000000000001");
    expect(b).toBe("vr-0000000000000002");
    expect(a).not.toBe(b);
  });

  it("restores originals on reset", () => {
    const realNow = Date.now();
    installFixedClock("2026-01-15T09:00:00.000Z");
    resetVrDeterminism();
    expect(Date.now()).toBeGreaterThanOrEqual(realNow);
  });
});
