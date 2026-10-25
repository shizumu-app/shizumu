import { describe, it, expect } from "vitest";
import {
  DATE_RANGES,
  DEFAULT_MODE,
  DEFAULT_RANGE,
  DEFAULT_SORT,
  MEMORY_MODES,
  SEARCH_DEBOUNCE_MS,
  SORTS,
  memoryDays,
  memoryFilterCount,
  memoryFilterSummary,
  memoryGroups,
  memoryPages,
  memoryPins,
  mergePinRows,
  pageRowLabel,
  searchRowShowing,
  yesterdayOf,
  memoryPinGroups,
} from "../memory-model.js";

// Fixed, so a date-range assertion means the same thing every day of the
// year. Every call below passes `todayStr` explicitly for the reason
// page-model.js's tests inject theirs: a helper that reads the clock turns
// a filter test into a test of what day it is.
const TODAY = "2026-09-01";

const page = (over = {}) => ({
  id: "p1",
  date: TODAY,
  page_number: 1,
  lineage_id: null,
  what_matters_now: "",
  pin_count: 0,
  ...over,
});

describe("memory-model — the controls' vocabulary", () => {
  it("offers the desktop's three modes, its labels, in its order", () => {
    // Read off Memory.svelte's own SegmentedControl. Asserted as the whole
    // list rather than as a membership check: §2 asks for "the existing
    // modes", so an extra one this screen invented is as wrong as a
    // missing one, and only an equality test can see that.
    expect(MEMORY_MODES.map((m) => [m.value, m.label])).toEqual([
      ["pages", "pages"],
      ["trailmap", "trail map"],
      ["pins", "pins"],
    ]);
    expect(DEFAULT_MODE).toBe("trailmap");
  });

  it("offers DatePopover's four ranges, and rests on all", () => {
    expect(DATE_RANGES.map((r) => r.value)).toEqual(["all", "today", "thisWeek", "thisMonth"]);
    // NOT the desktop's `thisMonth`. See the module header: on a phone the
    // controls are behind a sheet, so a resting range that already hides
    // last month is a filter nothing on screen admits to.
    expect(DEFAULT_RANGE).toBe("all");
  });

  it("hands getThread its own two order values", () => {
    // These strings go straight into `getThread(limit, 0, orderBy)`, so
    // they are the backend's vocabulary rather than labels — renaming a
    // value here would silently sort by nothing.
    expect(SORTS.map((s) => s.value)).toEqual(["date", "updated_at"]);
    expect(DEFAULT_SORT).toBe("date");
  });

  it("waits the desktop's own interval before it searches", () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(200);
  });
});

describe("memory-model — the search row's one exception", () => {
  it("shows the row whenever the bar is open", () => {
    expect(searchRowShowing({ collapsed: false, query: "" })).toBe(true);
  });

  it("takes it away when the bar collapses on an empty field", () => {
    expect(searchRowShowing({ collapsed: true, query: "" })).toBe(false);
  });

  it("keeps it while a query is live, however far the writer has scrolled", () => {
    // The whole reason this function exists. Search FILTERS the list here,
    // so collapsing the field away mid-results leaves a short list with no
    // visible cause and no control to clear it.
    expect(searchRowShowing({ collapsed: true, query: "the trail" })).toBe(true);
  });

  it("treats a field holding only spaces as empty", () => {
    // Not an edge case for its own sake: the host runs the same trim
    // before it decides whether to query at all, so a row that stayed for
    // whitespace would stay for a query that never ran.
    expect(searchRowShowing({ collapsed: true, query: "   " })).toBe(false);
  });
});

describe("memory-model — one pin list out of many calls", () => {
  it("keeps the first sighting of a pin and drops the repeats", () => {
    // getPins(id) walks ancestors upward, so a parent's pin comes back
    // once per descendant that asked. Order is the first list's.
    const rows = mergePinRows([
      [{ id: "g1" }],
      [{ id: "a" }, { id: "shared" }],
      [{ id: "shared" }, { id: "b" }],
    ]);
    expect(rows.map((r) => r.id)).toEqual(["g1", "a", "shared", "b"]);
  });

  it("drops a row with no id rather than counting it as a pin", () => {
    // A row with no id cannot be deduped, cannot be keyed by an {#each},
    // and cannot be opened. Keeping it would put a row on screen that
    // every later operation would then have to special-case.
    expect(mergePinRows([[null, { id: "a" }, {}]]).map((r) => r.id)).toEqual(["a"]);
  });

  it("survives a call that resolved to nothing", () => {
    // One failed fan-out leg must not empty the whole list — the host
    // catches, but Promise.all can also hand back an undefined from a
    // command that returned null.
    expect(mergePinRows([undefined, [{ id: "a" }]]).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("memory-model — which pages the screen shows", () => {
  it("narrows to the date range", () => {
    const rows = memoryPages({
      pages: [page({ id: "now" }), page({ id: "old", date: "2026-01-01" })],
      dateFilter: { kind: "today" },
      todayStr: TODAY,
    });
    expect(rows.map((p) => p.id)).toEqual(["now"]);
  });

  it("keeps only pages that have a pin when pinned only is on", () => {
    const rows = memoryPages({
      pages: [page({ id: "bare" }), page({ id: "kept", pin_count: 2 })],
      todayStr: TODAY,
      pinned: true,
    });
    expect(rows.map((p) => p.id)).toEqual(["kept"]);
  });

  it("intersects with what FTS5 matched", () => {
    const rows = memoryPages({
      pages: [page({ id: "a" }), page({ id: "b" })],
      todayStr: TODAY,
      matchingIds: new Set(["b"]),
    });
    expect(rows.map((p) => p.id)).toEqual(["b"]);
  });

  it("tells a query that matched nothing from no query at all", () => {
    // The two are one `null` apart at the call site and a whole screen
    // apart on the device. An empty Set is a real answer — the search
    // found nothing — and must empty the list; `null` means the writer has
    // not searched, and must not.
    const pages = [page({ id: "a" })];
    expect(memoryPages({ pages, todayStr: TODAY, matchingIds: new Set() })).toEqual([]);
    expect(memoryPages({ pages, todayStr: TODAY, matchingIds: null }).map((p) => p.id)).toEqual([
      "a",
    ]);
  });
});

describe("memory-model — which pins the screen shows", () => {
  const pin = (over = {}) => ({ id: "pin", object_type: "note", ...over });

  it("dates a pin by the day it was made on a page", () => {
    const rows = memoryPins({
      pins: [
        pin({ id: "today", source_page_date: TODAY }),
        pin({ id: "old", source_page_date: "2026-01-01" }),
      ],
      dateFilter: { kind: "today" },
      todayStr: TODAY,
    });
    expect(rows.map((p) => p.id)).toEqual(["today"]);
  });

  it("falls back to the day it was created when it carries no source date", () => {
    // An orphaned pin can outlive the page it points at (CLAUDE.md's pin
    // pointer clause), and a row with no date at all would be filtered out
    // by every range — silently disappearing from the one surface that is
    // supposed to still hold it.
    const rows = memoryPins({
      pins: [pin({ id: "orphan", created_at: `${TODAY}T09:00:00Z` })],
      dateFilter: { kind: "today" },
      todayStr: TODAY,
    });
    expect(rows.map((p) => p.id)).toEqual(["orphan"]);
  });

  it("matches the query against the pin's own text, not against FTS5", () => {
    // pages_fts indexes PAGES, so the ids a search returns can say nothing
    // about a pin. The haystack is pinSearchText's, which is why a block
    // title — a node attribute rather than a text node — matches here.
    const rows = memoryPins({
      pins: [
        pin({ id: "a", title: "the second reader" }),
        pin({
          id: "b",
          content: JSON.stringify({
            type: "doc",
            content: [{ type: "paragraph", attrs: { blockTitle: "the trail is for a project" } }],
          }),
        }),
      ],
      todayStr: TODAY,
      query: "project",
    });
    expect(rows.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("memory-model — the pages mode's buckets", () => {
  it("groups by date when the list is in date order", () => {
    const groups = memoryGroups({
      pages: [page({ id: "a", date: "2026-08-31" }), page({ id: "b", date: "2026-08-30" })],
      sort: "date",
    });
    expect(groups.map((g) => g.pages.map((p) => p.id))).toEqual([["a"], ["b"]]);
    expect(groups).toHaveLength(2);
  });

  it("collapses to one named bucket when the list is in edited order", () => {
    // Date headers over a list that ignores dates is the defect. The
    // desktop's own words for the replacement.
    const groups = memoryGroups({
      pages: [page({ id: "a", date: "2026-08-31" }), page({ id: "b", date: "2026-08-30" })],
      sort: "updated_at",
    });
    expect(groups).toEqual([{ label: "recently edited", pages: expect.any(Array) }]);
    expect(groups[0].pages.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("names no bucket for an empty list in edited order", () => {
    // Not "nothing happens": a bucket with a header and no rows would
    // render "recently edited" over the empty state, which reads as a
    // section that lost its contents rather than as an account with none.
    expect(memoryGroups({ pages: [], sort: "updated_at" })).toEqual([]);
  });
});

describe("memory-model — the timeline", () => {
  const lineages = [{ id: "L1", name: "the book", parent_id: null }];

  it("gives each day its trail blocks, newest day first", () => {
    const days = memoryDays({
      pages: [
        page({ id: "a", date: "2026-08-30", lineage_id: "L1" }),
        page({ id: "b", date: "2026-08-31", lineage_id: "L1" }),
      ],
      pins: [],
      lineages,
    });
    expect(days.map((d) => d.date)).toEqual(["2026-08-31", "2026-08-30"]);
    expect(days[0].groups.map((g) => g.name)).toEqual(["the book"]);
    expect(days[0].groups[0].pages.map((p) => p.id)).toEqual(["b"]);
  });

  it("gives a day whose only writing was pinned a row of its own", () => {
    // daysWithActivity buckets pins as well as pages, which is why the
    // screen's "is this mode empty" question counts DAYS here rather than
    // pages: a day with one pin and no surviving page still happened.
    const days = memoryDays({
      pages: [],
      pins: [{ id: "pin", lineage_id: "L1", source_page_date: "2026-08-29" }],
      lineages,
    });
    expect(days.map((d) => d.date)).toEqual(["2026-08-29"]);
    expect(days[0].groups[0].pins.map((p) => p.id)).toEqual(["pin"]);
  });
});

describe("memory-model — the day before", () => {
  it("steps back one calendar day", () => {
    expect(yesterdayOf("2026-05-20")).toBe("2026-05-19");
  });

  it("steps back across a month, and a year", () => {
    expect(yesterdayOf("2026-09-01")).toBe("2026-08-31");
    expect(yesterdayOf("2026-01-01")).toBe("2025-12-31");
  });

  it("steps back across a leap day", () => {
    expect(yesterdayOf("2028-03-01")).toBe("2028-02-29");
  });

  it("hands back what it was given when that is not a date", () => {
    // `dayLabel` compares its two reference dates by string equality, so a
    // NaN date turned into "NaN-NaN-NaN" would match nothing and quietly
    // stop "yesterday" ever appearing. Returning the input keeps the two
    // comparisons consistent: an unusable today yields an unusable
    // yesterday equal to it, and every row falls to its month-day label.
    expect(yesterdayOf("not a date")).toBe("not a date");
  });
});

describe("memory-model — what a row says", () => {
  it("labels a page with the writer's own focus line", () => {
    expect(pageRowLabel(page({ what_matters_now: "  the second reader  " }))).toBe(
      "the second reader",
    );
  });

  it("says untitled for a page that has not been given one", () => {
    // The row exists either way — it is a page that was written on. The
    // alternative is an empty line the writer cannot tell from a broken
    // one, which is the same case pin-label.js's last resort covers.
    expect(pageRowLabel(page({ what_matters_now: "   " }))).toBe("untitled");
    expect(pageRowLabel(page({ what_matters_now: null }))).toBe("untitled");
  });
});

describe("memory-model — what the bar's action says", () => {
  it("counts nothing at rest", () => {
    // The resting state is what the screen opens with, so the action reads
    // plain "filters" and the sheet offers no clear row. A count of one
    // here — which is what activeFilterCount would report for the
    // desktop's opening date range — would mark every fresh screen as
    // already filtered.
    expect(memoryFilterCount({ dateFilter: { kind: DEFAULT_RANGE } })).toBe(0);
    expect(memoryFilterCount({})).toBe(0);
  });

  it("counts each axis the writer moved", () => {
    expect(
      memoryFilterCount({ dateFilter: { kind: "thisWeek" }, sort: "updated_at", pinned: true }),
    ).toBe(3);
  });

  it("names each of them in the words its own control uses", () => {
    expect(
      memoryFilterSummary({
        query: "the trail",
        dateFilter: { kind: "thisWeek" },
        sort: "updated_at",
        pinned: true,
      }),
    ).toBe("“the trail” · this week · edited · pinned only");
  });

  it("says nothing when nothing is on", () => {
    // Reachable, and the screen renders it as the body of "nothing
    // matches": a mode can be empty with no filter at all (an account with
    // pins and no pages, read in pages mode). An empty body there is the
    // honest answer — there is no filter to name — and the title carries
    // the message.
    expect(memoryFilterSummary({})).toBe("");
  });
});

describe("memory-model — the trail scope (P3 Task 4)", () => {
  const pages = [
    page({ id: "a", lineage_id: "L1" }),
    page({ id: "b", lineage_id: "L3" }),
    page({ id: "c", lineage_id: "L2" }),
    page({ id: "d", lineage_id: null }),
  ];

  it("passes every page through when no trail is scoped", () => {
    expect(memoryPages({ pages, todayStr: TODAY, scope: null }).map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("keeps only the pages in the scope it was handed", () => {
    // The Set is what trail-index.js's `trailScope` produces for a parent
    // and its descendants; this module applies it and does not build it,
    // which is why the fixture is a Set rather than a lineage tree.
    expect(
      memoryPages({ pages, todayStr: TODAY, scope: new Set(["L1", "L3"]) }).map((p) => p.id),
    ).toEqual(["a", "b"]);
  });

  it("keeps only the untrailed pages for the sentinel", () => {
    expect(
      memoryPages({ pages, todayStr: TODAY, scope: "__untrailed__" }).map((p) => p.id),
    ).toEqual(["d"]);
  });

  it("scopes a pin by the trail it belongs to, not the page it came from", () => {
    // The desktop's call and its reason: "the pin's current scope rather
    // than its birth trail, so reassigned pins" follow where they were
    // moved to (Memory.svelte:439). `source_page_lineage_id` is the birth
    // trail and is deliberately not what filters.
    const pins = [
      { id: "p-a", lineage_id: "L1", source_page_lineage_id: "L2", source_page_date: TODAY },
      { id: "p-b", lineage_id: "L2", source_page_lineage_id: "L1", source_page_date: TODAY },
    ];
    expect(
      memoryPins({ pins, todayStr: TODAY, scope: new Set(["L1"]) }).map((p) => p.id),
    ).toEqual(["p-a"]);
  });

  it("narrows the scope before the date range, and both still apply", () => {
    // Order is not observable in the result, so this asserts the property
    // that is: the two filters compose rather than one replacing the other.
    const rows = [
      page({ id: "a", lineage_id: "L1", date: TODAY }),
      page({ id: "old", lineage_id: "L1", date: "2020-01-01" }),
      page({ id: "c", lineage_id: "L2", date: TODAY }),
    ];
    expect(
      memoryPages({
        pages: rows,
        todayStr: TODAY,
        scope: new Set(["L1"]),
        dateFilter: { kind: "today" },
      }).map((p) => p.id),
    ).toEqual(["a"]);
  });

  it("names the scope in the summary, first, before the query's own words", () => {
    expect(memoryFilterSummary({ trail: "the book" })).toBe("the book");
    expect(memoryFilterSummary({ trail: "the book", query: "draft", pinned: true })).toBe(
      "the book · “draft” · pinned only",
    );
  });

  it("leaves the scope out of the count on the filters action", () => {
    // The asymmetry is deliberate and memory-model's own header argues it:
    // that count labels a sheet with no trail control in it, so counting
    // the scope there would offer a way to clear a filter the sheet cannot
    // see. The summary above is where it is named instead, because that
    // string is the only thing on screen that can say why an empty list is
    // empty.
    expect(memoryFilterCount({ trail: "the book" })).toBe(0);
  });
});

describe("memory-model — the pins mode, grouped by trail", () => {
  const LINEAGES = [
    { id: "L1", name: "the book", parent_id: null },
    { id: "L2", name: "a job search", parent_id: null },
  ];
  const pin = (id, lineage_id) => ({ id, lineage_id, content: id });

  it("puts each trail's pins under the trail's own name", () => {
    // ASKED FOR, from a phone: "when all trails selected the pins tab: pins
    // should be grouped by trails to have clear vision". Across an account
    // with several trails the flat list is every pin ever kept, in one
    // column, with nothing saying which project each belongs to — the
    // opposite of what the cross-product is for.
    const groups = memoryPinGroups({
      pins: [pin("a", "L1"), pin("b", "L2"), pin("c", "L1")],
      lineages: LINEAGES,
      scope: null,
    });
    expect(groups.map((g) => [g.label, g.pins.map((p) => p.id)])).toEqual([
      ["the book", ["a", "c"]],
      ["a job search", ["b"]],
    ]);
  });

  it("keeps the order the trails are listed in, not the order pins arrive", () => {
    // The trail list is stable and the pin list is not — it comes back
    // ordered by when each pin was made. Grouping by first sighting would
    // reshuffle the headings every time a pin was added, under a reader
    // who is scanning for one of them.
    const groups = memoryPinGroups({
      pins: [pin("b", "L2"), pin("a", "L1")],
      lineages: LINEAGES,
      scope: null,
    });
    expect(groups.map((g) => g.label)).toEqual(["the book", "a job search"]);
  });

  it("gathers the pins on no trail at the end, under their own heading", () => {
    // Last, because a trail is a project and the loose ones are the
    // remainder — and named rather than left unlabelled, since a group with
    // no heading under a list of headed ones reads as a rendering fault.
    const groups = memoryPinGroups({
      pins: [pin("loose", null), pin("a", "L1")],
      lineages: LINEAGES,
      scope: null,
    });
    expect(groups.map((g) => [g.label, g.pins.map((p) => p.id)])).toEqual([
      ["the book", ["a"]],
      ["no trail", ["loose"]],
    ]);
  });

  it("names a trail that is not in the list rather than dropping its pins", () => {
    // A pin can outlive the lineage row the screen knows about — a trail
    // deleted on another device, a list that has not re-read yet. Dropping
    // the pin would be the list quietly losing writing; the heading says
    // what little is known instead.
    const groups = memoryPinGroups({
      pins: [pin("a", "GONE")],
      lineages: LINEAGES,
      scope: null,
    });
    expect(groups.map((g) => [g.label, g.pins.map((p) => p.id)])).toEqual([
      ["a trail that is no longer listed", ["a"]],
    ]);
  });

  it("does not group at all once a single trail is scoped", () => {
    // NOT "nothing happens": one heading over a list that is already one
    // trail's pins is a heading that repeats the control above it. The
    // single unlabelled group is what the screen renders today, and scoped
    // is the one case where the flat list was never the problem.
    const groups = memoryPinGroups({
      pins: [pin("a", "L1"), pin("c", "L1")],
      lineages: LINEAGES,
      scope: new Set(["L1"]),
    });
    expect(groups).toEqual([{ id: "scoped", label: "", pins: [pin("a", "L1"), pin("c", "L1")] }]);
  });

  it("answers with nothing for no pins, so the caller shows its empty state", () => {
    expect(memoryPinGroups({ pins: [], lineages: LINEAGES, scope: null })).toEqual([]);
  });

  it("identifies a group by the trail, not by its name", () => {
    // Nothing stops a writer calling two projects the same thing, and a
    // caller keying its markup on the heading would throw
    // `each_key_duplicate` and stop re-rendering the whole screen — which
    // is what the pages mode did on a device, keyed on groupByDate's own
    // heading, taking the filters sheet down with it.
    const groups = memoryPinGroups({
      pins: [pin("a", "L1"), pin("b", "L3")],
      lineages: [...LINEAGES, { id: "L3", name: "the book", parent_id: null }],
      scope: null,
    });
    expect(groups.map((g) => g.label)).toEqual(["the book", "the book"]);
    expect(groups.map((g) => g.id)).toEqual(["L1", "L3"]);
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
  });
});
