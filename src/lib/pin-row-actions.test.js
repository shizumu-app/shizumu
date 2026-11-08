import { describe, it, expect } from "vitest";
import { pinRowActions, pinMoveActions, offersCarryForward } from "./pin-row-actions.js";

const lineages = [
  { id: "root", name: "shizumu", parent_id: null },
  { id: "v08", name: "v0.8", parent_id: "root" },
];

describe("a pin row's actions", () => {
  it("two worded actions on the row; unpin is not one of them", () => {
    // The bug: delete (×) sat beside insert (↓) as an unlabelled glyph.
    const { primary } = pinRowActions({ id: "a", lineage_id: "v08" }, { lineages, title: "the tag" });
    expect(primary.map((a) => a.label)).toEqual(["open", "put on page"]);
    expect(primary.map((a) => a.ariaLabel)).toEqual(["open the tag", "put the tag on this page"]);
  });

  it("⋯ holds carry forward, rename, move, and unpin last", () => {
    const { more } = pinRowActions({ id: "a", lineage_id: "v08", auto_insert: 0 }, { lineages });
    expect(more.map((a) => a.label)).toEqual([
      "carry forward to new pages", "rename", "move up to shizumu", "move to everywhere", "unpin…",
    ]);
  });

  it("unpin asks first, and says what stays", () => {
    const { more } = pinRowActions({ id: "a", lineage_id: "v08" }, { title: "the tag" });
    const unpin = more.at(-1);
    expect(unpin.id).toBe("unpin");
    expect(unpin.confirm).toEqual({ prompt: "unpin the tag? the writing stays on its page.", yes: "unpin", no: "keep" });
  });

  it("the carry switch reads as what pressing it does", () => {
    const on = pinRowActions({ id: "a", lineage_id: "v08", auto_insert: 1 }).more[0];
    expect(on).toMatchObject({ id: "carry", label: "stop carrying forward" });
  });

  it("no carry switch on a global pin that is off — carry-forward only reads trail-owned pins", () => {
    expect(offersCarryForward({ lineage_id: null, auto_insert: 0 })).toBe(false);
    // ...but one already on can be switched off.
    expect(offersCarryForward({ lineage_id: null, auto_insert: 1 })).toBe(true);
    expect(pinRowActions({ id: "g", lineage_id: null }).more.map((a) => a.id)).toEqual(["rename", "unpin"]);
  });

  it("put on page is left out where the page cannot take it", () => {
    expect(pinRowActions({ id: "a" }, { canPutOnPage: false }).primary.map((a) => a.id)).toEqual(["open"]);
  });

  it("move back to the page's trail when the pin was moved away from it", () => {
    const moves = pinMoveActions({ id: "a", lineage_id: null, source_page_lineage_id: "v08" }, lineages);
    expect(moves).toEqual([{ id: "move", label: "move back to v0.8", target: "v08", group: "move" }]);
  });

  it("an untitled pin is still named", () => {
    expect(pinRowActions({ id: "a" }, { title: "  " }).primary[0].ariaLabel).toBe("open this pin");
  });
});
