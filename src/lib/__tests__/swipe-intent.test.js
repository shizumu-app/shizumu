import { describe, it, expect } from "vitest";
import { swipeIntent } from "../swipe-intent.js";

describe("swipeIntent", () => {
  describe("on the page surface with nothing open", () => {
    const base = { space: "page", navDepth: 0 };

    it("swiping in from the left goes to the previous page", () => {
      // The reported bug: this used to be disabled outright, so a swipe
      // from the left edge did nothing at all on a plain page.
      expect(swipeIntent({ ...base, edge: "left" })).toBe("prev");
    });

    it("swiping in from the right goes to the next page", () => {
      // And this used to create a page every single time.
      expect(swipeIntent({ ...base, edge: "right" })).toBe("next");
    });
  });

  describe("when something is open", () => {
    it("keeps the left edge as back while a sheet is up", () => {
      expect(swipeIntent({ edge: "left", space: "page", navDepth: 1 })).toBe("back");
    });

    it("keeps the left edge as back from memory", () => {
      expect(swipeIntent({ edge: "left", space: "memory", navDepth: 0 })).toBe("back");
    });

    it("ignores the right edge rather than navigating under a sheet", () => {
      expect(swipeIntent({ edge: "right", space: "page", navDepth: 2 })).toBe(null);
    });
  });

  describe("outside the page surface", () => {
    it("does not navigate the rail from memory", () => {
      expect(swipeIntent({ edge: "right", space: "memory", navDepth: 0 })).toBe(null);
    });
  });

  it("ignores a drag that started in neither edge", () => {
    expect(swipeIntent({ edge: null, space: "page", navDepth: 0 })).toBe(null);
  });

  it("defaults navDepth to zero", () => {
    expect(swipeIntent({ edge: "left", space: "page" })).toBe("prev");
  });
});
