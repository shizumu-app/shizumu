import { describe, it, expect } from "vitest";
import { pinsEmptyState } from "./pin-panel-empty.js";

describe("what an empty pins list says", () => {
  it("an untrailed page with no pins says it has no trail, and offers the trail button — not 'nothing matches'", () => {
    const s = pinsEmptyState({ lineageId: null, scopeCount: 0, visibleCount: 0 });
    expect(s.kind).toBe("untrailed");
    expect(s.title).toBe("this page has no trail yet.");
    expect(s.body).toBe("choose one and the pins kept there come back here.");
    expect(s.action).toBe("chooseTrail");
  });

  it("a trail with no pins says so, with no clear-filters button to press", () => {
    const s = pinsEmptyState({ lineageId: "t", scopeCount: 0, visibleCount: 0 });
    expect(s).toMatchObject({ kind: "trailEmpty", title: "nothing pinned on this trail yet.", action: null });
  });

  it("a filter on an empty trail still reads as an empty trail — clearing it would show nothing either", () => {
    expect(pinsEmptyState({ lineageId: "t", scopeCount: 0, visibleCount: 0 }).kind).toBe("trailEmpty");
  });

  it("pins hidden by the search or a chip say nothing matches and offer clear filters", () => {
    const s = pinsEmptyState({ lineageId: null, scopeCount: 3, visibleCount: 0 });
    expect(s).toMatchObject({ kind: "noMatch", title: "nothing matches", action: "clearFilters" });
  });

  it("all trails with no pins anywhere does not talk about this page's trail", () => {
    expect(pinsEmptyState({ lineageId: null, scopeCount: 0, visibleCount: 0, allScope: true }).kind).toBe("allEmpty");
  });

  it("no empty state while loading or while pins show", () => {
    // Why null is right: the list (or the loading line) renders instead.
    expect(pinsEmptyState({ loading: true, lineageId: null, scopeCount: 0, visibleCount: 0 })).toBeNull();
    expect(pinsEmptyState({ lineageId: "t", scopeCount: 2, visibleCount: 2 })).toBeNull();
  });

  it("no copy uses the retired word or an exclamation mark", () => {
    const cases = [
      { lineageId: null, scopeCount: 0, visibleCount: 0 },
      { lineageId: "t", scopeCount: 0, visibleCount: 0 },
      { lineageId: "t", scopeCount: 1, visibleCount: 0 },
      { lineageId: "t", scopeCount: 0, visibleCount: 0, allScope: true },
    ];
    for (const c of cases) {
      const s = pinsEmptyState(c);
      const words = `${s.title} ${s.body}`;
      expect(words).not.toMatch(/sink|sunk|!/i);
      expect(words).toBe(words.toLowerCase());
    }
  });
});
