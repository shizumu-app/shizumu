import { describe, it, expect } from "vitest";
import {
  DEFAULT_RANGE,
  DEFAULT_SORT,
  memoryFilterBar,
  removeMemoryFilter,
  showEverythingPatch,
} from "../memory-model.js";

// The phone's memory says which filters are on and what they hide (0.8.2,
// spec 2026-11-01 §2 and §4). Its own file so the date the fixtures hang on
// is visible next to the assertions that depend on it.
const TODAY = "2026-09-15";

const page = (id, date, over = {}) => ({ id, date, page_number: 1, lineage_id: null, pin_count: 0, ...over });
const pin = (id, date, over = {}) => ({ id, source_page_date: date, lineage_id: null, title: id, content: id, ...over });

const PAGES = [page("a", TODAY), page("b", "2026-09-02", { pin_count: 1 }), page("c", "2026-07-01")];
const PINS = [pin("x", TODAY), pin("y", "2026-08-01"), pin("z", "2026-06-01"), pin("w", "2026-05-01")];

const bar = (over) => memoryFilterBar({ mode: "pages", pages: PAGES, pins: PINS, todayStr: TODAY, ...over });

describe("memoryFilterBar", () => {
  it("names a date filter on the pins mode, and counts pins, not pages", () => {
    // THE BUG (desktop, 2026-11-01): the pins tab showed 1 pin of 4 under a
    // month filter nothing on screen named, and its counter read "8 pages".
    const out = bar({ mode: "pins", dateFilter: { kind: "thisMonth" } });
    expect(out.pills.map((p) => p.label)).toEqual(["this month"]);
    expect(out.countLine).toBe('1 of 4 pins · 3 hidden by "this month"');
  });

  it("says only the count when nothing is hidden", () => {
    expect(bar({}).countLine).toBe("3 pages");
    expect(bar({ mode: "pins" }).countLine).toBe("4 pins");
    // At rest the phone's range is `all`, so there is nothing to name.
    expect(bar({}).pills).toEqual([]);
    expect(bar({}).canShowEverything).toBe(false);
  });

  it("names every hiding filter on the pages mode", () => {
    const out = bar({ dateFilter: { kind: "thisMonth" }, pinned: true });
    expect(out.pills.map((p) => p.id)).toEqual(["date", "pinned"]);
    expect(out.countLine).toBe('1 of 3 pages · 2 hidden by "this month" and "pinned only"');
  });

  it("shows the trail as a pill but never as the reason something is hidden", () => {
    // The trail is the view chosen, not a filter on it.
    const out = bar({ scope: new Set(["L1"]), scopeName: "the book", pages: [page("a", TODAY, { lineage_id: "L1" }), page("b", TODAY)] });
    expect(out.pills).toEqual([{ id: "trail", label: "the book", removeLabel: "remove the book", hides: false }]);
    expect(out.countLine).toBe("1 page");
  });

  it("offers no pinned-only pill on the pins mode, where it filters nothing", () => {
    // Not a vacuous absence: memoryPins takes no `pinned`, so a pill there
    // would claim a filter that does nothing to the list under it.
    expect(bar({ mode: "pins", pinned: true }).pills).toEqual([]);
  });

  it("names a non-default order, which hides nothing", () => {
    const out = bar({ sort: "updated_at" });
    expect(out.pills).toEqual([{ id: "sort", label: "recently edited", removeLabel: "remove recently edited", hides: false }]);
  });

  it("offers show everything while a search is on, even with no pill", () => {
    expect(bar({ query: "relay" }).canShowEverything).toBe(true);
  });
});

describe("removing a pill", () => {
  it("clears the one filter the pill names", () => {
    expect(removeMemoryFilter("trail")).toEqual({ trail: null });
    // A preset and a picked day are one date filter: both go.
    expect(removeMemoryFilter("date")).toEqual({ range: DEFAULT_RANGE, day: null });
    expect(removeMemoryFilter("sort")).toEqual({ sort: DEFAULT_SORT });
    expect(removeMemoryFilter("pinned")).toEqual({ pinned: false });
  });

  it("changes nothing for a filter the phone does not have", () => {
    // `onPage` is the desktop's; guessing at it here would clear something
    // the writer did not ask to clear.
    expect(removeMemoryFilter("onPage")).toEqual({});
  });

  it("shows everything: every filter off and the search cleared", () => {
    expect(showEverythingPatch()).toEqual({
      trail: null, range: DEFAULT_RANGE, day: null, sort: DEFAULT_SORT, pinned: false, query: "",
    });
  });
});
