import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  emptyFilters,
  getDateCutoff,
  pageMatches,
  activeFilterCount,
  toggleUntrailedOnly,
  groupByDate,
  applyDateFilter,
  applyScopeFilter,
  daysWithActivity,
  gapRanges,
  subtrailSpawnDay,
  dayItemsFor,
  dayTrailBreakdownFor,
  dominantTrailSummary,
} from "./memory-filters.js";

// Stable references for tests.
function page(overrides = {}) {
  return {
    id: "p1",
    date: "2026-05-14",
    page_number: 1,
    lineage_id: null,
    pin_count: 0,
    backlink_count: 0,
    ...overrides,
  };
}

const noMode = () => null;

describe("memory-filters", () => {
  describe("getDateCutoff", () => {
    it("returns null for 'all'", () => {
      expect(getDateCutoff("all")).toBeNull();
    });
    it("returns a YYYY-MM-DD string for 'today'", () => {
      expect(getDateCutoff("today")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    it("returns null for an unknown filter", () => {
      expect(getDateCutoff("year")).toBeNull();
    });
  });

  describe("pageMatches — date", () => {
    it("rejects pages before the cutoff", () => {
      const f = { ...emptyFilters(), date: "today" };
      const before = page({ date: "2024-01-01" });
      expect(pageMatches(before, f, noMode)).toBe(false);
    });
  });

  describe("pageMatches — trails vs untrailedOnly", () => {
    it("untrailedOnly: only lineage_id null passes", () => {
      const f = { ...emptyFilters(), untrailedOnly: true };
      expect(pageMatches(page({ lineage_id: null }), f, noMode)).toBe(true);
      expect(pageMatches(page({ lineage_id: "L1" }), f, noMode)).toBe(false);
    });

    it("trails: only pages whose lineage is in the set pass", () => {
      const f = { ...emptyFilters(), trails: new Set(["L1"]) };
      expect(pageMatches(page({ lineage_id: "L1" }), f, noMode)).toBe(true);
      expect(pageMatches(page({ lineage_id: "L2" }), f, noMode)).toBe(false);
      expect(pageMatches(page({ lineage_id: null }), f, noMode)).toBe(false);
    });
  });

  describe("pageMatches — modes", () => {
    it("rejects untrailed pages when a mode is selected", () => {
      const f = { ...emptyFilters(), modes: new Set(["continuous"]) };
      expect(pageMatches(page({ lineage_id: null }), f, noMode)).toBe(false);
    });

    it("matches against lineageModeOf lookup", () => {
      const f = { ...emptyFilters(), modes: new Set(["continuous"]) };
      const lookup = vi.fn((id) => (id === "L1" ? "continuous" : "discrete"));
      expect(pageMatches(page({ lineage_id: "L1" }), f, lookup)).toBe(true);
      expect(pageMatches(page({ lineage_id: "L2" }), f, lookup)).toBe(false);
    });
  });

  describe("pageMatches — pins / backlinks", () => {
    it("pinned filter requires pin_count > 0", () => {
      const f = { ...emptyFilters(), pinned: true };
      expect(pageMatches(page({ pin_count: 0 }), f, noMode)).toBe(false);
      expect(pageMatches(page({ pin_count: 3 }), f, noMode)).toBe(true);
    });

    it("hasBacklinks filter requires backlink_count > 0", () => {
      const f = { ...emptyFilters(), hasBacklinks: true };
      expect(pageMatches(page({ backlink_count: 0 }), f, noMode)).toBe(false);
      expect(pageMatches(page({ backlink_count: 1 }), f, noMode)).toBe(true);
    });
  });

  describe("activeFilterCount", () => {
    it("returns 0 for default filters", () => {
      expect(activeFilterCount(emptyFilters())).toBe(0);
    });
    it("counts each non-default dimension", () => {
      const f = emptyFilters();
      f.date = "today";
      f.pinned = true;
      f.trails = new Set(["L1"]);
      expect(activeFilterCount(f)).toBe(3);
    });
  });

  describe("toggleUntrailedOnly", () => {
    it("clears trail selection when turning on", () => {
      const f = { ...emptyFilters(), trails: new Set(["L1", "L2"]) };
      const next = toggleUntrailedOnly(f);
      expect(next.untrailedOnly).toBe(true);
      expect(next.trails.size).toBe(0);
    });
    it("does not mutate input", () => {
      const f = { ...emptyFilters(), trails: new Set(["L1"]) };
      toggleUntrailedOnly(f);
      expect(f.untrailedOnly).toBe(false);
      expect(f.trails.size).toBe(1);
    });
  });

  describe("groupByDate", () => {
    // The current implementation reads `new Date()` via utils helpers, so we
    // pin "now" to 2026-05-16 (a Saturday) for deterministic label assertions.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 4, 16, 12, 0, 0)); // local-time noon
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("emits one exact-date label per distinct date", () => {
      // Same-year labels drop the year; cross-year keeps it.
      const pages = [
        { id: "1", date: "2026-05-16" },
        { id: "2", date: "2026-05-15" },
        { id: "3", date: "2026-05-10" },
        { id: "4", date: "2026-05-05" },
        { id: "5", date: "2025-04-01" }, // prior year keeps the year
      ];
      const groups = groupByDate(pages);
      const labels = groups.map((g) => g.label);
      expect(labels).toEqual([
        "sat · 16 may",
        "fri · 15 may",
        "sun · 10 may",
        "tue · 5 may",
        "tue · 1 apr 2025",
      ]);
      for (const g of groups) {
        expect(g.pages.length).toBe(1);
      }
    });

    it("returns empty array for empty input", () => {
      expect(groupByDate([])).toEqual([]);
    });

    it("omits empty buckets — only labels with pages appear", () => {
      const groups = groupByDate([{ id: "1", date: "2026-05-16" }]);
      expect(groups.length).toBe(1);
      expect(groups[0].label).toBe("sat · 16 may");
      expect(groups[0].pages.map((p) => p.id)).toEqual(["1"]);
    });

    it("collapses consecutive same-date pages into one bucket", () => {
      // Two pages on the same day share their date label; one neighbor-day
      // page splits off.
      const pages = [
        { id: "a", date: "2026-05-16" },
        { id: "b", date: "2026-05-16" },
        { id: "c", date: "2026-05-15" },
      ];
      const groups = groupByDate(pages);
      expect(groups.map((g) => g.label)).toEqual([
        "sat · 16 may",
        "fri · 15 may",
      ]);
      expect(groups[0].pages.map((p) => p.id)).toEqual(["a", "b"]);
      expect(groups[1].pages.map((p) => p.id)).toEqual(["c"]);
    });
  });

  describe("applyDateFilter", () => {
    const today = "2026-05-17";
    const pages = [
      { id: "1", date: "2026-05-17" },
      { id: "2", date: "2026-05-15" },
      { id: "3", date: "2026-05-10" },
      { id: "4", date: "2026-04-01" },
    ];

    it("returns all items when filter is null or { kind: 'all' }", () => {
      expect(applyDateFilter(pages, null, today)).toEqual(pages);
      expect(applyDateFilter(pages, { kind: "all" }, today)).toEqual(pages);
    });

    it("filters to today", () => {
      const out = applyDateFilter(pages, { kind: "today" }, today);
      expect(out.length).toBe(1);
      expect(out[0].id).toBe("1");
    });

    it("filters to specific date", () => {
      const out = applyDateFilter(pages, { kind: "specific", date: "2026-05-15" }, today);
      expect(out.length).toBe(1);
      expect(out[0].id).toBe("2");
    });

    it("filters to a date range", () => {
      const out = applyDateFilter(pages, { kind: "range", from: "2026-05-10", to: "2026-05-15" }, today);
      expect(out.length).toBe(2);
      expect(out.map((p) => p.id).sort()).toEqual(["2", "3"]);
    });

    it("filters to thisWeek (7 days back)", () => {
      const out = applyDateFilter(pages, { kind: "thisWeek" }, today);
      expect(out.length).toBe(2);
      expect(out.map((p) => p.id).sort()).toEqual(["1", "2"]);
    });

    it("filters to thisMonth (30 days back)", () => {
      const out = applyDateFilter(pages, { kind: "thisMonth" }, today);
      expect(out.length).toBe(3);
      expect(out.map((p) => p.id).sort()).toEqual(["1", "2", "3"]);
    });
  });

  describe("applyScopeFilter", () => {
    const items = [
      { id: "1", lineage_id: "a" },
      { id: "2", lineage_id: "b" },
      { id: "3", lineage_id: null },
    ];

    it("returns all items when scope is null (all trails)", () => {
      expect(applyScopeFilter(items, null)).toEqual(items);
    });

    it("returns items in the lineage when scope is a lineage id", () => {
      expect(applyScopeFilter(items, "a")).toEqual([items[0]]);
    });

    it("returns untrailed items when scope is __untrailed__", () => {
      expect(applyScopeFilter(items, "__untrailed__")).toEqual([items[2]]);
    });
  });

  describe("daysWithActivity", () => {
    it("groups pages and pins by date with counts", () => {
      const pages = [
        { id: "1", date: "2026-05-17", lineage_id: "a", title: "today", what_matters_now: "focus" },
        { id: "2", date: "2026-05-15", lineage_id: "a" },
        { id: "3", date: "2026-05-15", lineage_id: "a" },
      ];
      const pins = [
        { id: "p1", source_page_date: "2026-05-17", lineage_id: "a" },
        { id: "p2", source_page_date: "2026-05-17", lineage_id: "a" },
      ];
      const out = daysWithActivity(pages, pins);
      expect(out.length).toBe(2);
      const today = out.find((d) => d.date === "2026-05-17");
      expect(today.pages.length).toBe(1);
      expect(today.pins.length).toBe(2);
      expect(today.pages[0].what_matters_now).toBe("focus");
      const earlier = out.find((d) => d.date === "2026-05-15");
      expect(earlier.pages.length).toBe(2);
      expect(earlier.pins.length).toBe(0);
    });

    it("sorts by date descending", () => {
      const pages = [
        { id: "1", date: "2026-04-01", lineage_id: "a" },
        { id: "2", date: "2026-05-15", lineage_id: "a" },
        { id: "3", date: "2026-05-17", lineage_id: "a" },
      ];
      const out = daysWithActivity(pages, []);
      expect(out.map((d) => d.date)).toEqual(["2026-05-17", "2026-05-15", "2026-04-01"]);
    });

    it("returns empty for empty input", () => {
      expect(daysWithActivity([], [])).toEqual([]);
    });
  });

  describe("subtrailSpawnDay", () => {
    it("returns the earliest date of the child trail's pages", () => {
      const childPages = [
        { id: "1", date: "2026-05-15", lineage_id: "child" },
        { id: "2", date: "2026-05-12", lineage_id: "child" },
        { id: "3", date: "2026-05-17", lineage_id: "child" },
      ];
      expect(subtrailSpawnDay(childPages)).toBe("2026-05-12");
    });

    it("returns null for empty page list", () => {
      expect(subtrailSpawnDay([])).toBe(null);
    });
  });

  describe("gapRanges", () => {
    it("returns gap counts between consecutive active dates (descending)", () => {
      const activeDates = ["2026-05-17", "2026-05-15", "2026-05-10"];
      const gaps = gapRanges(activeDates);
      // gap between 17 and 15 = 1 day (16 only)
      // gap between 15 and 10 = 4 days (11, 12, 13, 14)
      expect(gaps).toEqual([
        { afterDate: "2026-05-17", days: 1 },
        { afterDate: "2026-05-15", days: 4 },
      ]);
    });

    it("returns empty when only one or zero active dates", () => {
      expect(gapRanges([])).toEqual([]);
      expect(gapRanges(["2026-05-17"])).toEqual([]);
    });
  });
});

describe("dayItemsFor", () => {
  const p = (date, id, lineage_id) => ({ id, date, page_number: 1, lineage_id, what_matters_now: id });
  const pin = (date, id, lineage_id) => ({
    id, lineage_id, source_page_date: date, object_type: "note", title: id, content: id,
  });

  it("returns pages for a date scoped to a trail", () => {
    const pages = [p("2026-05-17", "p1", "shizumu"), p("2026-05-17", "p2", "w"), p("2026-05-16", "p3", "shizumu")];
    const out = dayItemsFor({ pages, pins: [], date: "2026-05-17", lineageId: "shizumu", kind: "pages" });
    expect(out.map((x) => x.id)).toEqual(["p1"]);
  });

  it("returns pages for a date across all trails when lineageId is null", () => {
    const pages = [p("2026-05-17", "p1", "shizumu"), p("2026-05-17", "p2", "w")];
    const out = dayItemsFor({ pages, pins: [], date: "2026-05-17", lineageId: null, kind: "pages" });
    expect(out.map((x) => x.id)).toEqual(["p1", "p2"]);
  });

  it("returns pages for a date scoped to untrailed when lineageId is '__untrailed__'", () => {
    const pages = [p("2026-05-17", "p1", "shizumu"), p("2026-05-17", "p2", null)];
    const out = dayItemsFor({ pages, pins: [], date: "2026-05-17", lineageId: "__untrailed__", kind: "pages" });
    expect(out.map((x) => x.id)).toEqual(["p2"]);
  });

  it("returns pins for a date scoped to a trail", () => {
    const pins = [pin("2026-05-17", "pin1", "shizumu"), pin("2026-05-17", "pin2", null)];
    const out = dayItemsFor({ pages: [], pins, date: "2026-05-17", lineageId: "shizumu", kind: "pins" });
    expect(out.map((x) => x.id)).toEqual(["pin1"]);
  });

  it("returns pins for a date scoped to untrailed when lineageId is '__untrailed__'", () => {
    const pins = [pin("2026-05-17", "pin1", "shizumu"), pin("2026-05-17", "pin2", null)];
    const out = dayItemsFor({ pages: [], pins, date: "2026-05-17", lineageId: "__untrailed__", kind: "pins" });
    expect(out.map((x) => x.id)).toEqual(["pin2"]);
  });

  it("returns [] when nothing matches", () => {
    expect(dayItemsFor({ pages: [], pins: [], date: "2026-05-17", lineageId: null, kind: "pages" })).toEqual([]);
  });

  it("resolves pin date via source_page_id when source_page_date is missing", () => {
    const pages = [{ id: "src-page", date: "2026-05-17", page_number: 1, lineage_id: "shizumu" }];
    const pins = [{ id: "pin1", lineage_id: "shizumu", source_page_id: "src-page", object_type: "note" }];
    const out = dayItemsFor({ pages, pins, date: "2026-05-17", lineageId: "shizumu", kind: "pins" });
    expect(out.map((x) => x.id)).toEqual(["pin1"]);
  });
});

describe("dayTrailBreakdownFor", () => {
  const lin = (id, name, parent_id = null) => ({ id, name, parent_id });
  const p = (date, id, lineage_id) => ({ id, date, page_number: 1, lineage_id });
  const pin = (date, id, lineage_id) => ({ id, lineage_id, source_page_date: date, object_type: "note" });

  const lineages = [
    lin("shizumu", "shizumu"),
    lin("w", "w", "shizumu"),
    lin("posts", "posts", "shizumu"),
  ];

  it("groups items by lineage and emits breadcrumb path for nested trails", () => {
    const pages = [p("2026-05-17", "p1", "shizumu"), p("2026-05-17", "p2", "w"), p("2026-05-17", "p3", null)];
    const pins = [pin("2026-05-17", "pin1", "shizumu"), pin("2026-05-17", "pin2", "shizumu")];
    const out = dayTrailBreakdownFor({ pages, pins, lineages, date: "2026-05-17" });
    expect(out).toEqual([
      { lineageId: "shizumu", name: "shizumu", path: ["shizumu"], pageCount: 1, pinCount: 2 },
      { lineageId: "w", name: "w", path: ["shizumu", "w"], pageCount: 1, pinCount: 0 },
      { lineageId: "__untrailed__", name: "untrailed", path: [], pageCount: 1, pinCount: 0 },
    ]);
  });

  it("orders by pin count desc, then page count desc, then name asc", () => {
    const pages = [
      p("2026-05-17", "p1", "shizumu"), p("2026-05-17", "p2", "shizumu"),
      p("2026-05-17", "p3", "w"),
    ];
    const pins = [pin("2026-05-17", "pin1", "w"), pin("2026-05-17", "pin2", "w")];
    const out = dayTrailBreakdownFor({ pages, pins, lineages, date: "2026-05-17" });
    expect(out.map((r) => r.lineageId)).toEqual(["w", "shizumu"]);
  });

  it("returns [] for an empty day", () => {
    expect(dayTrailBreakdownFor({ pages: [], pins: [], lineages, date: "2026-05-17" })).toEqual([]);
  });
});

describe("dominantTrailSummary", () => {
  const lin = (id, name, parent_id = null) => ({ id, name, parent_id });
  const p = (date, id, lineage_id, focus) => ({ id, date, page_number: 1, lineage_id, what_matters_now: focus });
  const pin = (date, id, lineage_id) => ({ id, lineage_id, source_page_date: date, object_type: "note" });

  const lineages = [lin("shizumu", "shizumu"), lin("w", "w", "shizumu")];

  it("returns the focus from the trail with the most activity", () => {
    const pages = [
      p("2026-05-17", "p1", "shizumu", "finishing the editor"),
      p("2026-05-17", "p2", "w", "first thought"),
    ];
    const pins = [pin("2026-05-17", "pin1", "shizumu"), pin("2026-05-17", "pin2", "shizumu")];
    const out = dominantTrailSummary({ pages, pins, lineages, date: "2026-05-17" });
    expect(out).toEqual({
      focusText: "finishing the editor",
      trailCount: 2,
      pageCount: 2,
      pinCount: 2,
    });
  });

  it("uses 'no focus' when the dominant trail's page has no what_matters_now", () => {
    const pages = [p("2026-05-17", "p1", "shizumu", null)];
    const out = dominantTrailSummary({ pages, pins: [], lineages, date: "2026-05-17" });
    expect(out.focusText).toBe("no focus");
  });

  it("returns null for an empty day", () => {
    expect(dominantTrailSummary({ pages: [], pins: [], lineages, date: "2026-05-17" })).toBeNull();
  });
});
