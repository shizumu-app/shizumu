import { describe, it, expect } from "vitest";
import { keptBlockPress, pinHeldBy } from "../kept-block-press.js";

describe("keptBlockPress", () => {
  it("the first press asks and arms that pin", () => {
    expect(keptBlockPress("p1", null)).toEqual({ action: "ask", armedFor: "p1" });
  });
  it("the second press on the same pin unpins and disarms", () => {
    expect(keptBlockPress("p1", "p1")).toEqual({ action: "unpin", armedFor: null });
  });
  it("a press armed for another block asks again: it never unpins what was not asked about", () => {
    expect(keptBlockPress("p2", "p1")).toEqual({ action: "ask", armedFor: "p2" });
  });
  it("no pin to name never unpins", () => {
    expect(keptBlockPress(null, null).action).toBe("ask");
  });
});

describe("pinHeldBy", () => {
  const pins = [{ id: "a", content: "x" }, { id: "b", content: "y" }];
  it("the stamp wins over content", () => {
    expect(pinHeldBy(pins, { pinId: "b", content: "x" }).id).toBe("b");
  });
  it("a stamp naming a deleted pin falls to the content, and then to nothing", () => {
    expect(pinHeldBy(pins, { pinId: "gone", content: "x" }).id).toBe("a");
    expect(pinHeldBy(pins, { pinId: "gone", content: "z" })).toBeNull();
  });
});
