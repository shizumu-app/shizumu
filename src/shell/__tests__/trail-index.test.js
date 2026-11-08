import { describe, it, expect } from "vitest";
import {
  ACTION_NAME_MAX,
  UNTRAILED,
  noTrailMatches,
  trailActionLabel,
  trailCountValue,
  trailIndexRows,
  trailScope,
  trailScopeLabel,
} from "../trail-index.js";
import { applyScopeFilter } from "../../lib/memory-filters.js";

const LINEAGES = [
  { id: "L1", name: "the book", parent_id: null, mode: "continuous" },
  { id: "L2", name: "a job search", parent_id: null, mode: "discrete" },
  { id: "L3", name: "chapter three", parent_id: "L1", mode: "discrete" },
];

const labels = (rows) => rows.map((r) => r.label);

describe("trailIndexRows", () => {
  it("opens with the two scopes that are not trails, in the desktop sidebar's order", () => {
    const rows = trailIndexRows({ lineages: [] });
    expect(labels(rows)).toEqual(["all trails", "untrailed"]);
    expect(rows[0].id).toBeNull();
    expect(rows[1].id).toBe(UNTRAILED);
  });

  it("nests children under their parent and says how deep each is", () => {
    const rows = trailIndexRows({ lineages: LINEAGES });
    expect(labels(rows)).toEqual([
      "all trails",
      "untrailed",
      "a job search",
      "the book",
      "chapter three",
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 0, 0, 1]);
  });

  it("carries the mode, which is where a writer meets the trail exception", () => {
    const rows = trailIndexRows({ lineages: LINEAGES });
    expect(rows.find((r) => r.label === "the book").mode).toBe("continuous");
    expect(rows.find((r) => r.label === "a job search").mode).toBe("discrete");
    // The two scope rows are not trails and have no mode to report.
    expect(rows[0].mode).toBeNull();
  });

  it("marks the row that is showing, and only that one", () => {
    const rows = trailIndexRows({ lineages: LINEAGES, selectedId: "L3" });
    expect(rows.filter((r) => r.selected).map((r) => r.label)).toEqual(["chapter three"]);
  });

  it("marks all trails when nothing is scoped", () => {
    const rows = trailIndexRows({ lineages: LINEAGES });
    expect(rows.filter((r) => r.selected).map((r) => r.label)).toEqual(["all trails"]);
  });

  it("keeps a trail whose parent is not in the list, as a root", () => {
    // The list is what memory read. Dropping the row would make every page
    // on that trail unreachable from this index — a page belonging to a
    // trail whose parent went missing is still a page the writer wrote.
    const rows = trailIndexRows({
      lineages: [{ id: "L9", name: "orphan", parent_id: "gone", mode: "discrete" }],
    });
    expect(labels(rows)).toEqual(["all trails", "untrailed", "orphan"]);
    expect(rows[2].depth).toBe(0);
  });

  it("names a trail that has no name rather than rendering a blank row", () => {
    const rows = trailIndexRows({ lineages: [{ id: "L9", name: "   ", parent_id: null }] });
    expect(rows[2].label).toBe("untitled");
  });

  it("terminates on a cycle instead of walking it forever", () => {
    // The app cannot make one — create_lineage takes a parent that already
    // exists — but a merged or malformed row set could, and a depth-first
    // walk over a cycle does not return. Every row appears once.
    const rows = trailIndexRows({
      lineages: [
        { id: "A", name: "a", parent_id: "B" },
        { id: "B", name: "b", parent_id: "A" },
      ],
    });
    expect(labels(rows)).toEqual(["all trails", "untrailed"]);
    // NOT an empty result by accident: with both parents present, neither
    // row is a root, so the walk from null reaches nothing and the guard is
    // never even needed. The assertion that matters is that the call
    // RETURNS — a walk that followed the cycle would hang this test.
  });
});

describe("trailScopeLabel", () => {
  it("says nothing when nothing is scoped", () => {
    expect(trailScopeLabel({ lineages: LINEAGES, selectedId: null })).toBeNull();
  });

  it("names the trail, and the heap", () => {
    expect(trailScopeLabel({ lineages: LINEAGES, selectedId: "L1" })).toBe("the book");
    expect(trailScopeLabel({ lineages: LINEAGES, selectedId: UNTRAILED })).toBe("untrailed");
  });

  it("still says a scope is on when the list cannot name it", () => {
    // Not null: null means "nothing is filtering the list", and something
    // is. A page whose lineage arrived after memory's read, or a read that
    // failed, produces exactly this.
    expect(trailScopeLabel({ lineages: LINEAGES, selectedId: "gone" })).toBe("trail");
  });
});

describe("trailActionLabel", () => {
  it("says what it opens when nothing is scoped, and what is on when something is", () => {
    expect(trailActionLabel({ lineages: LINEAGES, selectedId: null })).toBe("trails");
    expect(trailActionLabel({ lineages: LINEAGES, selectedId: "L1" })).toBe("the book");
  });

  it("cuts a name too long for a bar that has no ellipsis of its own", () => {
    const long = "the book about the second reader";
    const label = trailActionLabel({
      lineages: [{ id: "L9", name: long, parent_id: null }],
      selectedId: "L9",
    });
    expect(label.length).toBe(ACTION_NAME_MAX);
    expect(label.endsWith("…")).toBe(true);
    expect(long.startsWith(label.slice(0, -1))).toBe(true);
  });

  it("leaves a name that fits exactly alone", () => {
    const fits = "x".repeat(ACTION_NAME_MAX);
    expect(
      trailActionLabel({ lineages: [{ id: "L9", name: fits, parent_id: null }], selectedId: "L9" }),
    ).toBe(fits);
  });
});

describe("trailScope — the argument applyScopeFilter is handed", () => {
  const rows = [
    { id: "a", lineage_id: "L1" },
    { id: "b", lineage_id: "L3" },
    { id: "c", lineage_id: "L2" },
    { id: "d", lineage_id: null },
  ];

  it("passes everything through when nothing is scoped", () => {
    expect(applyScopeFilter(rows, trailScope({ lineages: LINEAGES, selectedId: null }))).toEqual(
      rows,
    );
  });

  it("includes a parent's descendants, which is what nesting is for", () => {
    const scope = trailScope({ lineages: LINEAGES, selectedId: "L1" });
    expect(applyScopeFilter(rows, scope).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("keeps a leaf to itself", () => {
    const scope = trailScope({ lineages: LINEAGES, selectedId: "L3" });
    expect(applyScopeFilter(rows, scope).map((r) => r.id)).toEqual(["b"]);
  });

  it("selects the rows on no trail at all for the untrailed sentinel", () => {
    // The seam this asserts is a LITERAL shared by three files: this
    // module's UNTRAILED, descendantLineageIds' early return, and
    // applyScopeFilter's own test. None of them imports it from the others,
    // so changing one in isolation makes this scope silently select
    // nothing — which is what this drives end to end rather than trusting.
    const scope = trailScope({ lineages: LINEAGES, selectedId: UNTRAILED });
    expect(applyScopeFilter(rows, scope).map((r) => r.id)).toEqual(["d"]);
  });
});

describe("trailIndexRows — find a trail and the counts (0.8.2)", () => {
  const counts = {
    pageCounts: new Map([["L1", 6], ["L3", 2]]),
    pinCounts: new Map([["L1", 4], [null, 3]]),
  };

  it("keeps a match and its ancestors, and the two scope rows, while searching", () => {
    // THE GAP: the sheet had no search; a long tree meant scrolling it.
    // A nested match keeps its parent, so it is never shown without the
    // path to it, and `all trails` / `untrailed` stay because they are the
    // way back out of a scope, not names a query could match.
    const rows = trailIndexRows({ lineages: LINEAGES, query: "chapter" });
    expect(labels(rows)).toEqual(["all trails", "untrailed", "the book", "chapter three"]);
  });

  it("says when a search matches no trail", () => {
    expect(noTrailMatches(LINEAGES, "zebra")).toBe(true);
    expect(noTrailMatches(LINEAGES, "")).toBe(false);
    expect(noTrailMatches(LINEAGES, "BOOK")).toBe(false);
  });

  it("puts each trail's own pages and pins in the value column", () => {
    const rows = trailIndexRows({ lineages: LINEAGES, untrailedPages: 5, ...counts });
    const value = (label) => rows.find((r) => r.label === label).value;
    expect(value("the book")).toBe("6 pages · 4 pins");
    expect(value("chapter three")).toBe("2 pages · 0 pins");
    // The pins on no trail are the null key; the untrailed pages come from
    // memory's list, which the queries cannot answer.
    expect(value("untrailed")).toBe("5 pages · 3 pins");
    expect(value("all trails")).toBe("13 pages · 7 pins");
  });

  it("says only the pins when the untrailed pages are unknown", () => {
    // memory's list is capped at a hundred: past it, the untrailed figure
    // (and so the whole) is unknown, and a guessed number would be wrong.
    const rows = trailIndexRows({ lineages: LINEAGES, untrailedPages: null, ...counts });
    expect(rows[1].value).toBe("3 pins");
    expect(rows[0].value).toBe("7 pins");
  });

  it("marks only a continuous trail, and says showing and the path under the name", () => {
    // The `discrete` / `continuous` word on every row is gone (spec §2):
    // discrete is the default and says nothing.
    const rows = trailIndexRows({ lineages: LINEAGES, selectedId: "L3" });
    const detail = (label) => rows.find((r) => r.label === label).detail;
    expect(detail("the book")).toBe("one doc");
    expect(detail("a job search")).toBe("");
    expect(detail("chapter three")).toBe("showing · the book");
    expect(rows[0].detail).toBe("");
  });

  it("carries no count when none were read", () => {
    // Not a vacuous empty: the header's refusal of a tallied count stands,
    // so without the two queries' answers a row says nothing.
    expect(trailIndexRows({ lineages: LINEAGES }).every((r) => r.value === "")).toBe(true);
    expect(trailCountValue(null)).toBe("");
  });
});
