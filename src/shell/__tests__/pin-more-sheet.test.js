import { describe, it, expect } from "vitest";
import { pinMoreSheet } from "../pin-more-sheet.js";

const LINEAGES = [
  { id: "PARENT", name: "shizumu", parent_id: null },
  { id: "L1", name: "v0.8", parent_id: "PARENT" },
];

describe("pinMoreSheet", () => {
  it("offers carry forward, the moves and unpin, in the desktop's words and order", () => {
    const sheet = pinMoreSheet({ id: "p", lineage_id: "L1", auto_insert: false }, { lineages: LINEAGES, title: "the plan" });
    expect(sheet.note).toBeNull();
    expect(sheet.rows.map((r) => r.label)).toEqual([
      "carry forward to new pages",
      "move up to shizumu",
      "move to everywhere",
      "unpin…",
    ]);
    expect(sheet.rows.find((r) => r.label === "move up to shizumu").target).toBe("PARENT");
    expect(sheet.rows.find((r) => r.label === "move to everywhere").target).toBeNull();
  });

  it("puts nothing on the page from here and renames nothing — those live elsewhere", () => {
    // Not a vacuous absence: `put on page` is a worded button on the row
    // itself, and the pin's own screen renames (it knows where the title
    // lives). Listing either here would offer one action from two places.
    const sheet = pinMoreSheet({ id: "p", lineage_id: "L1" }, { lineages: LINEAGES });
    expect(sheet.rows.map((r) => r.id)).not.toContain("putOnPage");
    expect(sheet.rows.map((r) => r.id)).not.toContain("rename");
  });

  it("asks before it unpins, keep first", () => {
    // THE BUG this guards (walk-through 2026-11-01): unpin sat one slip
    // away from insert with no question asked.
    const sheet = pinMoreSheet({ id: "p", lineage_id: "L1" }, { lineages: LINEAGES, title: "the plan", confirming: true });
    expect(sheet.note).toBe("unpin the plan? the writing stays on its page.");
    expect(sheet.rows.map((r) => [r.id, r.label])).toEqual([
      ["keep", "keep"],
      ["unpinNow", "unpin"],
    ]);
  });

  it("says stop carrying forward on a pin that already does", () => {
    const sheet = pinMoreSheet({ id: "p", lineage_id: "L1", auto_insert: true }, { lineages: LINEAGES });
    expect(sheet.rows[0].label).toBe("stop carrying forward");
  });
});
