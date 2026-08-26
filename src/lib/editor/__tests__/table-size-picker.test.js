import { describe, it, expect } from "vitest";
import {
  clampTableSize,
  gridCellsFor,
  moveHover,
  DEFAULT_HOVER,
  GRID_SIZE,
} from "../table-size-picker.js";

describe("clampTableSize", () => {
  it("clamps rows below the 2-row floor up to 2 (withHeaderRow:true makes rows:1 header-only)", () => {
    expect(clampTableSize({ rows: 1, cols: 3 })).toEqual({ rows: 2, cols: 3 });
    expect(clampTableSize({ rows: 0, cols: 3 })).toEqual({ rows: 2, cols: 3 });
    expect(clampTableSize({ rows: -5, cols: 3 })).toEqual({ rows: 2, cols: 3 });
  });

  it("clamps cols below the 1-col floor up to 1", () => {
    expect(clampTableSize({ rows: 4, cols: 0 })).toEqual({ rows: 4, cols: 1 });
    expect(clampTableSize({ rows: 4, cols: -2 })).toEqual({ rows: 4, cols: 1 });
  });

  it("clamps values above the 6×6 grid ceiling down to 6", () => {
    expect(clampTableSize({ rows: 7, cols: 9 })).toEqual({ rows: 6, cols: 6 });
    expect(clampTableSize({ rows: 100, cols: 100 })).toEqual({ rows: 6, cols: 6 });
  });

  it("leaves an already-legal size untouched", () => {
    expect(clampTableSize({ rows: 4, cols: 2 })).toEqual({ rows: 4, cols: 2 });
    expect(clampTableSize({ rows: 2, cols: 1 })).toEqual({ rows: 2, cols: 1 });
    expect(clampTableSize({ rows: 6, cols: 6 })).toEqual({ rows: 6, cols: 6 });
  });
});

describe("gridCellsFor (hover -> size mapping)", () => {
  it("maps a 0-based grid cell to a 1-based rows/cols size", () => {
    // (row: 3, col: 1) -> 4 rows tall, 2 cols wide.
    expect(gridCellsFor({ row: 3, col: 1 })).toEqual({ rows: 4, cols: 2 });
  });

  it("maps the grid's bottom-right cell to the 6×6 ceiling", () => {
    expect(gridCellsFor({ row: GRID_SIZE - 1, col: GRID_SIZE - 1 })).toEqual({ rows: 6, cols: 6 });
  });

  it("snaps the grid's top row (row: 0, naively '1 row') up to the 2-row floor", () => {
    // This IS the product decision from the brief, not an oversight: with
    // withHeaderRow:true a 1-row table has no body row, so hovering the
    // grid's first row must still resolve to a 2-row table rather than
    // being a dead/unselectable row.
    expect(gridCellsFor({ row: 0, col: 2 })).toEqual({ rows: 2, cols: 3 });
  });

  it("resolves a missing hover (grid just mounted) to the smallest legal size instead of throwing", () => {
    expect(gridCellsFor(null)).toEqual({ rows: 2, cols: 1 });
    expect(gridCellsFor(undefined)).toEqual({ rows: 2, cols: 1 });
  });

  it("the default hover reproduces /table's old hardcoded 3×3", () => {
    expect(gridCellsFor(DEFAULT_HOVER)).toEqual({ rows: 3, cols: 3 });
  });
});

describe("moveHover (arrow-key navigation)", () => {
  it("moves one cell per arrow key", () => {
    expect(moveHover({ row: 2, col: 2 }, "ArrowUp")).toEqual({ row: 1, col: 2 });
    expect(moveHover({ row: 2, col: 2 }, "ArrowDown")).toEqual({ row: 3, col: 2 });
    expect(moveHover({ row: 2, col: 2 }, "ArrowLeft")).toEqual({ row: 2, col: 1 });
    expect(moveHover({ row: 2, col: 2 }, "ArrowRight")).toEqual({ row: 2, col: 3 });
  });

  it("clamps at the grid's edges instead of going out of range", () => {
    expect(moveHover({ row: 0, col: 0 }, "ArrowUp")).toEqual({ row: 0, col: 0 });
    expect(moveHover({ row: 0, col: 0 }, "ArrowLeft")).toEqual({ row: 0, col: 0 });
    const last = GRID_SIZE - 1;
    expect(moveHover({ row: last, col: last }, "ArrowDown")).toEqual({ row: last, col: last });
    expect(moveHover({ row: last, col: last }, "ArrowRight")).toEqual({ row: last, col: last });
  });

  it("an unrecognized key leaves the hover cell unchanged (not a bug: Enter/Escape/etc. are handled by the caller, not by grid movement)", () => {
    expect(moveHover({ row: 2, col: 2 }, "Enter")).toEqual({ row: 2, col: 2 });
    expect(moveHover({ row: 2, col: 2 }, "Escape")).toEqual({ row: 2, col: 2 });
  });

  it("defaults a missing hover to the top-left cell before applying the move", () => {
    expect(moveHover(null, "ArrowDown")).toEqual({ row: 1, col: 0 });
  });
});
