import { describe, it, expect } from "vitest";
import {
  descendantsOf,
  moveUnderRows,
  trailScreenRows,
  renameIntent,
  trailErrorText,
  trailDeleteNote,
  trailDeleteLabel,
  pinTrailRows,
  pinTrailValue,
  scopeRowAction,
} from "../trail-manage.js";

// A small tree: the book › chapter three › draft two, a job search beside
// it, and a living doc at the top level.
const L = [
  { id: "L1", name: "the book", parent_id: null, mode: "discrete" },
  { id: "L2", name: "a job search", parent_id: null, mode: "discrete" },
  { id: "L3", name: "chapter three", parent_id: "L1", mode: "discrete" },
  { id: "L4", name: "draft two", parent_id: "L3", mode: "discrete" },
  { id: "L5", name: "garden", parent_id: null, mode: "continuous" },
];
const byId = (id) => L.find((l) => l.id === id);

describe("descendantsOf", () => {
  it("walks every level under a trail", () => {
    expect([...descendantsOf("L1", L)].sort()).toEqual(["L3", "L4"]);
  });

  it("answers an empty set for a leaf", () => {
    // A leaf has nothing under it: empty is the answer, not a miss.
    expect(descendantsOf("L4", L).size).toBe(0);
  });

  it("terminates on a cycle a malformed row set could hold", () => {
    const cyclic = [
      { id: "A", parent_id: "B" },
      { id: "B", parent_id: "A" },
    ];
    expect([...descendantsOf("A", cyclic)].sort()).toEqual(["A", "B"]);
  });
});

describe("moveUnderRows", () => {
  it("never offers the trail itself or anything under it", () => {
    const ids = moveUnderRows({ lineage: byId("L1"), lineages: L }).map((r) => r.parentId);
    expect(ids).not.toContain("L1");
    expect(ids).not.toContain("L3");
    expect(ids).not.toContain("L4");
  });

  it("offers top level first, then the other trails in tree order", () => {
    const rows = moveUnderRows({ lineage: byId("L3"), lineages: L });
    expect(rows.map((r) => r.label)).toEqual(["top level", "a job search", "garden", "the book"]);
    expect(rows[0].parentId).toBe(null);
  });

  it("marks where the trail already is, and offers it no tap", () => {
    const rows = moveUnderRows({ lineage: byId("L3"), lineages: L });
    const here = rows.find((r) => r.parentId === "L1");
    expect(here.value).toBe("now");
    expect(here.selectable).toBe(false);
    expect(rows.find((r) => r.parentId === null).selectable).toBe(true);
  });

  it("marks top level as where a root trail is", () => {
    const rows = moveUnderRows({ lineage: byId("L2"), lineages: L });
    expect(rows[0]).toMatchObject({ label: "top level", value: "now", selectable: false });
  });

  it("names where a target lives in the second column", () => {
    const rows = moveUnderRows({ lineage: byId("L2"), lineages: L });
    expect(rows.find((r) => r.parentId === "L4").value).toBe("the book › chapter three");
  });

  it("offers a living doc as a parent, as the laptop does", () => {
    const rows = moveUnderRows({ lineage: byId("L2"), lineages: L });
    expect(rows.find((r) => r.parentId === "L5").selectable).toBe(true);
  });

  it("answers nothing for no trail", () => {
    // No trail to move means no sheet to draw: empty is the answer.
    expect(moveUnderRows({ lineage: null, lineages: L })).toEqual([]);
  });
});

describe("trailScreenRows", () => {
  it("offers move under and delete, delete last", () => {
    const rows = trailScreenRows({ lineage: byId("L3"), lineages: L });
    expect(rows.map((r) => r.id)).toEqual(["move", "delete"]);
    expect(rows[1]).toMatchObject({ label: "delete trail", kind: "destructive" });
  });

  it("says where the trail lives on the move row", () => {
    expect(trailScreenRows({ lineage: byId("L3"), lineages: L })[0]).toMatchObject({
      label: "move under…",
      value: "the book",
    });
    expect(trailScreenRows({ lineage: byId("L2"), lineages: L })[0].value).toBe("top level");
  });

  it("withholds move under when there is nowhere else to go", () => {
    // A lone top-level trail: the sheet would hold only `top level`,
    // marked `now`, a list with no choice in it.
    const lone = [{ id: "X", name: "only", parent_id: null }];
    expect(trailScreenRows({ lineage: lone[0], lineages: lone }).map((r) => r.id)).toEqual([
      "delete",
    ]);
  });

  it("offers nothing when the trail is gone", () => {
    // A trail deleted by sync while its screen was up has nothing left
    // to rename, move or delete; the screen says so instead.
    expect(trailScreenRows({ lineage: null, lineages: L })).toEqual([]);
  });

  it("never offers fold, which stays on the laptop", () => {
    const labels = trailScreenRows({ lineage: byId("L1"), lineages: L }).map((r) => r.label);
    expect(labels.some((l) => /fold/.test(l))).toBe(false);
  });
});

describe("renameIntent", () => {
  it("renames to the trimmed name", () => {
    expect(renameIntent({ lineage: byId("L1"), lineages: L, typed: "  the novel " })).toEqual({
      action: "rename",
      name: "the novel",
    });
  });

  it("does nothing for the name it already has", () => {
    expect(renameIntent({ lineage: byId("L1"), lineages: L, typed: "the book" }).action).toBe(
      "none",
    );
  });

  it("puts the name back when the field is emptied", () => {
    expect(renameIntent({ lineage: byId("L1"), lineages: L, typed: "   " }).action).toBe(
      "revert",
    );
  });

  it("refuses a name another trail carries, without the round trip", () => {
    expect(renameIntent({ lineage: byId("L1"), lineages: L, typed: "A Job Search" })).toEqual({
      action: "taken",
      name: "A Job Search",
    });
  });

  it("allows a change of case on its own name", () => {
    expect(renameIntent({ lineage: byId("L1"), lineages: L, typed: "The Book" }).action).toBe(
      "rename",
    );
  });
});

describe("trailErrorText", () => {
  it("says a taken name in the laptop's words", () => {
    expect(trailErrorText(new Error("lineage_name_taken"), "x")).toBe(
      "a trail named “x” already exists",
    );
  });

  it("falls back to a plain line for anything else", () => {
    expect(trailErrorText(new Error("boom"))).toBe("that did not save. try it again.");
  });
});

describe("the delete confirmation", () => {
  it("names the trail on the row that deletes it", () => {
    expect(trailDeleteLabel(byId("L1"))).toBe("delete “the book”");
  });

  it("says where the pages and the trails inside it go", () => {
    const note = trailDeleteNote({ lineage: byId("L3"), lineages: L });
    expect(note).toContain("pages");
    expect(note).toContain("the book");
    expect(note).not.toMatch(/sink|sunk/);
  });

  it("says top level for a root trail's children", () => {
    expect(trailDeleteNote({ lineage: byId("L1"), lineages: L })).toContain("top level");
  });
});

describe("pinTrailRows", () => {
  it("offers no trail first, then every trail in tree order", () => {
    const rows = pinTrailRows({ pin: { lineage_id: "L1" }, lineages: L });
    expect(rows.map((r) => r.label)).toEqual([
      "no trail",
      "a job search",
      "garden",
      "the book",
      "chapter three",
      "draft two",
    ]);
    expect(rows[0].lineageId).toBe(null);
  });

  it("marks the pin's own trail and offers it no tap", () => {
    const rows = pinTrailRows({ pin: { lineage_id: "L3" }, lineages: L });
    expect(rows.find((r) => r.lineageId === "L3")).toMatchObject({
      value: "this pin",
      selectable: false,
    });
  });

  it("marks no trail on a pin that has none", () => {
    const rows = pinTrailRows({ pin: { lineage_id: null }, lineages: L });
    expect(rows[0]).toMatchObject({ value: "this pin", selectable: false });
  });
});

describe("pinTrailValue", () => {
  it("names the pin's trail, or says it has none", () => {
    expect(pinTrailValue({ pin: { lineage_id: "L3" }, trailName: "chapter three" })).toBe(
      "chapter three",
    );
    expect(pinTrailValue({ pin: { lineage_id: null }, trailName: null })).toBe("no trail");
  });

  it("says nothing while the trail's name is not known yet", () => {
    // Blank beats a wrong word: the name arrives a round trip later.
    expect(pinTrailValue({ pin: { lineage_id: "L3" }, trailName: null })).toBe("");
  });

  it("answers null for no pin, which withholds the row", () => {
    expect(pinTrailValue({ pin: null })).toBe(null);
  });
});

describe("scopeRowAction", () => {
  it("scopes memory from a trail that is not showing", () => {
    expect(scopeRowAction({ id: "L1", selected: false })).toBe("scope");
    expect(scopeRowAction({ id: null, selected: false })).toBe("scope");
  });

  it("opens the trail's screen from the trail that is showing", () => {
    expect(scopeRowAction({ id: "L1", selected: true })).toBe("manage");
  });

  it("leaves all trails and untrailed inert while showing", () => {
    // They are scopes, not trails: there is nothing to rename or delete.
    expect(scopeRowAction({ id: null, selected: true })).toBe(null);
    expect(scopeRowAction({ id: "__untrailed__", selected: true })).toBe(null);
  });
});
