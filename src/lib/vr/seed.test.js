import { describe, it, expect, afterEach } from "vitest";
import { createSeededInvoke } from "./seed.js";
import { pageWithContent } from "./fixtures.js";
import { installFixedClock, installSeqUuid, resetVrDeterminism } from "./clock.js";

afterEach(() => {
  resetVrDeterminism();
  // withBlobs installs a convertFileSrc shim on this global (see seed.js).
  // Left behind it would make every later `isTauri` check in this worker
  // read true.
  delete globalThis.window?.__TAURI_INTERNALS__;
});

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

  // The blob seam. Marketing scenes hand it a data URI so an attachment
  // node renders a real bitmap; every baselined VR scene omits it and keeps
  // the mock's null, which is the whole subject of page-image-content and
  // dead-image-ref ("image not on this device"). Both halves are asserted
  // here because "the override works" and "the override is off by default"
  // are separate claims, and only the second one protects a baseline.
  it("answers attachment_local_src from the scene's blobs when given some", async () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const invoke = await createSeededInvoke(pageWithContent, {
      blobs: { abc123: "data:image/png;base64,AAAA" },
    });
    expect(await invoke("attachment_local_src", { blobHash: "abc123" }))
      .toBe("data:image/png;base64,AAAA");
    // A hash the scene did not supply still resolves to null, the same as
    // the bare mock — the seam is a lookup, not a blanket yes.
    expect(await invoke("attachment_local_src", { blobHash: "nope" })).toBeNull();
    // Everything else still reaches the real mock.
    expect((await invoke("get_or_create_today", {})).page.content_json).toBeTruthy();
  });

  it("leaves attachment_local_src null when no blobs are supplied", async () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const invoke = await createSeededInvoke(pageWithContent);
    // Not "nothing happens": this null is what renders the missing-image
    // fallback that page-image-content and dead-image-ref are baselined on.
    expect(await invoke("attachment_local_src", { blobHash: "abc123" })).toBeNull();
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
