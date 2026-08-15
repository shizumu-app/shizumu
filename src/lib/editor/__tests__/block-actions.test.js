import { describe, it, expect } from "vitest";
import { blockActionsFor } from "../block-actions.js";

describe("blockActionsFor — a filled paragraph/heading", () => {
  it("offers pin, copy, delete — no title (not a board), no insert-below (not empty)", () => {
    expect(blockActionsFor({ isBoard: false, hasTitle: false, canPin: true, isEmpty: false }))
      .toEqual(["pin", "copy", "delete"]);
  });
});

describe("blockActionsFor — an empty paragraph/heading", () => {
  it("offers ONLY insert-below — nothing to pin, copy, or delete, and it isn't a board", () => {
    // This is the "nothing happens for content actions" case CLAUDE.md's
    // testing rule calls out by name: it's correct because an empty
    // paragraph has no content to pin/copy and deleting an empty
    // paragraph isn't a meaningful board-delete (isBoard is false here) —
    // not because the function forgot to compute anything.
    expect(blockActionsFor({ isBoard: false, hasTitle: false, canPin: false, isEmpty: true }))
      .toEqual(["insert-below"]);
  });
});

describe("blockActionsFor — a filled board with a real title slot (list/blockquote/qaBlock/recipeBlock)", () => {
  it("offers pin, copy, title, delete — never insert-below (a board is never the empty-paragraph case)", () => {
    expect(blockActionsFor({ isBoard: true, hasTitle: true, canPin: true, isEmpty: false }))
      .toEqual(["pin", "copy", "title", "delete"]);
  });
});

describe("blockActionsFor — an empty board (e.g. a list with no items yet)", () => {
  it("offers title and delete only — no content to pin or copy", () => {
    expect(blockActionsFor({ isBoard: true, hasTitle: true, canPin: false, isEmpty: false }))
      .toEqual(["title", "delete"]);
  });
});

describe("blockActionsFor — a board type with no title-slot element (e.g. table)", () => {
  it("omits title even though isBoard is true — hasTitle is read off the DOM, not inferred from isBoard", () => {
    expect(blockActionsFor({ isBoard: true, hasTitle: false, canPin: true, isEmpty: false }))
      .toEqual(["pin", "copy", "delete"]);
  });
});

describe("blockActionsFor — no arguments", () => {
  it("offers nothing — every gate defaults closed", () => {
    // Same "nothing happens" shape as the empty-paragraph case above, for
    // a different reason: with every flag defaulted to false/undefined,
    // there is no signal this block is a board, has content, has a title
    // slot, or is an insertable empty text block — so no action applies.
    expect(blockActionsFor({})).toEqual([]);
    expect(blockActionsFor()).toEqual([]);
  });
});

describe("blockActionsFor — action order is fixed regardless of input order", () => {
  it("always returns pin, copy, title, insert-below, delete in that relative order", () => {
    // isEmpty+canPin+hasTitle+isBoard all true is not a real block shape
    // (an insertable empty block is never also a board with content) but
    // exercising every gate at once locks the ORDER contract explicitly,
    // independent of which real block shapes exist today.
    expect(blockActionsFor({ isBoard: true, hasTitle: true, canPin: true, isEmpty: true }))
      .toEqual(["pin", "copy", "title", "insert-below", "delete"]);
  });
});
