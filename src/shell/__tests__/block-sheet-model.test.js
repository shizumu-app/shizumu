import { describe, it, expect } from "vitest";
import { blockSheetRows, BLOCK_ACTION_LABELS } from "../block-sheet-model.js";

// Deliberately NOT a re-test of blockActionsFor. Its own suite
// (src/lib/editor/__tests__/block-actions.test.js) already pins every gate
// and the relative order of its six ids. What is untested until here is the
// shell's part: the two rows it adds, where they land relative to the shared
// ones, and the label every row carries.

const ids = (rows) => rows.map((r) => r.id);
const labels = (rows) => rows.map((r) => r.label);

// The five fields readActiveBlock actually emits (editor-snapshot.js), so a
// fixture cannot drift into a shape the producer never hands us. `isTitled`
// is one of them and is NOT the `title` row's gate — that is `hasTitleSlot`,
// a DOM fact the snapshot cannot see and the CALLER supplies, which is why
// it is an argument to blockSheetRows rather than a field here.
const block = (over = {}) => ({
  type: "paragraph",
  pos: 4,
  isBoard: false,
  isTitled: false,
  isEmpty: false,
  ...over,
});

describe("blockSheetRows — a paragraph with text", () => {
  it("offers pin, copy, move up, move down, delete — in that order", () => {
    const rows = blockSheetRows({
      activeBlock: block(),
      canPin: true,
      convertTargets: [],
    });
    expect(ids(rows)).toEqual(["pin", "copy", "move-up", "move-down", "delete"]);
    expect(labels(rows)).toEqual(["pin", "copy", "move up", "move down", "delete"]);
  });
});

describe("blockSheetRows — an empty paragraph", () => {
  it("offers insert below, then the two moves, and no delete row", () => {
    // blockActionsFor gives an empty non-board paragraph exactly
    // ["insert-below"]: nothing to pin or copy, and deleting an empty
    // paragraph is not the board-delete the id means (its own suite says
    // so). With no delete to sit ahead of, the moves land at the end —
    // this is the branch that proves the insertion point is "before
    // delete, or last", not a fixed index.
    const rows = blockSheetRows({
      activeBlock: block({ isEmpty: true }),
      canPin: false,
      convertTargets: [],
    });
    expect(ids(rows)).toEqual(["insert-below", "move-up", "move-down"]);
    expect(ids(rows)).not.toContain("delete");
  });
});

describe("blockSheetRows — a filled board with a title slot, convertible", () => {
  it("offers pin, copy, title, turn into, move up, move down, delete — in that order", () => {
    const rows = blockSheetRows({
      activeBlock: block({ type: "list", isBoard: true }),
      canPin: true,
      hasTitleSlot: true,
      convertTargets: ["paragraphs", "blockquote"],
    });
    expect(ids(rows)).toEqual([
      "pin", "copy", "title", "convert", "move-up", "move-down", "delete",
    ]);
    expect(labels(rows)).toEqual([
      "pin", "copy", "title", "turn into", "move up", "move down", "delete",
    ]);
  });

  it("names the convert row 'turn into', not the desktop's 'convert to…'", () => {
    // §3 names this row. The desktop's own label is "convert to…" and stays
    // that way — the shared map is a file this branch may not edit — so the
    // override lives in BLOCK_ACTION_LABELS here and this asserts it rather
    // than leaving a silent divergence to be discovered in a screenshot.
    expect(BLOCK_ACTION_LABELS.convert).toBe("turn into");
  });
});

describe("blockSheetRows — a block that cannot be pinned", () => {
  it("drops pin and copy but keeps title, the moves and delete", () => {
    // An empty board (a list with no items): mayPinBlock refuses it for
    // want of text, and copy is gated on the same fact upstream. The board
    // itself still exists, so it can be titled, moved and deleted.
    const rows = blockSheetRows({
      activeBlock: block({ type: "list", isBoard: true }),
      canPin: false,
      hasTitleSlot: true,
      convertTargets: [],
    });
    expect(ids(rows)).toEqual(["title", "move-up", "move-down", "delete"]);
  });
});

describe("blockSheetRows — a board with no conversion targets", () => {
  it("omits the turn-into row entirely", () => {
    // A table: block-convert.js refuses it, so convertTargetsFor returns [].
    // An offered row that no-oped on tap is the defect convertTargetsFor's
    // lookahead exists to prevent; an empty target list has to mean absent.
    //
    // hasTitleSlot IS true here, because a table renders a real `<input>`
    // slot (ShellTableView, Plan 1c) — so `title` appears and `convert`
    // does not, from the same block. Two independent gates on one row list,
    // which a fixture that switched both off at once could not show.
    const rows = blockSheetRows({
      activeBlock: block({ type: "table", isBoard: true }),
      canPin: true,
      hasTitleSlot: true,
      convertTargets: [],
    });
    expect(ids(rows)).toEqual(["pin", "copy", "title", "move-up", "move-down", "delete"]);
    expect(ids(rows)).not.toContain("convert");
  });
});

describe("blockSheetRows — no active block", () => {
  it("offers nothing, because there is no block for a sheet to be about", () => {
    // Not "the gates all defaulted closed": the moves are offered for ANY
    // block, so an empty result here is only correct because there is no
    // block at all. readActiveBlock returns null with the caret outside any
    // top-level node, and the handle that opens this sheet does not render
    // then either (Task 2) — so a sheet with rows here would be a sheet
    // about nothing.
    expect(blockSheetRows({ activeBlock: null, canPin: true, convertTargets: ["paragraphs"] }))
      .toEqual([]);
    expect(blockSheetRows({})).toEqual([]);
    expect(blockSheetRows()).toEqual([]);
  });
});

describe("blockSheetRows — every row carries copy", () => {
  it("labels every id it can ever emit", () => {
    // Exercising every gate at once is not a real block shape (an
    // insertable empty paragraph is never also a filled board) but it is
    // the only way to see all eight ids in one list.
    const rows = blockSheetRows({
      activeBlock: block({ type: "list", isBoard: true, isEmpty: true }),
      canPin: true,
      hasTitleSlot: true,
      convertTargets: ["paragraphs"],
    });
    expect(ids(rows)).toEqual([
      "pin", "copy", "title", "convert", "insert-below", "move-up", "move-down", "delete",
    ]);
    for (const row of rows) expect(BLOCK_ACTION_LABELS[row.id]).toBeTruthy();
  });

  it("keeps every label lowercase and clear of the retired word", () => {
    // The map spreads the shared one, so a label added on `main` arrives
    // here at the next merge without passing through this file. `sink` and
    // its forms are retired from user-facing strings as of 2026-08-27 and
    // `npm run check:copy` does not exist in this tree yet, so this is the
    // only thing standing between an upstream label and the phone's sheet.
    for (const label of Object.values(BLOCK_ACTION_LABELS)) {
      expect(label).toBe(label.toLowerCase());
      expect(label).not.toMatch(/\bsink(s|ing)?\b|\bsunk\b/);
    }
  });
});
