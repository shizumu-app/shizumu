import { describe, it, expect } from "vitest";
import { pageDots, DOT_CAP } from "../page-dots.js";

describe("pageDots", () => {
  it("shows nothing for a day with one page", () => {
    // Not an empty list standing in for a bug: one dot is not a page
    // indicator, it is a smudge, and a day with a single page has nothing
    // to switch BETWEEN. The header hangs its pages-sheet control off this,
    // so "none" is also what makes that control absent rather than inert.
    expect(pageDots({ pageCount: 1, pageNumber: 1 })).toEqual({
      kind: "none", dots: [], label: null,
    });
  });

  it("shows a dot per page while they can still be counted", () => {
    const m = pageDots({ pageCount: 6, pageNumber: 2 });
    expect(m.kind).toBe("dots");
    expect(m.dots).toEqual([1, 2, 3, 4, 5, 6]);
    expect(m.label).toBe(null);
  });

  it("keeps dots at the cap and swaps to a count one past it", () => {
    // The boundary in both directions, because an off-by-one here is the
    // difference between the last countable row and the first unreadable
    // one, and neither looks wrong on its own.
    expect(pageDots({ pageCount: DOT_CAP, pageNumber: 1 }).kind).toBe("dots");
    expect(pageDots({ pageCount: DOT_CAP, pageNumber: 1 }).dots).toHaveLength(DOT_CAP);
    expect(pageDots({ pageCount: DOT_CAP + 1, pageNumber: 1 }).kind).toBe("count");
  });

  it("says which of how many once there are too many to count", () => {
    // THE DAY THIS WAS WRITTEN FOR, measured on an A16: 28 pages, a 384px
    // viewport, the dot row 329px wide, `+` at l=364 and so off the screen,
    // and the trail control squeezed to w=0. A writer could not start a new
    // page and could not put that page on a trail.
    const m = pageDots({ pageCount: 28, pageNumber: 12 });
    expect(m.kind).toBe("count");
    expect(m.label).toBe("12 / 28");
    // No dots to lay out is what gives the row back to the two controls.
    expect(m.dots).toEqual([]);
  });

  it("never reads as a position outside the day it is counting", () => {
    // `31 / 28` is arithmetic leaking onto the screen. It is reachable
    // mid-load, when the count has landed and the ordinal has not, or after
    // a delete that the two numbers learn about a frame apart.
    expect(pageDots({ pageCount: 28, pageNumber: 31 }).label).toBe("28 / 28");
  });

  it("floors both numbers rather than rendering a placeholder", () => {
    // "page 1 of 0" is the shape page-model.js exists to keep off the bar,
    // and the same load that produces it reaches here. A missing ordinal is
    // the first page, which is what it will say a frame later anyway.
    expect(pageDots({ pageCount: 0, pageNumber: 0 }).kind).toBe("none");
    expect(pageDots({}).kind).toBe("none");
    expect(pageDots({ pageCount: 12, pageNumber: null }).kind).toBe("count");
    expect(pageDots({ pageCount: 12, pageNumber: null }).label).toBe("1 / 12");
  });

  it("refuses a non-integer count instead of building a row from it", () => {
    // `Array.from({length: 4.5})` is not a thing anyone meant to render,
    // and a count arriving as a string is a caller bug worth flooring
    // rather than forwarding.
    expect(pageDots({ pageCount: "6", pageNumber: 1 }).kind).toBe("none");
    expect(pageDots({ pageCount: 4.5, pageNumber: 1 }).kind).toBe("none");
  });
});
