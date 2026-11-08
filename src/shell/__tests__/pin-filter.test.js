import { describe, it, expect } from "vitest";
import {
  atRest,
  clearPanelFilters,
  defaultPanelFilter,
  pinDetailLine,
  pinScope,
  pinsScreenModel,
  setKind,
  tapChip,
} from "../pin-filter.js";

const pin = (id, lineageId, over = {}) => ({
  id,
  lineage_id: lineageId,
  object_type: "note",
  title: id,
  content: `${id} text`,
  ...over,
});

const LINEAGES = [
  { id: "PARENT", name: "shizumu", parent_id: null },
  { id: "L1", name: "v0.8", parent_id: "PARENT" },
  { id: "L2", name: "the relay", parent_id: null },
];

const model = (over = {}) =>
  pinsScreenModel({
    trailPins: [],
    lineageId: "L1",
    lineages: LINEAGES,
    filter: defaultPanelFilter(),
    ...over,
  });

const ids = (m) => m.sections.flatMap((s) => s.pins.map((r) => r.pin.id));

describe("pinScope", () => {
  it("calls the screen's own trail 'here', an ancestor's 'inherited', no trail 'global'", () => {
    expect(pinScope(pin("a", "L1"), "L1")).toBe("here");
    expect(pinScope(pin("a", "PARENT"), "L1")).toBe("inherited");
    // NOT "here" on an untrailed page: get_pins(null) is every pin taken
    // off an untrailed page, app-wide — calling them "this trail" would
    // name a trail the writer does not have.
    expect(pinScope(pin("a", null), null)).toBe("global");
  });
});

describe("pinsScreenModel — the chip row", () => {
  it("offers the desktop's chip set, each with its count", () => {
    // THE BUG: the phone had one segment over the sections and nothing
    // else — no carries forward, no on this page, no kind — and only when
    // the list held two sections. Ruling 5 gives it the desktop's chips.
    const m = model({
      trailPins: [pin("a", "L1", { auto_insert: true, source_page_id: "P1" }), pin("b", "PARENT")],
      pageId: "P1",
      allCount: 7,
    });
    expect(m.chips.map((c) => [c.id, c.label, c.count])).toEqual([
      ["trail", "this trail", 2],
      ["all", "all trails", 7],
      ["carries", "carries forward", 1],
      ["onPage", "on this page", 1],
      ["kind", "kind", null],
    ]);
    expect(m.chips.find((c) => c.id === "trail").active).toBe(true);
  });

  it("names a chip and its count for a screen reader", () => {
    const m = model({ trailPins: [pin("a", "L1", { auto_insert: true })] });
    expect(m.chips.find((c) => c.id === "carries").ariaLabel).toBe("carries forward, 1 pin");
    expect(m.chips.find((c) => c.id === "kind").ariaLabel).toBe("kind");
  });

  it("counts all trails from the counts query until its rows are read, then from the rows", () => {
    // A 0 beside `all trails` before the fan-out ran would tell a writer
    // with a hundred pins that they have none.
    expect(model({ allCount: 12 }).chips.find((c) => c.id === "all").count).toBe(12);
    expect(model({ allCount: 12, allPins: [pin("x", "L2")] }).chips.find((c) => c.id === "all").count).toBe(1);
  });

  it("calls the first scope `everywhere` on an untrailed page", () => {
    expect(model({ lineageId: null }).chips[0].label).toBe("everywhere");
  });

  it("draws no symbol into a label — the kind chip says kind, then the kind chosen", () => {
    // shell-rules: symbols are drawn, not typed (the bundled DM Mono has
    // no ▾). The desktop's `kind ▾` is the one label the phone rewords.
    const filter = setKind(defaultPanelFilter(), "lists");
    const m = model({ filter, trailPins: [pin("a", "L1", { object_type: "bulletList" })] });
    const kind = m.chips.find((c) => c.id === "kind");
    expect(kind.label).toBe("lists");
    expect(kind.active).toBe(true);
    for (const chip of m.chips) expect(chip.label).not.toMatch(/[←-➿]/);
  });
});

describe("pinsScreenModel — the kind row", () => {
  it("lists the six families with what each would keep, only while open", () => {
    const trailPins = [pin("a", "L1"), pin("b", "L1", { object_type: "board", content: JSON.stringify({ type: "codeBlock", content: [{ type: "text", text: "x" }] }) })];
    expect(model({ trailPins }).kinds).toEqual([]);
    const open = model({ trailPins, kindOpen: true });
    expect(open.kinds.map((k) => [k.id, k.count])).toEqual([
      ["text", 1],
      ["lists", 0],
      ["structure", 0],
      ["charts", 0],
      ["code", 1],
      ["files", 0],
    ]);
  });

  it("opens on the first tap and closes on the second, clearing the kind it held", () => {
    const filter = defaultPanelFilter();
    const opened = tapChip({ filter, kindOpen: false }, "kind");
    expect(opened.kindOpen).toBe(true);
    const chosen = setKind(opened.filter, "code");
    const closed = tapChip({ filter: chosen, kindOpen: true }, "kind");
    expect(closed).toEqual({ filter: { ...chosen, kind: null }, kindOpen: false });
  });

  it("passes the other chips to the desktop's toggle", () => {
    const { filter } = tapChip({ filter: defaultPanelFilter() }, "carries");
    expect(filter.carries).toBe(true);
    expect(tapChip({ filter: defaultPanelFilter() }, "all").filter.scope).toBe("all");
  });
});

describe("pinsScreenModel — rows, sections and search", () => {
  const rows = [
    pin("a", "L1"),
    pin("b", "PARENT", { content: "the relay holds blobs" }),
    pin("c", "L1", { status: "orphaned" }),
  ];

  it("shows every row the fetch returned at rest, orphans included", () => {
    // pin-toast.js: the breadcrumb's count is getPins(lineageId).length,
    // every status included, and it names THIS list. The resting filter
    // dropping any row would put the number and the list out of step.
    const m = model({ trailPins: rows });
    expect(ids(m).sort()).toEqual(["a", "b", "c"]);
    expect(atRest(defaultPanelFilter())).toBe(true);
  });

  it("sections this trail's own, then the parent trails', with counts", () => {
    const m = model({ trailPins: rows });
    expect(m.sections.map((s) => s.label)).toEqual(["on this trail · 2", "from parent trails · 1"]);
  });

  it("says where a pin came from only when it is not this trail's", () => {
    const m = model({ trailPins: rows });
    const detail = Object.fromEntries(m.sections.flatMap((s) => s.pins.map((r) => [r.pin.id, r.detail])));
    expect(detail.a).toBeNull();
    expect(detail.b).toBe("from shizumu (parent trail)");
  });

  it("says a pin carries forward in words", () => {
    const ctx = { filter: defaultPanelFilter(), lineageId: "L1", lineages: LINEAGES };
    expect(pinDetailLine(pin("a", "L1", { auto_insert: true }), ctx)).toBe("carries forward to new pages");
    expect(pinDetailLine(pin("b", "PARENT", { auto_insert: true }), ctx)).toBe(
      "from shizumu (parent trail) · carries forward to new pages",
    );
  });

  it("searches title and content", () => {
    const m = model({ trailPins: rows, filter: { ...defaultPanelFilter(), query: "relay" } });
    expect(ids(m)).toEqual(["b"]);
    expect(m.placeholder).toBe("search pins on this trail…");
  });

  it("groups all trails by trail path, everywhere last", () => {
    const allPins = [pin("x", "L2"), pin("g", null), pin("a", "L1")];
    const m = model({ allPins, filter: { ...defaultPanelFilter(), scope: "all" } });
    expect(m.sections.map((s) => s.label)).toEqual(["shizumu › v0.8 · 1", "the relay · 1", "everywhere · 1"]);
    expect(m.placeholder).toBe("search pins…");
  });

  it("says it is reading, not empty, while all trails' rows are on their way", () => {
    // "nothing pinned yet" while the fan-out is in flight would tell a
    // writer with fifty pins that they have none.
    const m = model({ filter: { ...defaultPanelFilter(), scope: "all" } });
    expect(m.needsAllPins).toBe(true);
    expect(m.reading).toBe(true);
    expect(m.empty).toBeNull();
  });
});

describe("pinsScreenModel — empty states", () => {
  it("tells an untrailed page to choose a trail, not that nothing matches", () => {
    // THE BUG the desktop shipped and the phone would have copied: an
    // empty list read "nothing matches" with nothing searched.
    const m = model({ lineageId: null });
    expect(m.empty.kind).toBe("untrailed");
    expect(m.empty.action).toBe("chooseTrail");
  });

  it("says nothing is pinned on a trail with no pins", () => {
    expect(model().empty.title).toBe("nothing pinned on this trail yet.");
  });

  it("offers clear filters only when a filter hid the pins", () => {
    const m = model({ trailPins: [pin("a", "L1")], filter: { ...defaultPanelFilter(), query: "zebra" } });
    expect(m.empty).toMatchObject({ kind: "noMatch", title: "nothing matches", action: "clearFilters" });
    expect(clearPanelFilters({ ...defaultPanelFilter(), query: "zebra", carries: true }).query).toBe("");
  });

  it("has no empty state while the trail is still being read", () => {
    // Not a vacuous null: "reading the pins" is the screen's state then,
    // and an empty-state sentence under it would contradict it.
    const m = model({ loading: true });
    expect(m.empty).toBeNull();
    expect(m.reading).toBe(true);
  });
});
