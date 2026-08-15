import { describe, it, expect } from "vitest";
import { needsTouchHandle, touchHandleKind } from "../touch-block-handle.js";

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

describe("touchHandleKind", () => {
  it("is \"insert\" for an empty paragraph or heading — the gutter '+' opens the slash menu, same as desktop's empty-block handle", () => {
    expect(touchHandleKind("paragraph", false)).toBe("insert");
    expect(touchHandleKind("heading", false)).toBe("insert");
  });

  it("is \"actions\" for a paragraph or heading that has content — the gutter '⋯' opens the block-actions sheet", () => {
    expect(touchHandleKind("paragraph", true)).toBe("actions");
    expect(touchHandleKind("heading", true)).toBe("actions");
  });

  it("is null for board types regardless of content — they own a real chip already, so no synthetic handle of either kind renders", () => {
    for (const t of ["list", "blockquote", "qaBlock", "recipeBlock", "codeBlock", "table", "chart"]) {
      expect(touchHandleKind(t, false)).toBe(null);
      expect(touchHandleKind(t, true)).toBe(null);
    }
  });

  it("is null for types with no block-actions sheet entry at all", () => {
    expect(touchHandleKind("dayMarker", false)).toBe(null);
    expect(touchHandleKind("horizontalRule", true)).toBe(null);
  });
});
