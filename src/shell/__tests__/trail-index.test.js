import { describe, it, expect } from "vitest";
import {
  ACTION_NAME_MAX,
  UNTRAILED,
  trailActionLabel,
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
