import { describe, it, expect } from "vitest";
import { needsTouchHandle } from "../touch-block-handle.js";

describe("needsTouchHandle", () => {
  it("is true for paragraph and heading — the two block types block-shell.js never gives a chip", () => {
    expect(needsTouchHandle("paragraph")).toBe(true);
    expect(needsTouchHandle("heading")).toBe(true);
  });

  it("is false for every board type — they already render their own .block-type-chip", () => {
    // Asserting false here isn't "nothing happens for no reason" (CLAUDE.md):
    // each of these types owns a real chip (block-shell.js, table-shell-view.js,
    // or the BlockTypeChip widget plugin), so a synthetic handle on top would
    // be a second, redundant tap target landing at the same corner.
    for (const t of ["list", "blockquote", "qaBlock", "recipeBlock", "codeBlock", "table", "chart"]) {
      expect(needsTouchHandle(t)).toBe(false);
    }
  });

  it("is false for other top-level node types with no block-actions sheet entry at all", () => {
    for (const t of ["dayMarker", "horizontalRule", "attachment", "localImage"]) {
      expect(needsTouchHandle(t)).toBe(false);
    }
  });

  it("is false for garbage input rather than throwing", () => {
    expect(needsTouchHandle(undefined)).toBe(false);
    expect(needsTouchHandle("")).toBe(false);
  });
});
