import { describe, it, expect, afterEach } from "vitest";
import { createSeededInvoke } from "./seed.js";
import { pageWithContent } from "./fixtures.js";
import { installFixedClock, installSeqUuid, resetVrDeterminism } from "./clock.js";

afterEach(() => resetVrDeterminism());

describe("createSeededInvoke", () => {
  it("returns an invoke with the fixture already applied", async () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const invoke = await createSeededInvoke(pageWithContent);
    const today = await invoke("get_or_create_today", {});
    expect(today.page.content_json).toBeTruthy();
  });

  // The mobile gestures tip is a one-time toast fired on coarse pointers
  // when `mobile_gestures_tip_seen` is unset. It is transient, so whether a
  // screenshot catches it depends purely on how long the fixture's awaits
  // took — a baseline that captures it fails the moment that timing shifts.
  // Marking it seen for every scene removes the race rather than relying on
  // the toast losing it.
  it("marks the one-time mobile gestures tip as seen, so no scene can capture it", async () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const invoke = await createSeededInvoke(pageWithContent);
    expect(await invoke("get_setting", { key: "mobile_gestures_tip_seen" })).toBe("true");
  });

  it("is deterministic across two seeded builds", async () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const a = await createSeededInvoke(pageWithContent);
    resetVrDeterminism();
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const b = await createSeededInvoke(pageWithContent);
    const ra = await a("get_or_create_today", {});
    const rb = await b("get_or_create_today", {});
    expect(ra.page.id).toBe(rb.page.id);
    expect(ra.page.created_at).toBe(rb.page.created_at);
  });
});
