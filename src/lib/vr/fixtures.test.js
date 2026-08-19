import { describe, it, expect, afterEach } from "vitest";
import { createMockInvoke } from "../api.js";
import { FIXTURES, pageWithContent, pinsRich, memoryWithPages, continuousTrail } from "./fixtures.js";
import { installFixedClock, installSeqUuid, resetVrDeterminism } from "./clock.js";
import { getLocalDateStr } from "../utils.js";

afterEach(() => resetVrDeterminism());

describe("vr fixtures", () => {
  it("pageWithContent seeds today's page with matters-now text", async () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const invoke = createMockInvoke();
    await pageWithContent(invoke);
    const today = await invoke("get_or_create_today", {});
    expect(today.page.what_matters_now).toBeTruthy();
    expect(today.page.content_json).toBeTruthy();
  });

  it("pageWithContent seeds a second same-day page (multi-page phone header)", async () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const invoke = createMockInvoke();
    await pageWithContent(invoke);
    const today = await invoke("get_or_create_today", {});
    const count = await invoke("get_page_count_for_date", { date: today.page.date });
    expect(count).toBe(2);
  });

  it("pinsRich seeds pins retrievable by lineage", async () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const invoke = createMockInvoke();
    await pinsRich(invoke);
    const pins = await invoke("get_pins", { lineageId: null });
    expect(pins.length).toBeGreaterThan(0);
  });

  // The scene is named for continuous trails, so it has to actually seed
  // one. It previously seeded no lineage at all: page.lineage_id stayed
  // null, Page.svelte read currentTrailMode as "discrete", and the whole
  // continuous-trail surface went unrendered while the suite reported a
  // pass. These assertions are what stops that silence returning.
  it("continuousTrail attaches today's page to a continuous lineage", async () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const invoke = createMockInvoke();
    await continuousTrail(invoke);

    const lineages = await invoke("get_lineages", {});
    const trail = lineages.find((l) => l.name === "the book");
    expect(trail, "the scene must create a trail named 'the book'").toBeTruthy();
    expect(trail.mode, "the trail must be continuous, not discrete").toBe("continuous");

    const today = await invoke("get_or_create_today", {});
    expect(
      today.page.lineage_id,
      "today's page must be attached to that trail — an unattached page renders as discrete",
    ).toBe(trail.id);
    expect(today.page.content_json).toBeTruthy();
  });

  it("FIXTURES exposes all named scenes", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(
      ["continuousTrail", "deadImageRef", "emptyPage", "memoryWithPages", "pageWithBoardContent", "pageWithContent", "pageWithShortBoard", "pinsRich"].sort()
    );
  });

  it("memoryWithPages seeds three distinct consecutive UTC-dated pages", async () => {
    installFixedClock("2026-01-15T09:00:00.000Z");
    installSeqUuid("vr");
    const invoke = createMockInvoke();
    await memoryWithPages(invoke);
    const today = getLocalDateStr();
    const expected = [0, 1, 2].map((i) => {
      const d = new Date(today + "T00:00:00.000Z");
      d.setUTCDate(d.getUTCDate() - i);
      return d.toISOString().slice(0, 10);
    });
    for (const date of expected) {
      expect(await invoke("get_page_count_for_date", { date })).toBeGreaterThan(0);
    }
    expect(new Set(expected).size).toBe(3);
  });
});
