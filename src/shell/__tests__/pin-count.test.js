import { describe, it, expect } from "vitest";
import { pinsLabel } from "../pin-count.js";

describe("pinsLabel", () => {
  it("says how many pins the list behind the control holds", () => {
    expect(pinsLabel(3)).toBe("pins · 3");
    expect(pinsLabel(1)).toBe("pins · 1");
  });

  it("says the word alone before the list has been read", () => {
    // Measured, or not said: null is a page whose pins are not counted
    // yet, and a stale number from the last page would name a list the
    // control no longer opens.
    expect(pinsLabel(null)).toBe("pins");
    expect(pinsLabel(undefined)).toBe("pins");
  });

  it("says the word alone for none, rather than counting an absence", () => {
    expect(pinsLabel(0)).toBe("pins");
  });

  it("refuses a number that is not a count", () => {
    expect(pinsLabel(2.5)).toBe("pins");
    expect(pinsLabel(-1)).toBe("pins");
    expect(pinsLabel(NaN)).toBe("pins");
  });
});
