import { describe, it, expect } from "vitest";
import { trailCrumb } from "../trail-crumb.js";

describe("trailCrumb", () => {
  it("says nothing when the page has no trail", () => {
    // Not an oversight: the header renders a different control entirely
    // when there is no trail (`.ph-trail-empty`, the word `trail`), and a
    // crumb that returned a placeholder would have it render both.
    expect(trailCrumb({ name: null })).toBe("");
    expect(trailCrumb({ name: "   " })).toBe("");
    expect(trailCrumb({})).toBe("");
  });

  it("names a top-level trail by itself", () => {
    expect(trailCrumb({ name: "the book", parents: [] })).toBe("the book");
  });

  it("puts the parent in front of a nested one", () => {
    expect(trailCrumb({ name: "chapter two", parents: ["the book"] })).toBe(
      "the book › chapter two",
    );
  });

  it("keeps the trail's own name whole and drops ancestors to pay for it", () => {
    // THE RULE. The name is the answer to "where am I"; an ancestor is
    // context. The trail sheet used to cut the other way — 36 characters
    // from the end of the whole path — and `product › export api › v2 be…`
    // is a label that hides the only part being asked about.
    const crumb = trailCrumb({
      name: "chapter two",
      parents: ["a very long first book title", "part one"],
      max: 28,
    });
    expect(crumb.endsWith("chapter two")).toBe(true);
    expect(crumb.startsWith("…")).toBe(true);
    expect(crumb.length).toBeLessThanOrEqual(28);
  });

  it("keeps the nearest ancestor rather than the root", () => {
    // "part one › chapter two" tells a writer where they are; "the book ›
    // … › chapter two" tells them where they started. The parent is also
    // the one they just chose in the sheet.
    expect(
      trailCrumb({ name: "chapter two", parents: ["the book", "part one"], max: 28 }),
    ).toBe("… › part one › chapter two");
  });

  it("still says a trail is nested when no ancestor fits at all", () => {
    // A bare leaf here would claim the trail is top-level — the exact
    // thing the header said before this module, and a wrong answer rather
    // than a short one.
    const crumb = trailCrumb({
      name: "a chapter with a very long name indeed",
      parents: ["the book"],
      max: 28,
    });
    expect(crumb).toBe("… › a chapter with a very long name indeed");
  });

  it("ignores empty ancestors instead of drawing separators around them", () => {
    // A trail with no name is possible in the schema, and " › › chapter
    // two" is how that reaches a header if nobody filters.
    expect(trailCrumb({ name: "chapter two", parents: ["", "  ", "the book"] })).toBe(
      "the book › chapter two",
    );
  });

  it("collapses whitespace, because a name is typed by a person", () => {
    expect(trailCrumb({ name: "  chapter\n two ", parents: ["the   book"] })).toBe(
      "the book › chapter two",
    );
  });
});
