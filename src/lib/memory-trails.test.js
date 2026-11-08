import { describe, it, expect } from "vitest";
import { filterTrailTree, trailSidebarModel, untrailedPageCount, trailCountText, memoryPinSourceLine } from "./memory-trails.js";

const lineages = [
  { id: "s", name: "shizumu", mode: "discrete", parent_id: null },
  { id: "v", name: "v0.8", mode: "discrete", parent_id: "s" },
  { id: "r", name: "the relay", mode: "discrete", parent_id: "s" },
  { id: "deep", name: "relay auth", mode: "discrete", parent_id: "r" },
  { id: "b", name: "the book", mode: "continuous", parent_id: null },
];

describe("filterTrailTree", () => {
  const rows = lineages.map((l) => ({ ...l }));

  it("keeps a matching child's ancestors so the match has its path", () => {
    expect(filterTrailTree(rows, "auth").map((r) => r.id)).toEqual(["s", "r", "deep"]);
  });

  it("matches case-insensitively and keeps tree order", () => {
    expect(filterTrailTree(rows, "  THE ").map((r) => r.id)).toEqual(["s", "r", "b"]);
  });

  it("an empty query is no search: every row, unchanged", () => {
    expect(filterTrailTree(rows, "   ")).toBe(rows);
  });

  it("a query nothing matches leaves no rows", () => {
    // No trail is named like this, so there is nothing to show; the model
    // turns this into `noMatch` rather than an unexplained empty list.
    expect(filterTrailTree(rows, "zzz")).toEqual([]);
  });
});

describe("trailSidebarModel", () => {
  const pageCounts = new Map([["s", 2], ["v", 2], ["r", 2], ["b", 1]]);
  const pinCounts = new Map([["v", 3], ["r", 1], [null, 2]]);

  it("each row carries its own pages and pins, not its subtree's (ruling 1)", () => {
    const m = trailSidebarModel({ lineages, pageCounts, pinCounts, untrailedPages: 1 });
    const s = m.rows.find((r) => r.id === "s");
    expect(s.pages).toBe(2);
    expect(s.pins).toBe(0);
    expect(m.rows.find((r) => r.id === "v").pins).toBe(3);
  });

  it("only continuous trails are marked", () => {
    const m = trailSidebarModel({ lineages, pageCounts, pinCounts });
    expect(m.rows.filter((r) => r.oneDoc).map((r) => r.id)).toEqual(["b"]);
  });

  it("all trails totals every page and pin; untrailed is pages without a trail and the global pins", () => {
    const m = trailSidebarModel({ lineages, pageCounts, pinCounts, untrailedPages: 1 });
    expect(m.all).toEqual({ pages: 8, pins: 6 });
    expect(m.untrailed).toEqual({ pages: 1, pins: 2 });
  });

  it("an unknown untrailed page count leaves the all-trails page total unknown too", () => {
    const m = trailSidebarModel({ lineages, pageCounts, pinCounts, untrailedPages: null });
    expect(m.all.pages).toBeNull();
    expect(m.untrailed.pages).toBeNull();
  });

  it("folding a parent hides its subtree", () => {
    const m = trailSidebarModel({ lineages, collapsed: new Set(["s"]) });
    expect(m.rows.map((r) => r.id)).toEqual(["s", "b"]);
    expect(m.rows[0].expanded).toBe(false);
  });

  it("a search reaches into a folded branch", () => {
    const m = trailSidebarModel({ lineages, collapsed: new Set(["s"]), query: "auth" });
    expect(m.rows.map((r) => r.id)).toEqual(["s", "r", "deep"]);
    expect(m.rows[0].expanded).toBe(true);
  });

  it("a search with no match says so", () => {
    expect(trailSidebarModel({ lineages, query: "zzz" }).noMatch).toBe(true);
    expect(trailSidebarModel({ lineages, query: "" }).noMatch).toBe(false);
  });
});

describe("untrailedPageCount", () => {
  it("counts the loaded untrailed pages while the list is not full", () => {
    expect(untrailedPageCount([{ lineage_id: null }, { lineage_id: "a" }], 100)).toBe(1);
  });
  it("is unknown once the capped list is full", () => {
    const full = Array.from({ length: 3 }, () => ({ lineage_id: null }));
    expect(untrailedPageCount(full, 3)).toBeNull();
  });
});

describe("trailCountText", () => {
  it("names both counts for a screen reader", () => {
    expect(trailCountText({ pages: 6, pins: 1 }).label).toBe("6 pages, 1 pin");
  });
  it("drops the page number it does not know", () => {
    expect(trailCountText({ pages: null, pins: 2 })).toEqual({ pages: null, pins: "2", label: "2 pins" });
  });
});

describe("memoryPinSourceLine", () => {
  it("names the trail path and the day the pin was kept", () => {
    expect(memoryPinSourceLine({ lineage_id: "v", source_page_date: "2026-01-15" }, lineages)).toBe("shizumu › v0.8 · 15 jan");
  });
  it("a global pin is from everywhere, dated by its creation when no page date is known", () => {
    expect(memoryPinSourceLine({ lineage_id: null, created_at: "2026-02-03T10:00:00Z" }, lineages)).toBe("everywhere · 3 feb");
  });
  it("a trail no longer listed is said plainly", () => {
    expect(memoryPinSourceLine({ lineage_id: "gone", source_page_date: "2026-01-15" }, lineages))
      .toBe("a trail that is no longer listed · 15 jan");
  });
});
