import { describe, it, expect } from "vitest";
import { trailSheetSubmit, trailSheetRows } from "../trail-sheet-model.js";

function trail(over = {}) {
  return { id: "L1", name: "the book", mode: "discrete", parent_id: null, ...over };
}

const labels = (rows) => rows.map((r) => r.label);
const byId = (rows, id) => rows.find((r) => r.id === id);

describe("trailSheetRows", () => {
  it("lists the trails a page can be put on", () => {
    const rows = trailSheetRows({
      lineages: [trail({ id: "a", name: "the book" }), trail({ id: "b", name: "job search" })],
    });
    // NAME ORDER, not the order the backend handed them over. get_lineages
    // sorts by most recent activity, which means the list a writer is
    // choosing from reshuffles between openings for a reason they cannot
    // see. orderedTrails (trail-index.js) sorts siblings by name, and the
    // scope sheet has always done so — one list, one order, both sheets.
    expect(labels(rows)).toEqual(["job search", "the book"]);
    expect(rows.every((r) => r.selectable)).toBe(true);
  });

  it("offers to manage the page's own trail, right under 'no trail'", () => {
    // The owner looked for "delete trail" in this sheet (2026-10-28) and it
    // was only reachable from memory, by tapping a scoped row a second
    // time. The row names the trail and says what managing means.
    expect(byId(trailSheetRows({ lineages: [trail()] }), "manage")).toBeUndefined();
    const rows = trailSheetRows({ lineages: [trail(), trail({ id: "L2", name: "job search" })], currentLineageId: "L1" });
    const manage = byId(rows, "manage");
    expect(manage).toMatchObject({ kind: "manage", label: "manage “the book”", value: "rename, move, delete", lineageId: "L1", selectable: true });
    expect(rows.indexOf(manage)).toBe(rows.findIndex((r) => r.id === "unlink") + 1);
  });

  it("does not offer to manage a trail the list no longer holds", () => {
    // A trail deleted on another device: a row to manage it would open a
    // screen that says it is gone.
    expect(byId(trailSheetRows({ lineages: [trail({ id: "L2" })], currentLineageId: "L1" }), "manage")).toBeUndefined();
  });

  it("offers 'no trail' only when there is a trail to come off", () => {
    // On an untrailed page the row would name the state the page is
    // already in — a row that can do nothing, in a sheet whose whole job
    // is choices that act.
    expect(byId(trailSheetRows({ lineages: [trail()] }), "unlink")).toBeUndefined();
    const trailed = trailSheetRows({ lineages: [trail()], currentLineageId: "L1" });
    expect(byId(trailed, "unlink").label).toBe("no trail");
  });

  it("shows the trail this page is on and does not offer it again", () => {
    const rows = trailSheetRows({ lineages: [trail()], currentLineageId: "L1" });
    const row = byId(rows, "L1");
    expect(row.value).toBe("this page");
    expect(row.selectable).toBe(false);
  });

  it("lists a continuous trail and refuses to make it a choice", () => {
    // Every way of pointing this page at a living document is destructive
    // or a navigation (see the module header): the desktop merges and
    // deletes source rows for it. Listed so the writer can see the trail
    // exists and does not name a duplicate; inert so nothing here can
    // destroy a trail's history.
    const rows = trailSheetRows({
      lineages: [trail({ id: "c", name: "the book", mode: "continuous" })],
    });
    expect(byId(rows, "c").value).toBe("living doc");
    expect(byId(rows, "c").selectable).toBe(false);
  });

  it("offers a new trail for a name no trail carries", () => {
    const rows = trailSheetRows({ lineages: [trail()], typedName: "job search" });
    expect(byId(rows, "create").label).toBe("start the trail “job search”");
    expect(byId(rows, "create").name).toBe("job search");
  });

  it("offers no new trail for a name already taken, whatever its case", () => {
    // Not silence for its own sake: the backend answers
    // `lineage_name_taken`, and an error toast for a name the writer can
    // see two rows down is friction with nothing to teach.
    for (const typed of ["the book", "THE BOOK", "  the   book  "]) {
      expect(byId(trailSheetRows({ lineages: [trail()], typedName: typed }), "create"))
        .toBeUndefined();
    }
  });

  it("offers no new trail for an empty field", () => {
    // There is no name to create. The row appears as the writer types.
    expect(byId(trailSheetRows({ lineages: [], typedName: "   " }), "create")).toBeUndefined();
    expect(byId(trailSheetRows({ lineages: [] }), "create")).toBeUndefined();
  });

  it("never decorates a writer's trail name with an article or a suffix", () => {
    // P2f Task 2's regression, from real fixtures: "the book" rendered as
    // "the the book trail" and "book trail" as "the book trail trail". A
    // name is shown exactly as it was typed.
    const rows = trailSheetRows({
      lineages: [trail({ id: "a", name: "the book" }), trail({ id: "b", name: "book trail" })],
      typedName: "reading",
    });
    expect(labels(rows)).toContain("the book");
    expect(labels(rows)).toContain("book trail");
    expect(byId(rows, "create").label).toBe("start the trail “reading”");
  });

  it("names a trail by itself and says where it lives in the second column", () => {
    // IT USED TO BE ONE STRING — "product › export api" — cut at 36
    // characters from the end, so a trail three deep lost its own name,
    // which is the only part being chosen between. A flat sheet still
    // cannot indent (Row has one shape), but it has a second column, and
    // the path belongs there.
    const rows = trailSheetRows({
      lineages: [
        trail({ id: "p", name: "product", parent_id: null }),
        trail({ id: "c", name: "export api", parent_id: "p" }),
      ],
    });
    expect(labels(rows)).toEqual(["product", "export api"]);
    expect(byId(rows, "c").value).toBe("product");
    // A root's second column is empty, which is what makes depth legible
    // without moving anybody's tap target.
    expect(byId(rows, "p").value).toBe("");
  });

  it("does not repeat the trail's own name in its path", () => {
    const rows = trailSheetRows({
      lineages: [
        trail({ id: "p", name: "product", parent_id: null }),
        trail({ id: "c", name: "export api", parent_id: "p" }),
        trail({ id: "g", name: "v2", parent_id: "c" }),
      ],
    });
    expect(byId(rows, "g").label).toBe("v2");
    expect(byId(rows, "g").value).toBe("product › export api");
  });

  it("puts a parent before its children", () => {
    const rows = trailSheetRows({
      lineages: [
        trail({ id: "c", name: "export api", parent_id: "p" }),
        trail({ id: "p", name: "product", parent_id: null }),
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["p", "c"]);
  });

  it("cuts a name too long for a row without cutting what gets created", () => {
    const long = "n".repeat(80);
    const rows = trailSheetRows({ lineages: [], typedName: long });
    // The cut is inside the quotes: the closing mark still ends the row.
    expect(byId(rows, "create").label.endsWith("…”")).toBe(true);
    expect(byId(rows, "create").name).toBe(long);
  });
});

describe("trailSheetSubmit — what return does", () => {
  const lineages = [
    { id: "L1", name: "the book", mode: "discrete" },
    { id: "L2", name: "living doc", mode: "continuous" },
  ];
  const submit = (typedName, currentLineageId = null) =>
    trailSheetSubmit({
      rows: trailSheetRows({ lineages, currentLineageId, typedName }),
      lineages,
      typedName,
    });

  it("starts a trail for a name no trail carries", () => {
    // The keyboard's Go did nothing — the third device pass.
    expect(submit("job search")).toMatchObject({ kind: "create", name: "job search" });
  });

  it("chooses the trail that already carries the name, whatever its case", () => {
    expect(submit("THE BOOK")).toMatchObject({ kind: "trail", lineageId: "L1" });
  });

  it("does nothing for an empty field", () => {
    // Null, because return on an empty field names nothing: a row run
    // here would be a guess at which trail was meant.
    expect(submit("   ")).toBeNull();
  });

  it("does nothing for the page's own trail or a continuous one", () => {
    // The same rows are inert in the list (THIS_PAGE, LIVING_DOC), and
    // return acts only where a tap would.
    expect(submit("the book", "L1")).toBeNull();
    expect(submit("living doc")).toBeNull();
  });
});

// ── nesting, which the phone could not do at all ──────────────────────────
//
// Found in the device pass on 2026-10-04: a trail started on the phone was
// always top-level, because createTrail passed a null parent and nothing
// else on the phone nests one. The desktop has had it since LineageSelector
// — a parent picker beside the name, `└ under: <name>`, any trail allowed.
//
// The sheet keeps its own rule, which its header states: this is assignment,
// not trail management. Choosing where a NEW trail begins is part of
// starting it; moving an existing trail under another is not, and stays out.
//
// The interaction mirrors the desktop's two steps without a second screen:
// the create row gains a sibling that turns this same list into the parent
// choices, and the create row then offers the top level as the way back.
describe("trailSheetRows — starting a trail inside another", () => {
  const two = [
    trail({ id: "a", name: "the book" }),
    trail({ id: "b", name: "job search" }),
  ];

  it("offers to nest once a name is typed and there is something to nest under", () => {
    const rows = trailSheetRows({ lineages: two, typedName: "chapter two" });
    const nest = byId(rows, "nest");
    expect(nest).toBeTruthy();
    expect(nest.label).toMatch(/inside/i);
    expect(nest.selectable).toBe(true);
  });

  it("offers no nesting with nothing typed", () => {
    expect(byId(trailSheetRows({ lineages: two }), "nest")).toBeUndefined();
  });

  it("offers no nesting when there are no trails yet", () => {
    // The first trail on a phone has nowhere to go but the top level, and a
    // row that opens an empty list is a row that lies about having choices.
    expect(byId(trailSheetRows({ lineages: [], typedName: "the book" }), "nest")).toBeUndefined();
  });

  it("offers no nesting when the typed name is already a trail", () => {
    // Nothing is being created, so there is nothing to put anywhere: the
    // same reason the create row stands down here.
    const rows = trailSheetRows({ lineages: two, typedName: "the book" });
    expect(byId(rows, "nest")).toBeUndefined();
    expect(byId(rows, "create")).toBeUndefined();
  });

  it("turns the list into parents once nesting", () => {
    const rows = trailSheetRows({ lineages: two, typedName: "chapter two", nesting: true });
    const targets = rows.filter((r) => r.kind === "nest-target");
    // Name order, same as the assignment list — "job search" before "the
    // book". It was insertion order before orderedTrails.
    expect(targets.map((r) => r.lineageId)).toEqual(["b", "a"]);
    expect(targets.every((r) => r.selectable)).toBe(true);
    expect(targets.every((r) => r.name === "chapter two")).toBe(true);
  });

  it("keeps the top level reachable while nesting", () => {
    // The way back out, and the same row that runs on return — so a writer
    // who opened nesting by accident is one tap from what they meant.
    const rows = trailSheetRows({ lineages: two, typedName: "chapter two", nesting: true });
    const create = byId(rows, "create");
    expect(create).toBeTruthy();
    expect(create.parentId ?? null).toBe(null);
  });

  it("does not offer assignment while nesting", () => {
    // One question at a time: every row in this mode answers "where does
    // the new trail go", so none of them may quietly re-point the page.
    const rows = trailSheetRows({ lineages: two, typedName: "chapter two", nesting: true });
    expect(rows.some((r) => r.kind === "trail")).toBe(false);
    expect(rows.some((r) => r.kind === "unlink")).toBe(false);
  });

  it("lets a continuous trail be a parent, as the desktop does", () => {
    // A continuous parent does not share its document with its children
    // (CLAUDE.md, trail modes), so there is nothing to protect here — and a
    // phone-only rule the desktop does not have is a second answer.
    const rows = trailSheetRows({
      lineages: [trail({ id: "c", name: "the diary", mode: "continuous" })],
      typedName: "chapter two",
      nesting: true,
    });
    const target = rows.find((r) => r.kind === "nest-target");
    expect(target.selectable).toBe(true);
  });

  it("return still starts a top-level trail while nesting is offered", () => {
    const rows = trailSheetRows({ lineages: two, typedName: "chapter two" });
    const row = trailSheetSubmit({ rows, lineages: two, typedName: "chapter two" });
    expect(row.kind).toBe("create");
    expect(row.parentId ?? null).toBe(null);
  });
});

describe("trailSheetRows — a living doc, startable and reachable", () => {
  // The phone could neither make a continuous trail nor reach one. This
  // file's header refuses the DESTRUCTIVE routes onto a trail that already
  // owns a document, and that refusal is untouched below: what is added is
  // starting one on a page with nothing at stake, and OPENING a document
  // that already exists — a navigation, not an assignment.

  it("offers to start a living doc, beside the plain one", () => {
    const rows = trailSheetRows({ typedName: "the book", pageEmpty: true });
    expect(labels(rows)).toContain("start the trail “the book”");
    expect(labels(rows)).toContain("start “the book” as a living doc");
    expect(byId(rows, "create-continuous").selectable).toBe(true);
  });

  it("withholds it on a page that already has writing", () => {
    // The permanent one. A continuous trail's canonical cannot be
    // unlinked, so a page that becomes one carries whatever was on it in
    // forever — and on a phone that page is whatever happened to be open.
    // Offered only where the choice costs nothing, which is an empty page.
    const rows = trailSheetRows({ typedName: "the book", pageEmpty: false });
    expect(labels(rows)).toContain("start the trail “the book”");
    expect(byId(rows, "create-continuous")).toBeUndefined();
  });

  it("withholds it for a name a trail already carries", () => {
    const rows = trailSheetRows({
      lineages: [trail({ name: "the book" })],
      typedName: "the book",
      pageEmpty: true,
    });
    expect(byId(rows, "create-continuous")).toBeUndefined();
  });

  it("lets a continuous trail WITH a document be opened", () => {
    // Selectable again, but not for the old verb. `open-doc` is a
    // navigation: it loads the trail's canonical and writes nothing. The
    // row that used to be dead said "living doc" and did nothing when
    // pressed, which is the one thing the sheet's header says a row must
    // never do.
    const rows = trailSheetRows({
      lineages: [trail({ id: "c", name: "the book", mode: "continuous" })],
      canonicalByLineage: { c: "page-9" },
    });
    const row = byId(rows, "c");
    expect(row.kind).toBe("open-doc");
    expect(row.selectable).toBe(true);
    expect(row.pageId).toBe("page-9");
  });

  it("leaves a continuous trail with NO document unselectable", () => {
    // Not an empty-result assertion for its own sake: there is nothing to
    // open, and the only other meaning a tap could carry here is "make
    // this page the canonical, permanently" — the choice the create row
    // above makes deliberately and only on an empty page. A row that
    // smuggled it in by looking like navigation would be the worst of
    // both.
    const rows = trailSheetRows({
      lineages: [trail({ id: "c", name: "the book", mode: "continuous" })],
      canonicalByLineage: { c: null },
    });
    const row = byId(rows, "c");
    expect(row.selectable).toBe(false);
    expect(row.kind).toBe("trail");
  });

  it("still refuses to move a page onto a trail that owns a document", () => {
    // The merge, which deletes the source page row. No row produced here
    // carries it, on any input — there is no `kind` for it at all.
    const rows = trailSheetRows({
      lineages: [trail({ id: "c", name: "the book", mode: "continuous" })],
      canonicalByLineage: { c: "page-9" },
      currentLineageId: "other",
      pageEmpty: false,
    });
    expect(rows.every((r) => r.kind !== "merge")).toBe(true);
    expect(byId(rows, "c").kind).toBe("open-doc");
  });
});
