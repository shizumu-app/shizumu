import { describe, it, expect } from "vitest";
import { DOT_CAP, railDots } from "../rail-dots.js";

describe("railDots", () => {
  it("keeps the dots while they can still be counted", () => {
    for (let count = 1; count <= DOT_CAP; count++) {
      expect(railDots({ count, index: 0 }).kind).toBe("dots");
    }
  });

  it("gives way to a count past the cap, which is what kept the header usable", () => {
    // MEASURED ON A DESKTOP: twenty-odd pages on one day drew twenty-odd dots
    // in a row that never yields, running straight into the synced chip and
    // the trail control. The phone met the same wall at twenty-eight and
    // drew the same line (shell/page-dots.js); the two surfaces now agree.
    const shape = railDots({ count: 23, index: 11 });
    expect(shape.kind).toBe("count");
    expect(shape.label).toBe("12 / 23");
  });

  it("offers the page before and the page after, and nothing past either end", () => {
    // The dots were also how a writer clicked to another page, so the count
    // carries the step either side; at an end there is no step to offer.
    expect(railDots({ count: 20, index: 5 })).toMatchObject({ prev: 4, next: 6 });
    expect(railDots({ count: 20, index: 0 })).toMatchObject({ prev: null, next: 1 });
    expect(railDots({ count: 20, index: 19 })).toMatchObject({ prev: 18, next: null });
  });

  it("says how many pages there are when the open page is not one of them", () => {
    // A past day open in the editor while the rail lists today's pages: there
    // is no position to show, and "0 / 20" would be a lie about where you are.
    expect(railDots({ count: 20, index: -1 })).toMatchObject({ kind: "count", label: "20 pages", prev: null, next: null });
  });

  it("caps where the phone does", () => {
    expect(DOT_CAP).toBe(8);
  });
});
