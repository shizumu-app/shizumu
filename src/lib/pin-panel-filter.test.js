import { describe, it, expect } from "vitest";
import {
  defaultPanelFilter, panelChips, chipCounts, toggleChip, setKind, filterPanelPins,
  sortPanelPins, panelSections, pinSourceLine, panelTitle, searchPlaceholder,
  clearPanelFilters, narrowing, mergePinRows, canReorder, scopeRows,
} from "./pin-panel-filter.js";

const lineages = [
  { id: "root", name: "shizumu", parent_id: null },
  { id: "v08", name: "v0.8", parent_id: "root" },
  { id: "other", name: "garden", parent_id: null },
];

const text = (text) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const tasks = JSON.stringify({ type: "doc", content: [{ type: "taskList", content: [] }] });

function pin(id, over = {}) {
  return {
    id, lineage_id: "v08", source_page_id: "elsewhere", object_type: "note", title: id,
    content: text(`${id} body`), status: "open", position: 0, auto_insert: 0,
    created_at: "2026-10-01T00:00:00Z", ...over,
  };
}

// The page sits on v0.8, a child of shizumu.
const here1 = pin("carried", { auto_insert: 1, object_type: "board", content: tasks, position: 1 });
const here2 = pin("release", { source_page_id: "page-1", position: 2, created_at: "2026-10-20T00:00:00Z" });
const parent = pin("chip", { lineage_id: "root" });
const global = pin("anywhere", { lineage_id: null });
const elsewhere = pin("roses", { lineage_id: "other" });

const trailPins = [here1, here2, parent, global];
const allPins = [here1, here2, parent, elsewhere, global];
const ctx = { trailPins, allPins, pageId: "page-1", lineageId: "v08" };

describe("the chip row: every filter the panel has is on screen, with its count", () => {
  it("offers scope, carries forward, on this page and kind, in that order", () => {
    // The bug: only search was reachable; the rest lived in a hidden sidebar.
    const chips = panelChips({ ...ctx, filter: defaultPanelFilter() });
    expect(chips.map((c) => c.id)).toEqual(["trail", "all", "carries", "onPage", "kind"]);
    expect(chips.map((c) => c.label)).toEqual(["this trail", "all trails", "carries forward", "on this page", "kind ▾"]);
  });

  it("counts: scope chips count their scope, toggles count what they would keep in the current scope", () => {
    const chips = panelChips({ ...ctx, filter: defaultPanelFilter() });
    const count = Object.fromEntries(chips.map((c) => [c.id, c.count]));
    expect(count).toEqual({ trail: 4, all: 5, carries: 1, onPage: 1, kind: null });
  });

  it("a toggle's count does not drop to 0 because another toggle is on", () => {
    const f = { ...defaultPanelFilter(), carries: true };
    expect(chipCounts({ ...ctx, filter: f }).onPage).toBe(1);
  });

  it("toggle counts follow the scope", () => {
    const f = { ...defaultPanelFilter(), scope: "all" };
    const c = chipCounts({ ...ctx, filter: f });
    expect(c.kinds.text).toBe(4);
    expect(c.kinds.lists).toBe(1);
  });

  it("this trail is the default and the two scope chips are one choice", () => {
    let f = defaultPanelFilter();
    expect(panelChips({ ...ctx, filter: f }).filter((c) => c.active).map((c) => c.id)).toEqual(["trail"]);
    f = toggleChip(f, "all");
    expect(panelChips({ ...ctx, filter: f }).filter((c) => c.active).map((c) => c.id)).toEqual(["all"]);
    f = toggleChip(toggleChip(f, "carries"), "onPage");
    expect(f).toMatchObject({ scope: "all", carries: true, onPage: true });
  });

  it("on an untrailed page the first scope says everywhere", () => {
    const chips = panelChips({ ...ctx, lineageId: null, filter: defaultPanelFilter() });
    expect(chips[0].label).toBe("everywhere");
  });

  it("kind is a menu; choosing the same kind again clears it", () => {
    let f = setKind(defaultPanelFilter(), "lists");
    const kindChip = panelChips({ ...ctx, filter: f }).find((c) => c.id === "kind");
    expect(kindChip).toMatchObject({ label: "lists ▾", count: 1, active: true, menu: true });
    f = setKind(f, "lists");
    expect(f.kind).toBeNull();
    expect(setKind(f, "bogus").kind).toBeNull();
  });
});

describe("which pins show", () => {
  it("toggles, kind and search combine with the scope", () => {
    const rows = scopeRows(ctx, "trail");
    expect(filterPanelPins(rows, { ...defaultPanelFilter(), carries: true }, ctx).map((p) => p.id)).toEqual(["carried"]);
    expect(filterPanelPins(rows, { ...defaultPanelFilter(), onPage: true }, ctx).map((p) => p.id)).toEqual(["release"]);
    expect(filterPanelPins(rows, { ...defaultPanelFilter(), kind: "lists" }, ctx).map((p) => p.id)).toEqual(["carried"]);
    expect(filterPanelPins(rows, { ...defaultPanelFilter(), query: "CHIP body" }, ctx).map((p) => p.id)).toEqual(["chip"]);
  });

  it("on this page needs a page: with none, the toggle keeps nothing rather than every unsourced pin", () => {
    const loose = [pin("loose", { source_page_id: null })];
    // Why empty is right: a null pageId must not match a null source_page_id.
    expect(filterPanelPins(loose, { ...defaultPanelFilter(), onPage: true }, { pageId: null })).toEqual([]);
  });

  it("clear filters keeps the scope and the sort", () => {
    const f = { scope: "all", carries: true, onPage: true, kind: "code", query: "x", sort: "newest" };
    expect(narrowing(f)).toBe(true);
    const c = clearPanelFilters(f);
    expect(c).toEqual({ scope: "all", carries: false, onPage: false, kind: null, query: "", sort: "newest" });
    expect(narrowing(c)).toBe(false);
  });

  it("all trails holds each pin once even when several trail fetches return it", () => {
    expect(mergePinRows([[here1, parent], [parent, elsewhere], null, [here1]]).map((p) => p.id)).toEqual(["carried", "chip", "roses"]);
  });
});

describe("order", () => {
  it("default is bucket then manual position; newest is by creation, newest first", () => {
    expect(sortPanelPins([here2, global, here1]).map((p) => p.id)).toEqual(["carried", "anywhere", "release"]);
    expect(sortPanelPins([here1, here2, global], "newest").map((p) => p.id)[0]).toBe("release");
  });

  it("drag-reorder only in the order drag writes", () => {
    expect(canReorder(defaultPanelFilter())).toBe(true);
    expect(canReorder({ ...defaultPanelFilter(), sort: "newest" })).toBe(false);
  });
});

describe("sections and source lines", () => {
  it("this trail: own pins, then parent trails, then everywhere", () => {
    const s = panelSections(trailPins, { filter: defaultPanelFilter(), lineageId: "v08", lineages });
    expect(s.map((x) => [x.label, x.pins.length])).toEqual([
      ["on this trail", 2], ["from parent trails", 1], ["everywhere", 1],
    ]);
  });

  it("all trails: grouped by trail path in tree order, everywhere last", () => {
    const s = panelSections(allPins, { filter: { ...defaultPanelFilter(), scope: "all" }, lineageId: "v08", lineages });
    expect(s.map((x) => x.label)).toEqual(["shizumu", "shizumu › v0.8", "garden", "everywhere"]);
  });

  it("all trails keeps a pin whose trail is not in the list", () => {
    const stray = pin("stray", { lineage_id: "gone" });
    const s = panelSections([stray], { filter: { ...defaultPanelFilter(), scope: "all" }, lineageId: "v08", lineages });
    expect(s).toEqual([{ key: "trail:gone", label: "another trail", pins: [stray] }]);
  });

  it("the source line shows only off this trail", () => {
    const o = { filter: defaultPanelFilter(), lineageId: "v08", lineages };
    // The bug: every row repeated the trail chip under "on this trail".
    expect(pinSourceLine(here1, o)).toBeNull();
    expect(pinSourceLine(parent, o)).toBe("from shizumu (parent trail)");
    expect(pinSourceLine(global, o)).toBe("from everywhere");
    // Untrailed page: every pin is global and the section already says so.
    expect(pinSourceLine(global, { ...o, lineageId: null })).toBeNull();
    // All trails: the group heading names the trail.
    expect(pinSourceLine(parent, { ...o, filter: { ...o.filter, scope: "all" } })).toBeNull();
  });
});

describe("header words", () => {
  it("title names the trail path, or just pins", () => {
    expect(panelTitle("v08", lineages)).toBe("pins · shizumu › v0.8");
    expect(panelTitle(null, lineages)).toBe("pins");
  });
  it("placeholder says this trail only when that is what it searches", () => {
    expect(searchPlaceholder(defaultPanelFilter(), "v08")).toBe("search pins on this trail…");
    expect(searchPlaceholder({ ...defaultPanelFilter(), scope: "all" }, "v08")).toBe("search pins…");
    expect(searchPlaceholder(defaultPanelFilter(), null)).toBe("search pins…");
  });
});
