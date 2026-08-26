import { describe, it, expect } from "vitest";
import { needsTouchHandle, showsGutterCard } from "../touch-block-handle.js";

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
    for (const t of ["list", "blockquote", "qaBlock", "recipeBlock", "decisionBlock", "codeBlock", "table", "chart"]) {
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

describe("showsGutterCard", () => {
  // The empty chip-less block is the ONLY case the widget decoration already
  // covers, and it covers it in the same gutter — so a card there is a second
  // "+" a few pixels from the first. That is the reported "two + buttons".
  const emptyParagraph = { coarsePointer: true, canInsert: true, hasContent: false, isBoard: false };

  it("withholds the card from an empty chip-less block on touch — the decoration is already there", () => {
    expect(showsGutterCard(emptyParagraph)).toBe(false);
  });

  it("still shows it on a fine pointer, where the decoration never renders", () => {
    // Not a redundant inverse: prose.css hides .touch-block-handle outside
    // `pointer: coarse`, so on desktop this card is the ONLY insert
    // affordance. Withholding it there would leave an empty block with no
    // way to reach the insert menu at all.
    expect(showsGutterCard({ ...emptyParagraph, coarsePointer: false })).toBe(true);
  });

  it("shows it once the block has content — pin/copy/delete have no other home", () => {
    expect(showsGutterCard({ ...emptyParagraph, hasContent: true })).toBe(true);
  });

  it("shows it for a board, which offers delete even while empty", () => {
    expect(showsGutterCard({ coarsePointer: true, canInsert: false, hasContent: false, isBoard: true })).toBe(true);
  });

  it("shows it for a chip-less block that cannot insert either — nothing else would", () => {
    expect(showsGutterCard({ coarsePointer: true, canInsert: false, hasContent: false, isBoard: false })).toBe(true);
  });
});
