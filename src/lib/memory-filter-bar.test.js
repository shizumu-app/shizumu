import { describe, it, expect } from "vitest";
import { activeFilterPills, memoryCountLine, dateFilterLabel, trailPoolCap } from "./memory-filter-bar.js";

describe("dateFilterLabel", () => {
  it("names every window memory offers", () => {
    expect(dateFilterLabel({ kind: "thisMonth" })).toBe("this month");
    expect(dateFilterLabel({ kind: "thisWeek" })).toBe("this week");
    expect(dateFilterLabel({ kind: "today" })).toBe("today");
    expect(dateFilterLabel({ kind: "specific", date: "2026-01-15" })).toBe("15 jan");
    expect(dateFilterLabel({ kind: "range", from: "2026-01-01", to: "2026-02-03" })).toBe("1 jan – 3 feb");
  });
  it("has no words for no window", () => {
    // "all" and null filter nothing, so no pill may claim otherwise.
    expect(dateFilterLabel({ kind: "all" })).toBeNull();
    expect(dateFilterLabel(null)).toBeNull();
  });
});

describe("activeFilterPills", () => {
  it("memory's opening state shows its month window as a pill (the hidden filter)", () => {
    const pills = activeFilterPills({ tab: "pins", dateFilter: { kind: "thisMonth" } });
    expect(pills).toEqual([{ id: "date", label: "this month", removeLabel: "remove this month", hides: true }]);
  });

  it("a trail is a removable pill but never the reason something is hidden", () => {
    const [trail] = activeFilterPills({ tab: "pages", trailLabel: "shizumu" });
    expect(trail).toMatchObject({ id: "trail", label: "shizumu", hides: false });
  });

  it("the pages tab shows every filter that acts on it, in a fixed order", () => {
    const pills = activeFilterPills({
      tab: "pages", trailLabel: "the book", dateFilter: { kind: "thisWeek" },
      sort: "updated_at", pinnedOnly: true, onPage: true,
    });
    expect(pills.map((p) => p.label)).toEqual(["the book", "this week", "recently edited", "pinned only", "on page"]);
  });

  it("the pins tab leaves out filters that do not act on pins", () => {
    // Pinned only, on page and the edited order filter or order the PAGE
    // list. A pill for them over the pins list would claim an effect that
    // is not there.
    const pills = activeFilterPills({ tab: "pins", sort: "updated_at", pinnedOnly: true, onPage: true });
    expect(pills).toEqual([]);
  });

  it("the default order is not a filter", () => {
    expect(activeFilterPills({ tab: "pages", sort: "date" })).toEqual([]);
  });
});

describe("memoryCountLine", () => {
  const month = activeFilterPills({ tab: "pins", dateFilter: { kind: "thisMonth" } });

  it("says how many pins the month window hides, and names it", () => {
    expect(memoryCountLine({ tab: "pins", shown: 1, total: 4, pills: month }))
      .toBe('1 of 4 pins · 3 hidden by "this month"');
  });

  it("counts pins on the pins tab, not pages", () => {
    expect(memoryCountLine({ tab: "pins", shown: 4, total: 4, pills: [] })).toBe("4 pins");
    expect(memoryCountLine({ tab: "pins", shown: 1, total: 1, pills: [] })).toBe("1 pin");
  });

  it("counts pages on the pages and trail map tabs", () => {
    expect(memoryCountLine({ tab: "pages", shown: 8, total: 8 })).toBe("8 pages");
    expect(memoryCountLine({ tab: "trailmap", shown: 1, total: 1 })).toBe("1 page");
  });

  it("a filter that hides nothing is not reported as hiding", () => {
    expect(memoryCountLine({ tab: "pins", shown: 4, total: 4, pills: month })).toBe("4 pins");
  });

  it("names every filter that hides when several do", () => {
    const pills = activeFilterPills({ tab: "pages", dateFilter: { kind: "today" }, pinnedOnly: true });
    expect(memoryCountLine({ tab: "pages", shown: 1, total: 5, pills }))
      .toBe('1 of 5 pages · 4 hidden by "today" and "pinned only"');
  });
});

// review #5: memory loads only the newest pages (Memory.svelte THREAD_CAP),
// while the trail row counts every page on the trail in SQL. Selecting
// "book" (40 pages, 3 of them among the newest 100) read "3 pages" beside a
// row that said 40. The count line now says which pool it counts.
describe("memoryCountLine when the loaded pages are capped", () => {
  it("names the cap and the trail's full count when the trail holds more", () => {
    expect(memoryCountLine({ tab: "pages", shown: 3, total: 3, pills: [], capped: { cap: 100, trailTotal: 40 } }))
      .toBe("3 pages from the newest 100 · 40 on this trail");
  });

  it("keeps what the filters hide in front of it", () => {
    const pills = activeFilterPills({ tab: "pages", pinnedOnly: true });
    expect(memoryCountLine({ tab: "pages", shown: 1, total: 3, pills, capped: { cap: 100, trailTotal: 40 } }))
      .toBe('1 of 3 pages · 2 hidden by "pinned only" · from the newest 100 · 40 on this trail');
  });

  it("says nothing more when every page of the trail is loaded", () => {
    // The pool holds the whole trail, so "3 pages" is already the truth.
    expect(memoryCountLine({ tab: "pages", shown: 3, total: 3, pills: [], capped: { cap: 100, trailTotal: 3 } })).toBe("3 pages");
    expect(memoryCountLine({ tab: "pages", shown: 3, total: 3, pills: [], capped: null })).toBe("3 pages");
  });
});

describe("trailPoolCap", () => {
  const lineages = [{ id: "book" }, { id: "ch1", parent_id: "book" }, { id: "other" }];
  const pageCounts = new Map([["book", 30], ["ch1", 10], ["other", 5]]);

  it("counts the trail and its nested trails once the pool is full", () => {
    expect(trailPoolCap({ poolSize: 100, cap: 100, searching: false, scope: new Set(["book", "ch1"]), pageCounts }))
      .toEqual({ cap: 100, trailTotal: 40 });
  });

  it("is null when the pool is not full, while searching, or with no trail chosen", () => {
    // Each of these already counts every page it could: a pool under the
    // cap holds them all, a search has its own results, and with no trail
    // there is no SQL count beside the line to disagree with.
    expect(trailPoolCap({ poolSize: 99, cap: 100, searching: false, scope: new Set(["book"]), pageCounts })).toBe(null);
    expect(trailPoolCap({ poolSize: 100, cap: 100, searching: true, scope: new Set(["book"]), pageCounts })).toBe(null);
    expect(trailPoolCap({ poolSize: 100, cap: 100, searching: false, scope: null, pageCounts })).toBe(null);
    expect(trailPoolCap({ poolSize: 100, cap: 100, searching: false, scope: "__untrailed__", pageCounts })).toBe(null);
  });
});
