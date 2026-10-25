import { describe, it, expect } from "vitest";
import { findStripModel } from "../find-strip-model.js";
import { TOOLBAR_BUTTON_LABELS } from "../toolbar-model.js";

// The three numbers this module reads are the exact payload of the
// `shizumu:find-state` window event (find-replace.js:59-67), so the fixture
// is that shape and nothing wider — a test that invents a field the plugin
// never broadcasts is the P1a defect toolbar-state.js's header records.
const state = (over = {}) => ({ query: "", total: 0, activeIdx: -1, ...over });

describe("findStripModel — the label", () => {
  it("says nothing at all before anyone has typed", () => {
    // Not "no matches": see the dedicated case below, which is the whole
    // reason this module exists rather than a ternary in the strip.
    expect(findStripModel(state()).label).toBe("");
  });

  it("says 'no matches' for a query that found none", () => {
    // The desktop's wording, verbatim (FindBar.svelte:132). One feature,
    // one phrasing — a phone user and a desktop user describing the same
    // screen to each other should be describing the same words.
    expect(findStripModel(state({ query: "zzz", total: 0 })).label).toBe("no matches");
  });

  it("counts from one on the first match", () => {
    // FindBar.svelte:130 renders `{activeIdx + 1} of {total}`.
    expect(findStripModel(state({ query: "a", total: 3, activeIdx: 0 })).label).toBe("1 of 3");
  });

  it("says '3 of 3' on the last match rather than wrapping the label", () => {
    // Wrap-around belongs to the extension (`nextFindMatch` mods by
    // matches.length, find-replace.js:153). The label reports where the
    // caret is; it does not predict where the next tap goes.
    expect(findStripModel(state({ query: "a", total: 3, activeIdx: 2 })).label).toBe("3 of 3");
  });

  it("counts the matches, and does not say 'of', when none is active yet", () => {
    // total > 0 with activeIdx -1 is REACHABLE, and the desktop gets it
    // wrong. find-replace.js:97-102: a doc edit re-collects matches for the
    // standing query and carries prev.activeIdx forward untouched unless it
    // ran off the end. So a query that matched nothing (activeIdx -1) and
    // then starts matching because the user typed the word lands here with
    // activeIdx still -1. FindBar.svelte:130 renders "0 of 1" there —
    // a match numbered zero, which is not a match anyone can go to, and
    // nothing carries the active highlight either (find-replace.js:115).
    // The count is the honest reading, so this is the one state where the
    // phone deliberately does not copy the desktop's output.
    expect(findStripModel(state({ query: "a", total: 3, activeIdx: -1 })).label).toBe("3 matches");
  });

  it("says '1 match', singular, when the only match is not active yet", () => {
    expect(findStripModel(state({ query: "a", total: 1, activeIdx: -1 })).label).toBe("1 match");
  });

  it("treats a query of spaces as a real search, not as an untyped field", () => {
    // The plugin matches on the raw string (collectMatches, :28-45), so a
    // space is a substring people really do search for. Trimming here would
    // print nothing while the editor highlighted every space in the doc.
    expect(findStripModel(state({ query: " ", total: 0 })).label).toBe("no matches");
  });
});

describe("findStripModel — an untyped field is not a failed search", () => {
  it("gives the empty query and the no-match query DIFFERENT labels", () => {
    // Step 3 of the plan, and the assertion the module is built to satisfy.
    // Both states have total 0; only the query separates them. If these two
    // ever agree, a strip that has just opened accuses the user of a failed
    // search they never ran.
    const untyped = findStripModel(state()).label;
    const missed = findStripModel(state({ query: "zzz", total: 0 })).label;
    expect(untyped).not.toBe(missed);
    expect(untyped).toBe("");
    expect(missed).toBe("no matches");
  });
});

describe("findStripModel — which controls are dead", () => {
  it("kills prev and next with no matches to step between", () => {
    expect(findStripModel(state()).disabledIds).toEqual(["prev", "next"]);
    expect(findStripModel(state({ query: "zzz", total: 0 })).disabledIds).toEqual(["prev", "next"]);
  });

  it("leaves prev and next live the moment there is a match", () => {
    // Asserting the real behaviour rather than an empty array on its own:
    // an empty result here means every find control is live, which is only
    // meaningful next to the case above where two of them are not.
    expect(findStripModel(state({ query: "a", total: 3, activeIdx: 0 })).disabledIds).toEqual([]);
    expect(findStripModel(state({ query: "a", total: 1, activeIdx: 0 })).disabledIds).toEqual([]);
  });

  it("leaves next live when no match is active yet — it is the way to the first one", () => {
    // `nextFindMatch` with activeIdx -1 computes (-1 + 1) % total = 0
    // (find-replace.js:153), so this is precisely the state where next is
    // most needed. Disabling on "no active match" would strand the user.
    expect(findStripModel(state({ query: "a", total: 2, activeIdx: -1 })).disabledIds).toEqual([]);
  });

  it("never kills the field or close — a bad query has to be editable and escapable", () => {
    // The one branch where killing them would be tempting is the empty
    // strip, so that is the branch checked.
    const { disabledIds } = findStripModel(state());
    expect(disabledIds).not.toContain("field");
    expect(disabledIds).not.toContain("close");
  });

  it("names only ids the strip can actually render", () => {
    // toolbar-state.js's header: an id the strip never renders produces no
    // button and no error, so a rename of `prev`/`next` in toolbar-model
    // would silently un-disable them instead of failing. This is the check
    // that makes that rename loud.
    for (const id of ["field", "prev", "next", "close"]) {
      expect(Object.keys(TOOLBAR_BUTTON_LABELS)).toContain(id);
    }
    const all = [
      findStripModel(state()),
      findStripModel(state({ query: "a", total: 3, activeIdx: 1 })),
    ].flatMap((m) => m.disabledIds);
    for (const id of all) expect(Object.keys(TOOLBAR_BUTTON_LABELS)).toContain(id);
  });
});

describe("findStripModel — before the first broadcast", () => {
  it("reads a missing argument as an untyped field with nothing to step through", () => {
    // The strip paints as soon as findOpen flips; the plugin's first
    // `shizumu:find-state` arrives a tick later (find-replace.js:121-124),
    // so the caller genuinely has nothing to pass on the first frame.
    // Falling to the untyped state means that frame shows a blank label and
    // dead arrows, which is what an empty field should look like anyway.
    expect(findStripModel()).toEqual({ label: "", disabledIds: ["prev", "next"] });
    expect(findStripModel({})).toEqual({ label: "", disabledIds: ["prev", "next"] });
  });
});
