import { describe, it, expect } from "vitest";
import {
  needsFreshLine,
  needsLeadingParagraph,
  BLOCK_COMMANDS,
  IN_PLACE_COMMANDS,
  TITLE_ESCAPE_TYPES,
} from "../slash-insert-target.js";
import { commandItems } from "../../slash-commands.js";

describe("needsFreshLine", () => {
  it("gives a block command a new line when the current line has writing on it", () => {
    // The reported bug: /outline on a written sentence wrapped the
    // sentence into the outline instead of making a new one.
    expect(needsFreshLine("outline", true)).toBe(true);
    expect(needsFreshLine("task", true)).toBe(true);
    expect(needsFreshLine("q&a", true)).toBe(true);
  });

  it("leaves a block command in place on an empty line", () => {
    // The common flow — Enter, "/", pick a block — and converting the
    // blank line you are standing on is exactly right there. Inserting
    // below would leave a stray empty paragraph above every block.
    expect(needsFreshLine("outline", false)).toBe(false);
    expect(needsFreshLine("task", false)).toBe(false);
  });

  it("never moves a conversion off the line it is meant to convert", () => {
    // "/heading 1" on a written line MEANS "make this line a heading".
    // A fresh empty heading below, with the sentence left as a paragraph,
    // is the same surprise in the opposite direction.
    expect(needsFreshLine("heading 1", true)).toBe(false);
    expect(needsFreshLine("text", true)).toBe(false);
    expect(needsFreshLine("strikethrough", true)).toBe(false);
    expect(needsFreshLine("code", true)).toBe(false);
  });

  it("classifies every command the slash menu actually offers", () => {
    // The guard that keeps the two sets honest: a command added to
    // commandItems and to neither set would silently default to
    // in-place, which is the old destructive behaviour returning by
    // omission rather than by decision.
    const unclassified = commandItems
      .map((c) => c.title)
      .filter((t) => !BLOCK_COMMANDS.has(t) && !IN_PLACE_COMMANDS.has(t));
    expect(unclassified).toEqual([]);
  });

  it("puts no command in both sets", () => {
    const both = [...BLOCK_COMMANDS].filter((t) => IN_PLACE_COMMANDS.has(t));
    expect(both).toEqual([]);
  });
});

describe("needsLeadingParagraph", () => {
  it("parks no paragraph above a block the user can escape through its title", () => {
    // The reported bug: making the first block on a blank page left an
    // empty line above it — "it gets inserted one line below the current
    // one". These blocks reach the top of the document through their own
    // title slot, which creates the paragraph on demand instead.
    for (const t of ["list", "blockquote", "qaBlock", "recipeBlock", "decisionBlock", "codeBlock"]) {
      expect(needsLeadingParagraph(t)).toBe(false);
    }
  });

  it("parks none above a table either — Task 1 gave it a title slot that escapes upward", () => {
    // This assertion used to read `true`, on the premise that a table's DOM
    // contract fights NodeView wrapping so it has no title slot and no way
    // out of the top. Task 1 falsified that premise: ShellTableView renders
    // a real INPUT.board-title-slot, and ArrowUp from it runs the same
    // moveCursorBeforeBlock that creates the paragraph on demand. Measured
    // in a live editor: doc ["table"] → ArrowUp from the title →
    // ["paragraph","table"], cursor in the new paragraph.
    //
    // Parking one anyway cost two bugs at once: the stray empty line above
    // every /table on a blank page, and a dead title focus — the parked
    // paragraph swallowed the selection, so armPendingTitleFocus's
    // "which top-level node holds the cursor" walk resolved to the
    // paragraph instead of the table and never armed.
    expect(needsLeadingParagraph("table")).toBe(false);
  });

  it("needs nothing above a node the cursor can already sit in", () => {
    expect(needsLeadingParagraph("paragraph")).toBe(false);
    expect(needsLeadingParagraph("heading")).toBe(false);
  });

  it("defaults to parking one for an unknown block type", () => {
    // Fail safe: an unrecognised first node is assumed to have no escape,
    // because the failure mode of guessing wrong the other way is a
    // document whose top the user cannot reach.
    expect(needsLeadingParagraph("chart")).toBe(true);
    expect(needsLeadingParagraph("horizontalRule")).toBe(true);
    expect(needsLeadingParagraph("somethingNew")).toBe(true);
  });

  it("lists no text-bearing type as needing a title escape", () => {
    expect(TITLE_ESCAPE_TYPES.has("paragraph")).toBe(false);
    expect(TITLE_ESCAPE_TYPES.has("heading")).toBe(false);
  });
});
