import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { readFileSync } from "node:fs";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import MemoryScreen from "../MemoryScreen.svelte";

afterEach(cleanupAll);

// Fixed dates, so "which day is it" never decides whether an assertion
// passes. TODAY is deliberately not the real one: `dayLabel` answers
// "today" / "yesterday" for the two nearest days and a month-day label for
// everything else, and a fixture that drifted across that boundary
// overnight would change what the day headers say.
const TODAY = "2026-05-20";
const DAY_ONE = "2026-05-18";
const DAY_TWO = "2026-05-19";

const page = (over = {}) => ({
  id: "p1",
  date: DAY_TWO,
  page_number: 1,
  lineage_id: "L1",
  what_matters_now: "the second reader",
  pin_count: 0,
  ...over,
});

const LINEAGES = [{ id: "L1", name: "the book", parent_id: null, mode: "discrete" }];

function mountMemory(props = {}) {
  return render(MemoryScreen, { todayStr: TODAY, lineages: LINEAGES, ...props });
}

// PageScreen.test.js's own helper, and its flushSync-before-the-event is
// load-bearing for the same reason: Screen binds its content element in an
// effect, so the first dispatch after mount would otherwise reach a handler
// that still sees null and early-returns.
function scrollTo(target, top) {
  flushSync();
  const band = target.querySelector(".shell-screen-content");
  Object.defineProperty(band, "scrollTop", { value: top, configurable: true });
  band.dispatchEvent(new Event("scroll"));
  flushSync();
}

const searchRow = (target) => target.querySelector(".memory-search");
// The rows that are PAGES or PINS: every one of them sits inside a
// RowGroup's body in all three modes. The trail map's trail header is a
// `Row` too — inert, outside any group — so a reader of every
// `.shell-row-label` would count "the book" among the pages under it.
const rowLabels = (target) =>
  [...target.querySelectorAll(".shell-row-group-body .shell-row-label")].map((n) =>
    n.textContent.trim(),
  );
const pageRow = (target) => target.querySelector(".shell-row-group-body .shell-row");
const dayLabels = (target) =>
  [...target.querySelectorAll(".memory-day-head .shell-eyebrow")].map((n) => n.textContent.trim());
const trailHeads = (target) =>
  [...target.querySelectorAll(".memory-trail-name")].map((n) =>
    n.textContent.trim(),
  );
const segments = (target) =>
  [...target.querySelectorAll(".seg-btn")].map((b) => b.textContent.trim());
const pickSegment = (target, label) => {
  const button = [...target.querySelectorAll(".seg-btn")].find(
    (b) => b.textContent.trim() === label,
  );
  button.click();
  flushSync();
};

describe("MemoryScreen — the search that rides the bar", () => {
  it("puts the field in the nav band, not in the list", () => {
    // §2: it "rides in the bar". In the content band it would scroll away
    // with the first flick, which is the opposite of riding.
    const { target } = mountMemory({ pages: [page()] });
    expect(target.querySelector(".shell-screen-nav .memory-search")).not.toBeNull();
    expect(target.querySelector(".shell-screen-content .memory-search")).toBeNull();
  });

  it("collapses past the threshold and comes back below it", () => {
    const { target } = mountMemory({ pages: [page()] });
    expect(searchRow(target)).not.toBeNull();

    scrollTo(target, 40);
    expect(searchRow(target)).toBeNull();

    scrollTo(target, 2);
    expect(searchRow(target)).not.toBeNull();
  });

  it("holds its state inside the hysteresis band", () => {
    // navCollapsed's 24/8 band, reached through this screen's own feedback
    // of its last answer. Between the two numbers the answer is whatever it
    // already was — asserting no change here asserts the band exists, and
    // it is what stops the bar flipping on every frame a scroll position
    // hovers on a single threshold.
    const { target } = mountMemory({ pages: [page()] });
    scrollTo(target, 40);
    expect(searchRow(target)).toBeNull();
    scrollTo(target, 16);
    expect(searchRow(target)).toBeNull();
  });

  it("keeps the field on screen while a query is live", () => {
    // The exception searchRowShowing exists for, driven through the screen.
    // Search filters this list, so collapsing the field away mid-results
    // leaves a short list with no visible cause and nothing to clear.
    const { target } = mountMemory({
      pages: [page()],
      query: "reader",
      matchingIds: new Set(["p1"]),
    });
    scrollTo(target, 400);
    expect(searchRow(target)).not.toBeNull();
    expect(target.querySelector(".memory-search input").value).toBe("reader");
  });

  it("does not collapse the field under the keyboard", () => {
    // THIS PASSES BECAUSE THE PROP DOES NOT EXIST, and that is the
    // assertion rather than a hole in it: `keyboardOpen` is an unknown prop
    // here, so the screen ignores it. The guard is against the change, not
    // a description of a branch — wire keyboardOpen through to navCollapsed
    // (which is what PageScreen does, and the obvious thing to copy) and
    // this goes red, because that module collapses on the keyboard
    // unconditionally and the field IS the bar's second line. Proven by
    // doing exactly that: the assertion failed, and the wiring was undone.
    //
    // The cost of the defect is not cosmetic. The keyboard on this screen
    // has one cause — a tap on this field — so a collapse under it unmounts
    // the field mid-tap, drops focus, and takes the keyboard back down.
    const { target } = mountMemory({ pages: [page()], keyboardOpen: true });
    expect(searchRow(target)).not.toBeNull();
  });

  it("hands what is typed straight up, without waiting", () => {
    // The debounce is the host's — the field reports every keystroke and
    // the host decides when to ask the backend. A debounce inside the
    // component would put the delay between the writer and their own
    // characters.
    const onSearch = vi.fn();
    const { target } = mountMemory({ pages: [page()], onSearch });
    const input = target.querySelector(".memory-search input");
    input.value = "trail";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(onSearch).toHaveBeenCalledWith("trail");
  });
});

describe("MemoryScreen — the modes", () => {
  it("offers the desktop's three", () => {
    const { target } = mountMemory({ pages: [page()] });
    expect(segments(target)).toEqual(["pages", "trail map", "pins"]);
  });

  it("offers none of them over an account with nothing in it", () => {
    // Three ways to look at the same empty screen is three affordances
    // onto nothing — the rule pin-filter.js states for its own segment.
    const { target } = mountMemory({ pages: [], pins: [] });
    expect(segments(target)).toEqual([]);
    expect(target.querySelector(".empty-title").textContent).toContain("no writing yet");
  });

  it("opens on the timeline: a day, its trail, and the pages under it", () => {
    const { target } = mountMemory({
      pages: [
        page({ id: "a", date: DAY_ONE, what_matters_now: "the first draft" }),
        page({ id: "b", date: DAY_TWO, what_matters_now: "the second reader" }),
      ],
    });
    // Newest day first, and named the way every other day in the shell is
    // named (page-model.js's dayLabel, one spelling for the whole tree).
    // The day is an Eyebrow beside the dot — the primitive, not a div of
    // this screen's own.
    expect(
      dayLabels(target),
      // DAY_TWO is the day before this screen's own `todayStr`, so it is
      // "yesterday" — and it is "yesterday" whatever the machine's clock
      // says, which is the point. `dayLabel` defaults its two reference
      // dates from the real clock independently, so a screen that passed
      // only `todayDateStr` would label this row "19 may" and would call
      // some unrelated row "yesterday" instead. See yesterdayOf.
    ).toEqual(["yesterday", "18 may"]);
    expect(trailHeads(target)).toEqual(["the book", "the book"]);
    expect(rowLabels(target)).toEqual(["the second reader", "the first draft"]);
  });

  it("names the trail as a label over its pages, not as a row among them", () => {
    // The fourth device pass: on a day with two trails the photograph
    // showed four identical 44px lines, two of them trails. The name is a
    // label — no tab stop, no chevron, no row — and the pages under it
    // are a group with a surface, which is the distinction the rest of
    // the shell already draws between a container and its contents.
    const { target } = mountMemory({ pages: [page()], onPage: () => {} });
    const head = target.querySelector(".memory-trail-head");
    expect(head.querySelector(".shell-row")).toBeNull();
    expect(head.textContent.trim()).toBe("the book");
    // The pages are in an INSET group (not flush): the surface is what
    // separates one trail's pages from the next trail's on the same day.
    const group = target.querySelector(".memory-trail .shell-row-group");
    expect(group).not.toBeNull();
    expect(group.classList.contains("flush")).toBe(false);
    // And the label is outside it — a header inside would be ruled off
    // from its own first page.
    expect(target.querySelector(".shell-row-group-body .memory-trail-head")).toBeNull();
  });

  it("counts the day's pins beside the trail that kept them", () => {
    const { target } = mountMemory({
      pages: [page({ date: DAY_TWO })],
      pins: [
        { id: "pin-a", lineage_id: "L1", source_page_date: DAY_TWO },
        { id: "pin-b", lineage_id: "L1", source_page_date: DAY_TWO },
      ],
    });
    // A Chip in accent — the trail index's own chip for the same count,
    // and the desktop's `.pins-chip` before it.
    const chip = target.querySelector(".memory-trail-chips .shell-chip");
    expect(chip.textContent.trim()).toBe("2 pins");
    expect(chip.dataset.tone).toBe("accent");
  });

  it("draws no chip line for a trail with nothing pinned", () => {
    // Nothing is the right answer, not a missing feature: `0 pins` under
    // every trail on every day would be the timeline's loudest word, and
    // the index draws its pins chip only over zero for the same reason.
    const { target } = mountMemory({ pages: [page()] });
    expect(target.querySelector(".memory-trail-chips")).toBeNull();
  });

  it("puts a dot on every day and marks only today", () => {
    const { target } = mountMemory({
      pages: [
        page({ id: "a", date: TODAY }),
        page({ id: "b", date: DAY_TWO }),
        page({ id: "c", date: DAY_ONE }),
      ],
    });
    const dots = [...target.querySelectorAll(".memory-day-dot")];
    expect(dots.length).toBe(3);
    expect(dots.map((d) => d.classList.contains("today"))).toEqual([true, false, false]);
  });

  it("draws the spine and its dots in the grammar the timeline uses", () => {
    // This used to hold the four rules EQUAL to TrailIndexScreen's copies
    // — the map was day-first and the index trail-first, but the spine
    // was one drawing declared in two files, and the pairing is what kept
    // them from drifting. The index is gone (the fifth device pass turned
    // its one job, scoping, into a sheet), and with it the second copy,
    // so what is left to hold is the grammar itself: a line at the
    // hairline token, a dot in the accent with a canvas halo so the line
    // does not run through it, and today marked by a ring rather than by
    // a different fill.
    //
    // Read from source, because jsdom applies no scoped stylesheet.
    const memory = readFileSync("src/shell/MemoryScreen.svelte", "utf8");
    const rule = (selector) => {
      const m = new RegExp(`\\n\\s*${selector}\\s*\\{([^}]*)\\}`).exec(memory);
      expect(m, `no ${selector} rule`).toBeTruthy();
      return m[1].replace(/\s+/g, " ").trim();
    };
    expect(rule("\\.memory-spine")).toMatch(/border-left: 1px solid var\(--hairline\)/);
    const dot = rule("\\.memory-day-dot");
    expect(dot).toMatch(/background: var\(--warm-accent\)/);
    expect(dot).toMatch(/box-shadow: 0 0 0 3px var\(--canvas-bg\)/);
    expect(rule("\\.memory-day-dot\\.today")).toMatch(/box-shadow:[^;]*var\(--warm-accent\)/);
    expect(rule("\\.memory-day-dot\\.today")).not.toMatch(/background/);
  });

  it("lists the pages under date headings in the pages mode", () => {
    const { target } = mountMemory({
      pages: [
        page({ id: "a", date: DAY_TWO, what_matters_now: "the second reader" }),
        page({ id: "b", date: DAY_ONE, what_matters_now: "the first draft" }),
      ],
    });
    pickSegment(target, "pages");
    // One RowGroup per date, the date as its eyebrow. The heading used
    // to be a div of this screen's own in the interface face; the eyebrow
    // is the same words through the primitive every grouped list uses.
    const groups = [...target.querySelectorAll(".shell-row-group")];
    expect(groups.map((g) => g.querySelector(".shell-eyebrow").textContent.trim())).toEqual([
      "tue · 19 may",
      "mon · 18 may",
    ]);
    expect(
      groups.map((g) =>
        [...g.querySelectorAll(".shell-row-label")].map((n) => n.textContent.trim()),
      ),
    ).toEqual([["the second reader"], ["the first draft"]]);
  });

  it("lists the pins in one group in the pins mode", () => {
    const { target } = mountMemory({
      pages: [page()],
      pins: [
        { id: "pin-a", object_type: "note", title: "one", lineage_id: "L1" },
        { id: "pin-b", object_type: "note", title: "two", lineage_id: "L1" },
      ],
    });
    pickSegment(target, "pins");
    const groups = target.querySelectorAll(".shell-row-group");
    expect(groups.length).toBe(1);
    // The status wrapper is the group's direct child, which is what
    // RowGroup rules between — a wrapper OUTSIDE the group would leave the
    // rows unruled and the dimming would still look right.
    expect([...groups[0].querySelectorAll(".shell-row-group-body > .memory-pin")].length).toBe(2);
  });

  it("offers the modes through the shell's own Segment", () => {
    // The P3 debt "the memory mode segment is 40px" closes here, and the
    // floor is not asserted in this file: Segment.test.js holds
    // `min-height: var(--tap)` on the leaf's segments by source-read, so
    // what this proves is that memory reaches the leaf THROUGH the
    // wrapper rather than importing it bare — the wrapper's root class
    // around the radiogroup, and the import line itself, since a screen
    // could render both.
    const { target } = mountMemory({ pages: [page()] });
    expect(target.querySelector('.memory-modes .shell-segment [role="radiogroup"]')).not.toBeNull();
    // Import statements, not mentions: the header names the leaf by path
    // when it says what the wrapper replaced.
    const src = readFileSync("src/shell/MemoryScreen.svelte", "utf8");
    expect(src).toMatch(/from "\.\/ui\/Segment\.svelte"/);
    expect(src).not.toMatch(/from "[^"]*lib\/ui\/SegmentedControl\.svelte"/);
  });

  it("names the trail beside a page in the pages mode", () => {
    // The timeline groups by trail, so it needs no such label; the flat
    // list has nothing else to say which trail a row belongs to.
    const { target } = mountMemory({ pages: [page()] });
    pickSegment(target, "pages");
    expect(target.querySelector(".shell-row-value").textContent.trim()).toBe("the book");
  });

  it("lists the pins in the pins mode", () => {
    const { target } = mountMemory({
      pages: [page()],
      pins: [
        { id: "pin-a", object_type: "note", title: "what the trail is for", lineage_id: "L1" },
      ],
    });
    pickSegment(target, "pins");
    expect(rowLabels(target)).toEqual(["what the trail is for"]);
  });

  it("survives a page list whose dates are not in order", () => {
    // MEASURED ON A DEVICE, as a thrown `each_key_duplicate` that stopped
    // the whole screen updating — the filters sheet's `clear filters` row
    // would not withdraw after it had been tapped, because nothing was
    // re-rendering any more.
    //
    // The sequence: `clear filters` resets the sort to `date` and re-reads,
    // so for the turn between the reset and the answer the screen holds an
    // updated_at-ordered list while believing it is date-ordered.
    // `groupByDate` was RUN-LENGTH — it opened a new group only when the
    // label changed — so an interleaved list emitted the same label twice,
    // and the markup keyed its groups on exactly that label.
    //
    // FIXED FROM BOTH SIDES, and the two halves landed on separate branches
    // before meeting here. This screen stopped trusting the helper that
    // fills a key and keys on an id unique by construction. `groupByDate`
    // itself (lib/memory-filters.js, main) stopped being run-length and
    // emits one group per label, first sighting deciding where it sits.
    //
    // That second half is why the order below is not the order the pages
    // were handed in: the two TODAY pages are one group now, so the later
    // one rises to sit beside the earlier. It is the quieter version of the
    // same bug fixed — one day used to appear as two headings with its
    // pages split between them — and it also makes the crash structurally
    // impossible rather than merely survivable, since a duplicate label can
    // no longer be emitted. What this still proves is the screen rendering
    // every page it was given, out-of-order input and all.
    const { target } = mountMemory({
      pages: [
        page({ id: "a", date: TODAY, what_matters_now: "this morning" }),
        page({ id: "b", date: "2026-09-16", what_matters_now: "a while back" }),
        page({ id: "c", date: TODAY, what_matters_now: "this afternoon" }),
      ],
    });
    pickSegment(target, "pages");
    expect(rowLabels(target)).toEqual(["this morning", "this afternoon", "a while back"]);
  });

  it("heads each trail's pins with the trail's name when nothing is scoped", () => {
    // ASKED FOR, from a phone: "when all trails selected the pins tab: pins
    // should be grouped by trails to have clear vision". The eyebrow is the
    // heading RowGroup already draws, so what is asserted here is that the
    // screen asks for one group per trail — memoryPinGroups owns which
    // groups and in what order, and has its own tests.
    const { target } = mountMemory({
      pages: [page()],
      lineages: [
        { id: "L1", name: "the book", parent_id: null },
        { id: "L2", name: "a job search", parent_id: null },
      ],
      pins: [
        { id: "p1", object_type: "note", title: "chapter one", lineage_id: "L1" },
        { id: "p2", object_type: "note", title: "the cover letter", lineage_id: "L2" },
        { id: "p3", object_type: "note", title: "a loose thought", lineage_id: null },
      ],
    });
    pickSegment(target, "pins");
    expect(
      [...target.querySelectorAll(".shell-eyebrow")].map((n) => n.textContent.trim()),
    ).toEqual(["the book", "a job search", "no trail"]);
    expect(rowLabels(target)).toEqual(["chapter one", "the cover letter", "a loose thought"]);
  });

  it("draws no heading at all once a single trail is scoped", () => {
    // NOT "nothing happens": one heading over a list that is already one
    // trail's pins repeats the control that scoped it. The screen renders
    // exactly as it did before the grouping landed, which is why the scoped
    // case needed no change at the call site.
    const { target } = mountMemory({
      pages: [page()],
      // The SCREEN's own scope, by the id the trail index selects —
      // `scope` is derived from it inside MemoryScreen (trailScope), so
      // handing one in directly would set a prop the component ignores and
      // this test would pass against ungrouped output.
      trailScopeId: "L1",
      pins: [{ id: "p1", object_type: "note", title: "chapter one", lineage_id: "L1" }],
    });
    pickSegment(target, "pins");
    expect(
      [...target.querySelectorAll(".shell-eyebrow")].map((n) => n.textContent.trim()),
    ).toEqual([]);
    expect(rowLabels(target)).toEqual(["chapter one"]);
  });

  it("dims a pin whose source page is gone rather than dropping it", () => {
    // CLAUDE.md's pin pointer clause: a pin survives orphaned with its
    // cache intact, so the writing stays reachable through it. A row that
    // vanished would say the opposite.
    const { target } = mountMemory({
      pages: [page()],
      pins: [{ id: "pin-a", object_type: "note", title: "kept", status: "orphaned" }],
    });
    pickSegment(target, "pins");
    expect(target.querySelector(".memory-pin").dataset.pinStatus).toBe("orphaned");
  });
});

describe("MemoryScreen — what it says when there is nothing to show", () => {
  it("says it is reading before it says there is nothing", () => {
    // Two facts, two states. Telling a writer with two years of pages that
    // they have none, for the length of a round trip, is the defect.
    const { target } = mountMemory({ loading: true });
    expect(target.querySelector(".empty-title").textContent).toContain("reading memory");
  });

  it("keeps the list it already has while it re-reads", () => {
    // A re-read is not a first read: the sort changing, or memory being
    // re-entered, would otherwise blank a screenful of days for a round
    // trip. Pages do not stop existing, so the stale list is the right list
    // plus whatever has been written since — the same call the host makes
    // about its own lists when a read fails.
    const { target } = mountMemory({ pages: [page()], loading: true });
    expect(target.querySelector(".empty-title")).toBeNull();
    expect(rowLabels(target)).toEqual(["the second reader"]);
  });

  it("tells an empty mode from an empty account", () => {
    // An account with pins and no pages, read in the pages mode. "Nothing
    // matches" there would blame filters that are not on.
    const { target } = mountMemory({
      pages: [],
      pins: [{ id: "pin-a", object_type: "note", title: "kept", source_page_date: DAY_TWO }],
    });
    pickSegment(target, "pages");
    expect(target.querySelector(".empty-title").textContent).toContain("no writing yet");
  });

  it("names what is narrowing the list when a filter empties it", () => {
    const { target } = mountMemory({
      pages: [page({ pin_count: 0 })],
      pinned: true,
      dateFilter: { kind: "thisWeek" },
    });
    expect(target.querySelector(".empty-title").textContent).toContain("nothing matches");
    expect(target.querySelector(".empty-body").textContent).toContain("this week · pinned only");
  });
});

describe("MemoryScreen — what it reports, and what it does not claim", () => {
  it("marks its scroller as the canvas", () => {
    // §1's row is a PAIR — "swipe up at scroll bottom → memory; swipe down
    // at memory's top → page" — and this is its second half. Without the
    // region on this element the way back by gesture does not exist.
    const { target } = mountMemory({ pages: [page()] });
    const band = target.querySelector(".shell-screen-content");
    expect(band.dataset.shellRegion).toBe("canvas");
  });

  it("reports its scroll boundaries at mount, before any scroll", () => {
    // A long list is scrolled before it is swiped, but a short one never
    // is — and the swipe down at the TOP is the gesture a writer makes the
    // instant they arrive. Screen's mount report is what makes it reachable.
    const onScrollEdges = vi.fn();
    mountMemory({ pages: [page()], onScrollEdges });
    flushSync();
    expect(onScrollEdges).toHaveBeenCalledWith({ atTop: true, atBottom: true });
  });

  it("renders a page row as text, not as a control, until it has somewhere to go", () => {
    // The destination is the reading view, and the HOST wires it (P3 Task
    // 4) — this screen has never known what a row opens, so a host that
    // passes no `onPage` still gets a readable list. Asserting the ELEMENT
    // rather than asserting that a click does nothing: Row renders a
    // real <button>
    // only when it has an onSelect, so a row with no destination is out of
    // the tab order and shows no chevron — it promises nothing rather than
    // promising and failing.
    const { target } = mountMemory({ pages: [page()] });
    const row = pageRow(target);
    expect(row.tagName).toBe("DIV");
    expect(target.querySelector(".shell-row-chevron")).toBeNull();
  });

  it("makes a page row a control the moment the host hands it a destination", () => {
    // The other half of the assertion above — proof that the absence is
    // the missing prop and not a screen that cannot offer rows at all.
    const onPage = vi.fn();
    const { target } = mountMemory({ pages: [page()], onPage });
    const row = pageRow(target);
    expect(row.tagName).toBe("BUTTON");
    row.click();
    expect(onPage).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });

  it("counts the filters that are on, on the bar's own action", () => {
    const { target } = mountMemory({
      pages: [page()],
      onFilters: () => {},
      dateFilter: { kind: "today" },
      pinned: true,
    });
    expect(target.querySelector(".shell-navbar-action").textContent.trim()).toBe("filters · 2");
  });

  it("names each action with an id a tap can address", () => {
    // The LABELS are not handles: this one reads `filters · 2` the moment a
    // filter is on, and the trail action is named after whichever trail is
    // scoped. A device scenario matching the words would break on exactly
    // the states worth driving, so NavBar writes `data-action-id` — the
    // convention `data-tab-id` and `data-button-id` already follow, and the
    // handle `scripts/device/scenarios/memory-filters.mjs` taps.
    const { target } = mountMemory({
      pages: [page()],
      onFilters: () => {},
      onTrails: () => {},
      pinned: true,
    });
    expect(
      [...target.querySelectorAll(".shell-navbar-action")].map((b) => b.dataset.actionId),
    ).toEqual(["filters", "trails"]);
  });

  it("offers no filters action when the host has no sheet to open", () => {
    // NavBar renders whatever actions it is given, so a label with no
    // handler would be a bar button that does nothing at all.
    const { target } = mountMemory({ pages: [page()] });
    expect(target.querySelector(".shell-navbar-action")).toBeNull();
  });
});

describe("MemoryScreen — the trail scope (P3 Task 4)", () => {
  const NESTED = [
    { id: "L1", name: "the book", parent_id: null, mode: "continuous" },
    { id: "L2", name: "a job search", parent_id: null, mode: "discrete" },
    { id: "L3", name: "chapter three", parent_id: "L1", mode: "discrete" },
  ];

  const actionLabels = (target) =>
    [...target.querySelectorAll(".shell-navbar-action")].map((b) => b.textContent.trim());

  const scoped = (props = {}) =>
    mountMemory({
      lineages: NESTED,
      onFilters: () => {},
      onTrails: () => {},
      pages: [
        page({ id: "a", lineage_id: "L1", what_matters_now: "the book itself" }),
        page({ id: "b", lineage_id: "L3", what_matters_now: "chapter three's draft" }),
        page({ id: "c", lineage_id: "L2", what_matters_now: "the cover letter" }),
        page({ id: "d", lineage_id: null, what_matters_now: "a loose thought" }),
      ],
      ...props,
    });

  it("puts the trails action on the bar beside the filters one, filters first", () => {
    // Order decides which control survives if a third ever arrives —
    // NavBar caps the bar at two and renders them left to right.
    const { target } = scoped();
    expect(actionLabels(target)).toEqual(["filters", "trails"]);
  });

  it("offers no trails action when the host has nowhere to push", () => {
    // NavBar renders whatever it is given, so a label with no handler
    // would be a bar button that does nothing at all — the same rule the
    // filters action already follows.
    const { target } = scoped({ onTrails: null });
    expect(actionLabels(target)).toEqual(["filters"]);
  });

  it("labels the action with the trail that is on", () => {
    // The action IS the scope, which is what makes a scope that outlives
    // the screen safe to keep: a writer returning to memory is told what
    // they are looking at before they read a row.
    const { target } = scoped({ trailScopeId: "L1" });
    expect(actionLabels(target)).toEqual(["filters", "the book"]);
  });

  // The pages mode, not the timeline, for the three list assertions below.
  // Every fixture page shares a date, so in the timeline their order is
  // `trailGroupsForDate`'s trail order rather than the list's — an
  // assertion about WHICH rows survive would then be reading an ordering
  // decision that belongs to another module. The pages mode groups by date
  // and keeps the input order inside a bucket, so the list is the list.
  const pageRows = (target) => {
    pickSegment(target, "pages");
    return rowLabels(target);
  };

  it("narrows the list to a trail and everything nested under it", () => {
    const { target } = scoped({ trailScopeId: "L1" });
    expect(pageRows(target)).toEqual(["the book itself", "chapter three's draft"]);
  });

  it("narrows to the pages on no trail for the untrailed scope", () => {
    const { target } = scoped({ trailScopeId: "__untrailed__" });
    expect(pageRows(target)).toEqual(["a loose thought"]);
  });

  it("gives the whole list back on all trails", () => {
    const { target } = scoped({ trailScopeId: null });
    expect(pageRows(target)).toEqual([
      "the book itself",
      "chapter three's draft",
      "the cover letter",
      "a loose thought",
    ]);
  });

  it("scopes the pins mode by the pin's own trail", () => {
    const { target } = scoped({
      trailScopeId: "L2",
      pins: [
        { id: "pin-a", lineage_id: "L1", title: "kept on the book", source_page_date: DAY_TWO },
        { id: "pin-b", lineage_id: "L2", title: "kept on the search", source_page_date: DAY_TWO },
      ],
    });
    pickSegment(target, "pins");
    expect(rowLabels(target)).toEqual(["kept on the search"]);
  });

  it("scopes the timeline too, without the timeline knowing", () => {
    // memoryDays receives the already-scoped lists, so a trail with no
    // writing in the scope leaves no block behind — and no day header
    // either, once its last page is out of range.
    const { target } = scoped({ trailScopeId: "L2" });
    expect(trailHeads(target)).toEqual(["a job search"]);
  });

  it("names the scope when it is what hid everything", () => {
    // The one thing on screen that can say why an empty list is empty. The
    // scope is not in the filters COUNT (its control is not in that sheet)
    // so this string is the only place it is reported.
    const { target } = scoped({
      pages: [page({ id: "c", lineage_id: "L2", what_matters_now: "the cover letter" })],
      trailScopeId: "L1",
    });
    expect(target.querySelector(".empty-title").textContent.trim()).toBe("nothing matches");
    expect(target.querySelector(".empty-body").textContent.trim()).toBe("the book");
  });

  it("still says a scope is on when the trail list cannot name it", () => {
    // A read that failed, or a lineage that arrived after it. Reporting
    // nothing here would leave a filtered list with no visible cause,
    // which is exactly the state searchRowShowing exists to prevent for
    // the query.
    const { target } = scoped({ lineages: [], trailScopeId: "L1" });
    expect(actionLabels(target)).toEqual(["filters", "trail"]);
  });
});
