import { describe, it, expect } from "vitest";
import { findCountLabel } from "../find-count-label.js";

describe("findCountLabel", () => {
  it("says how many were found when matches exist but none is current", () => {
    // THE regression. The template read `{activeIdx + 1} of {total}` under
    // a bare `total > 0`, so this state rendered "0 of 3" — a match
    // numbered zero that no arrow reaches, while no match carries the
    // active highlight either (find-replace.js:115).
    //
    // Reachable, not hypothetical: find-replace.js's doc-change branch
    // (:96-102) carries prev.activeIdx forward and never promotes -1 back
    // to 0, so a query that matched nothing and then starts matching —
    // because the writer typed the word into the page — lands here.
    expect(findCountLabel("pin", 3, -1)).toBe("3 matches");
  });

  it("says '1 match', not '1 matches'", () => {
    expect(findCountLabel("pin", 1, -1)).toBe("1 match");
  });

  it("counts from one once a match is current", () => {
    // The ordinary case, and the one the fix must not have changed.
    expect(findCountLabel("pin", 3, 0)).toBe("1 of 3");
    expect(findCountLabel("pin", 3, 2)).toBe("3 of 3");
  });

  it("says 'no matches' for a query that found nothing", () => {
    expect(findCountLabel("zzz", 0, -1)).toBe("no matches");
  });

  it("says nothing at all before anything is typed", () => {
    // Not a placeholder assertion, and not the same as "no matches": an
    // untyped field reporting a failed search accuses the writer of
    // something they have not done, on the frame the bar opens. Asserted
    // apart from the no-matches case because a single `{:else}` would
    // collapse the two and read as correct.
    expect(findCountLabel("", 0, -1)).toBe("");
    expect(findCountLabel("", 3, -1)).toBe("");
  });

  it("treats a query of spaces as typed, because the document does", () => {
    // collectMatches (find-replace.js:28-45) searches the raw string, so
    // spaces really do match. Trimming here would blank the label while
    // the page lit up behind it.
    expect(findCountLabel(" ", 12, -1)).toBe("12 matches");
  });

  it("defaults to saying nothing rather than guessing", () => {
    // The bar renders before the extension's first broadcast arrives.
    expect(findCountLabel("")).toBe("");
  });
});
