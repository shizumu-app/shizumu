import { describe, it, expect } from "vitest";
import { deviceStaleness } from "../device-staleness.js";

const DAY = 86_400_000;
const now = 1_787_400_000_000;

describe("deviceStaleness", () => {
  it("names a device heard from today as active", () => {
    expect(deviceStaleness({ last_seen_ms: now - 3_600_000, created_at_ms: now - 30 * DAY, now_ms: now }))
      .toEqual({ label: "seen today", stale: false });
  });
  it("counts days otherwise", () => {
    expect(deviceStaleness({ last_seen_ms: now - 3 * DAY, created_at_ms: now - 30 * DAY, now_ms: now }).label)
      .toBe("seen 3 days ago");
  });
  it("is stale after 14 days", () => {
    expect(deviceStaleness({ last_seen_ms: now - 15 * DAY, created_at_ms: now - 30 * DAY, now_ms: now }).stale).toBe(true);
  });
  it("a device never heard from is stale only once it is a day old", () => {
    // A device enrolled a minute ago has not had time to write; one enrolled
    // last week and silent since is the pre-reinstall ghost this exists for.
    expect(deviceStaleness({ last_seen_ms: null, created_at_ms: now - 60_000, now_ms: now }))
      .toEqual({ label: "never seen", stale: false });
    expect(deviceStaleness({ last_seen_ms: null, created_at_ms: now - 2 * DAY, now_ms: now }))
      .toEqual({ label: "never seen", stale: true });
  });
});
