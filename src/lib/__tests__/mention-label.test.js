import { describe, expect, test } from "vitest";
import { buildMentionLabel, formatTrailPath, trailPathFor } from "../mention-label.js";

const lineages = [
  { id: "a", name: "alpha", parent_id: null, mode: "discrete" },
  { id: "b", name: "beta",  parent_id: "a",  mode: "discrete" },
  { id: "c", name: "gamma", parent_id: "b",  mode: "discrete" },
  { id: "d", name: "delta", parent_id: "c",  mode: "discrete" },
  { id: "e", name: "echo",  parent_id: "d",  mode: "discrete" },
  { id: "j", name: "journal", parent_id: null, mode: "continuous" },
];

describe("trailPathFor", () => {
  test("untrailed returns empty array", () => {
    expect(trailPathFor(null, lineages)).toEqual([]);
    expect(trailPathFor(undefined, lineages)).toEqual([]);
  });
  test("root-only returns single name", () => {
    expect(trailPathFor("a", lineages)).toEqual(["alpha"]);
  });
  test("nested returns names root-to-leaf", () => {
    expect(trailPathFor("c", lineages)).toEqual(["alpha", "beta", "gamma"]);
  });
  test("deep nesting preserved", () => {
    expect(trailPathFor("e", lineages)).toEqual(["alpha", "beta", "gamma", "delta", "echo"]);
  });
});

describe("formatTrailPath", () => {
  test("single segment", () => {
    expect(formatTrailPath(["alpha"])).toBe("alpha");
  });
  test("three segments stay intact", () => {
    expect(formatTrailPath(["a", "b", "c"])).toBe("a:b:c");
  });
  test("four segments collapse middle, keep last two", () => {
    expect(formatTrailPath(["a", "b", "c", "d"])).toBe("a:...:c:d");
  });
  test("five segments collapse middle, keep last two", () => {
    expect(formatTrailPath(["a", "b", "c", "d", "e"])).toBe("a:...:d:e");
  });
  test("empty returns empty string", () => {
    expect(formatTrailPath([])).toBe("");
  });
});

describe("buildMentionLabel", () => {
  test("1-level discrete with focus", () => {
    const label = buildMentionLabel({
      page: { date: "2026-05-12", what_matters_now: "ship v0.3", lineage_id: "a", lineage_mode: "discrete" },
      lineages,
    });
    expect(label).toBe("alpha:ship v0.3");
  });

  test("3-level discrete with focus", () => {
    const label = buildMentionLabel({
      page: { date: "2026-05-12", what_matters_now: "branching trails", lineage_id: "c", lineage_mode: "discrete" },
      lineages,
    });
    expect(label).toBe("alpha:beta:gamma:branching trails");
  });

  test("5-level discrete with focus uses collapse rule", () => {
    const label = buildMentionLabel({
      page: { date: "2026-05-12", what_matters_now: "implement A", lineage_id: "e", lineage_mode: "discrete" },
      lineages,
    });
    expect(label).toBe("alpha:...:delta:echo:implement A");
  });

  test("discrete with empty focus falls back to date", () => {
    const label = buildMentionLabel({
      page: { date: "2026-05-12", what_matters_now: "", lineage_id: "a", lineage_mode: "discrete" },
      lineages,
    });
    expect(label).toBe("alpha:2026-05-12");
  });

  test("discrete with whitespace-only focus falls back to date", () => {
    const label = buildMentionLabel({
      page: { date: "2026-05-12", what_matters_now: "   ", lineage_id: "a", lineage_mode: "discrete" },
      lineages,
    });
    expect(label).toBe("alpha:2026-05-12");
  });

  test("continuous trail returns trail-path only (no focus)", () => {
    const label = buildMentionLabel({
      page: { date: "2026-05-12", what_matters_now: "today's thought", lineage_id: "j", lineage_mode: "continuous" },
      lineages,
    });
    expect(label).toBe("journal");
  });

  test("untrailed with focus uses date:focus", () => {
    const label = buildMentionLabel({
      page: { date: "2026-05-12", what_matters_now: "free thought", lineage_id: null, lineage_mode: null },
      lineages,
    });
    expect(label).toBe("2026-05-12:free thought");
  });

  test("untrailed without focus uses date only", () => {
    const label = buildMentionLabel({
      page: { date: "2026-05-12", what_matters_now: null, lineage_id: null, lineage_mode: null },
      lineages,
    });
    expect(label).toBe("2026-05-12");
  });

  test("untrailed with null fields tolerated", () => {
    const label = buildMentionLabel({
      page: { date: "2026-05-12" },
      lineages,
    });
    expect(label).toBe("2026-05-12");
  });
});
