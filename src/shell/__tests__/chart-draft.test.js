// The three decisions ChartBuilder's modal frame made, now that the shell
// has replaced that frame: what a builder opens on, what switching kind
// costs, and when the draft may be written.
//
// These are hand-copies of rules that live inline inside a `.svelte` file
// (chart-draft.js's header says why they could not be imported), so the
// value of this suite is not that the rules are obvious — it is that a
// copy has somewhere to go wrong and nothing upstream will notice.
import { describe, it, expect } from "vitest";
import {
  chartDraft,
  withKind,
  chartCanCommit,
  chartAttrs,
} from "../chart-draft.js";
import { emptySource } from "../../lib/extensions/chart.js";

describe("chartDraft", () => {
  it("opens a create on an empty flowchart", () => {
    // What `/chart` hands over: `{mode: "create"}` and nothing else
    // (slash-commands.js:352). Every other field has to be invented here,
    // and flowchart is ChartBuilder's default kind.
    expect(chartDraft({ mode: "create" })).toEqual({
      mode: "create",
      pos: null,
      kind: "flowchart",
      source: emptySource("flowchart"),
      blockTitle: "",
    });
  });

  it("opens on an empty flowchart for no params at all", () => {
    // Not a defensive nicety: ShellApp holds this as the draft while the
    // sheet is SHUT, so the markup never has to test for null. If this
    // returned null the commit row would read off a missing object on
    // every render of the app.
    expect(chartDraft(null).kind).toBe("flowchart");
    expect(chartDraft(undefined).mode).toBe("create");
  });

  it("seeds an edit from the chart it was opened on", () => {
    const source = { direction: "LR", nodes: [{ id: "a", label: "one" }], edges: [] };
    const draft = chartDraft({
      mode: "edit",
      pos: 12,
      attrs: { kind: "flowchart", source, blockTitle: "  the shape  " },
    });

    expect(draft.mode).toBe("edit");
    expect(draft.pos).toBe(12);
    expect(draft.source).toEqual(source);
    expect(draft.blockTitle).toBe("the shape");
  });

  it("clones the source it was seeded with, so editing the form is not editing the node", () => {
    // The reason the whole draft exists rather than the form writing
    // straight to `attrs.source`. Backing out of the builder has to leave
    // the chart as it was, and a shared reference makes every keystroke a
    // silent mutation of a node nobody dispatched a transaction for.
    const source = { direction: "TB", nodes: [{ id: "a", label: "one" }], edges: [] };
    const draft = chartDraft({ mode: "edit", pos: 3, attrs: { kind: "flowchart", source } });

    draft.source.nodes[0].label = "changed";

    expect(source.nodes[0].label).toBe("one");
  });

  it("keeps no position for a create", () => {
    // A create has nothing to update. A stray number surviving onto the
    // draft would route commitChart through `updateChart` at a position
    // nothing was opened for — a write to whatever block happens to sit
    // there.
    expect(chartDraft({ mode: "create", pos: 40 }).pos).toBeNull();
  });

  it("falls back to flowchart for a kind no form renders", () => {
    // A chart written by a newer build, or a hand-edited doc. The form
    // list is an if/else-if chain with no else, so an unknown kind would
    // open a sheet with a title field, a commit row and nothing between
    // them.
    const draft = chartDraft({ mode: "edit", pos: 1, attrs: { kind: "sankey" } });
    expect(draft.kind).toBe("flowchart");
    expect(draft.source).toEqual(emptySource("flowchart"));
  });

  it.each([
    ["null — the schema's default", null],
    ["an empty object — a data-source that round-tripped to {}", {}],
  ])("seeds an empty form when the node's source is %s", (_why, source) => {
    const draft = chartDraft({ mode: "edit", pos: 1, attrs: { kind: "timeline", source } });
    expect(draft.source).toEqual(emptySource("timeline"));
  });
});

describe("withKind", () => {
  it("replaces the source, because two kinds share no field", () => {
    const draft = chartDraft({ mode: "create" });
    const next = withKind(draft, "timeline");

    expect(next.kind).toBe("timeline");
    expect(next.source).toEqual(emptySource("timeline"));
    expect(next.source.nodes).toBeUndefined();
  });

  it("keeps the title across a kind switch", () => {
    // `blockTitle` belongs to the BLOCK, not to the diagram inside it —
    // the same attribute every board carries. Losing it on a kind switch
    // would be losing something the writer typed for a reason unrelated
    // to what they typed it about.
    const draft = { ...chartDraft({ mode: "create" }), blockTitle: "the plan" };
    expect(withKind(draft, "mindmap").blockTitle).toBe("the plan");
  });

  it("returns the same draft for the kind already selected", () => {
    // Not "nothing happens, presumably correctly": a tab that rebuilt the
    // source on every tap would empty the form the writer had just filled
    // in, and the tab they are already on is the easiest one to tap twice.
    const draft = chartDraft({ mode: "create" });
    draft.source.nodes[0].label = "typed";

    expect(withKind(draft, "flowchart")).toBe(draft);
    expect(withKind(draft, "flowchart").source.nodes[0].label).toBe("typed");
  });

  it("refuses a kind no form renders, rather than blanking the draft", () => {
    // Same reason chartDraft falls back: the alternative is a sheet with
    // nothing in it. Here the safer answer is to leave what is there.
    const draft = chartDraft({ mode: "create" });
    expect(withKind(draft, "sankey")).toBe(draft);
  });
});

describe("chartCanCommit", () => {
  it.each(["flowchart", "mindmap"])("never gates a %s", (kind) => {
    // A flowchart node with no label is an empty box — a drawing in
    // progress, not a broken diagram. Only the timeline loses its meaning.
    expect(chartCanCommit(chartDraft({ mode: "create", attrs: { kind } }))).toBe(true);
  });

  it("withholds a timeline whose events have no dates", () => {
    // emptySource("timeline") is two dateless events, so this is the state
    // the builder OPENS in when a writer picks the timeline tab — the gate
    // is on by default rather than an edge case.
    expect(chartCanCommit(chartDraft({ mode: "create", attrs: { kind: "timeline" } }))).toBe(false);
  });

  it("commits a timeline once every event carries a date", () => {
    const draft = chartDraft({ mode: "create", attrs: { kind: "timeline" } });
    draft.source.events = [
      { date: "2026", label: "one", kind: "event" },
      { date: " 2027 ", label: "", kind: "event" },
    ];
    expect(chartCanCommit(draft)).toBe(true);
  });

  it("commits a timeline with no events at all", () => {
    // The empty result ChartBuilder spells out with an early return, kept
    // as an assertion rather than as a branch: `[].every()` is true, so an
    // events list the writer emptied is committable. There is nothing
    // undated in it to render as an orphan, and refusing would leave the
    // writer with a sheet they cannot leave through the row.
    const draft = chartDraft({ mode: "create", attrs: { kind: "timeline" } });
    draft.source.events = [];
    expect(chartCanCommit(draft)).toBe(true);
  });

  it.each([
    ["one date is blank", [{ date: "2026" }, { date: "" }]],
    ["one date is whitespace", [{ date: "2026" }, { date: "   " }]],
    ["one event is missing", [{ date: "2026" }, null]],
  ])("withholds a timeline when %s", (_why, events) => {
    const draft = chartDraft({ mode: "create", attrs: { kind: "timeline" } });
    draft.source.events = events;
    expect(chartCanCommit(draft)).toBe(false);
  });
});

describe("chartAttrs", () => {
  it("collapses an untyped title to null, not to an empty string", () => {
    // block-title.js defaults the attribute to null and its renderHTML
    // tests it for truthiness, so "" would be a second way to say "no
    // title" that only this path produces.
    expect(chartAttrs(chartDraft({ mode: "create" })).blockTitle).toBeNull();
    expect(chartAttrs({ ...chartDraft({ mode: "create" }), blockTitle: "  " }).blockTitle).toBeNull();
  });

  it("trims the title it keeps", () => {
    const draft = { ...chartDraft({ mode: "create" }), blockTitle: "  the shape  " };
    expect(chartAttrs(draft).blockTitle).toBe("the shape");
  });

  it("hands the document a source nothing else holds a reference to", () => {
    // What goes into a ProseMirror attribute has to be inert. In the shell
    // the draft is a Svelte 5 $state deep proxy, so without the clone the
    // node would hold a live reactive object and every later keystroke in
    // the builder would mutate a document nobody dispatched against.
    const draft = chartDraft({ mode: "create" });
    const attrs = chartAttrs(draft);

    draft.source.nodes[0].label = "after";

    expect(attrs.source).not.toBe(draft.source);
    expect(attrs.source.nodes[0].label).toBe("");
  });
});
