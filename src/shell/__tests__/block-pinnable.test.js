import { describe, it, expect } from "vitest";
import { blockPinnable } from "../block-pinnable.js";

describe("blockPinnable", () => {
  it("offers a board the writer has named and not yet filled", () => {
    // The photograph: a q&a titled `Cccccc` with its question and answer
    // empty, and no pin in its sheet. The name is writing.
    expect(blockPinnable({ text: "", isBoard: true, blockTitle: "Cccccc" })).toBe(true);
  });

  it("keeps an unnamed, empty board unpinnable", () => {
    // Nothing to keep and nothing to call it: a pin row saying nothing
    // is the failure pin-intent.js exists to refuse.
    expect(blockPinnable({ text: "", isBoard: true, blockTitle: "" })).toBe(false);
    expect(blockPinnable({ text: "", isBoard: true, blockTitle: "   " })).toBe(false);
  });

  it("does not let a stray title make an empty PARAGRAPH pinnable", () => {
    // Only boards render a title slot; an attr on anything else is not a
    // name the writer can see, so it is not writing they kept.
    expect(blockPinnable({ text: "", isBoard: false, blockTitle: "x" })).toBe(false);
  });

  it("keeps the shared rule for text and for content outside the text", () => {
    expect(blockPinnable({ text: "a line" })).toBe(true);
    expect(blockPinnable({ text: "  " })).toBe(false);
    expect(blockPinnable({ text: "", hasNonTextContent: true })).toBe(true);
  });
});
