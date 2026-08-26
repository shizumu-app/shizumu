// DOM coverage for renderTableSizeGrid (Task 3), matching the precedent
// slash-menu-render.test.js set for testing the plain-DOM slash menu
// directly rather than through the full Suggestion plugin. This is the
// same menuEl node the item list normally occupies — renderTableSizeGrid
// replaces its contents in place, it doesn't stand up a second popover.
import { describe, it, expect, vi } from "vitest";
import { createMenu, renderTableSizeGrid } from "../../slash-commands.js";
import { GRID_SIZE } from "../../editor/table-size-picker.js";

describe("renderTableSizeGrid", () => {
  it("paints the default hover (3×3, matching /table's old hardcoded default) on mount", () => {
    const el = createMenu();
    renderTableSizeGrid(el, {});
    const caption = el.querySelector(".slash-table-grid-caption");
    expect(caption.textContent).toBe("3 × 3");
    const cells = el.querySelectorAll(".slash-table-grid-cell");
    expect(cells.length).toBe(GRID_SIZE * GRID_SIZE);
    const inRange = el.querySelectorAll(".slash-table-grid-cell.in-range");
    expect(inRange.length).toBe(9); // 3 rows x 3 cols
  });

  it("hovering a cell highlights the rectangle from (1,1) to that cell and updates the caption", () => {
    const el = createMenu();
    renderTableSizeGrid(el, {});
    const cell = el.querySelector('.slash-table-grid-cell[data-row="3"][data-col="1"]');
    cell.dispatchEvent(new Event("pointerenter"));
    expect(el.querySelector(".slash-table-grid-caption").textContent).toBe("2 × 4");
    expect(el.querySelectorAll(".slash-table-grid-cell.in-range").length).toBe(8); // 4 rows x 2 cols
    // Every in-range cell is within the 4x2 rectangle, none outside it.
    el.querySelectorAll(".slash-table-grid-cell").forEach((c) => {
      const row = Number(c.dataset.row);
      const col = Number(c.dataset.col);
      const shouldBeInRange = row < 4 && col < 2;
      expect(c.classList.contains("in-range")).toBe(shouldBeInRange);
    });
  });

  it("hovering the grid's top row (row 0) snaps the highlighted size to the 2-row floor, not 1 row", () => {
    const el = createMenu();
    renderTableSizeGrid(el, {});
    const cell = el.querySelector('.slash-table-grid-cell[data-row="0"][data-col="2"]');
    cell.dispatchEvent(new Event("pointerenter"));
    expect(el.querySelector(".slash-table-grid-caption").textContent).toBe("3 × 2");
  });

  it("clicking a cell commits the clamped size for that cell, not raw (row+1, col+1)", () => {
    const el = createMenu();
    const onCommit = vi.fn();
    renderTableSizeGrid(el, { onCommit });
    // row 0 -> naively 1 row, but must commit the clamped 2-row size.
    el.querySelector('.slash-table-grid-cell[data-row="0"][data-col="0"]').click();
    expect(onCommit).toHaveBeenCalledWith({ rows: 2, cols: 1 });
  });

  it("clicking the back affordance calls onBack", () => {
    const el = createMenu();
    const onBack = vi.fn();
    renderTableSizeGrid(el, { onBack });
    el.querySelector(".slash-table-grid-back").click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("the returned controller's moveHover repaints and commit fires onCommit with the current hover", () => {
    const el = createMenu();
    const onCommit = vi.fn();
    const ctrl = renderTableSizeGrid(el, { onCommit, initialHover: { row: 1, col: 1 } });
    expect(el.querySelector(".slash-table-grid-caption").textContent).toBe("2 × 2");

    ctrl.moveHover("ArrowDown");
    expect(el.querySelector(".slash-table-grid-caption").textContent).toBe("2 × 3");

    ctrl.commit();
    expect(onCommit).toHaveBeenCalledWith({ rows: 3, cols: 2 });
  });
});

// Fix round 1: a screen-reader user got 36 unlabeled buttons and never
// heard the live "cols × rows" caption. Assertions here are on attributes
// only (role/aria-label/aria-live), not visual state — the visual
// highlighting is already covered above.
describe("renderTableSizeGrid accessibility (fix round 1)", () => {
  it("the grid container carries role=grid and a lowercase, brand-voice aria-label", () => {
    const el = createMenu();
    renderTableSizeGrid(el, {});
    const grid = el.querySelector('[role="grid"]');
    expect(grid).toBeTruthy();
    expect(grid.getAttribute("aria-label")).toBe("table size");
  });

  it("the cells container (flat CSS grid, no per-visual-row wrappers) carries role=row", () => {
    const el = createMenu();
    renderTableSizeGrid(el, {});
    const grid = el.querySelector('[role="grid"]');
    const row = grid.querySelector('[role="row"]');
    expect(row).toBeTruthy();
    expect(row.classList.contains("slash-table-grid-cells")).toBe(true);
  });

  it("every cell carries role=gridcell and an aria-label naming its own (clamped) coordinates", () => {
    const el = createMenu();
    renderTableSizeGrid(el, {});
    const cells = el.querySelectorAll(".slash-table-grid-cell");
    expect(cells.length).toBe(GRID_SIZE * GRID_SIZE);
    cells.forEach((c) => expect(c.getAttribute("role")).toBe("gridcell"));

    // An ordinary cell reads "cols by rows" for its own coordinates.
    const ordinary = el.querySelector('.slash-table-grid-cell[data-row="3"][data-col="1"]');
    expect(ordinary.getAttribute("aria-label")).toBe("2 by 4");

    // The grid's top row (row: 0) would naively be "1 row" — its label
    // must read the CLAMPED size (2 rows), the same floor the live
    // caption and onCommit both already enforce, not the raw coordinate.
    const topRow = el.querySelector('.slash-table-grid-cell[data-row="0"][data-col="2"]');
    expect(topRow.getAttribute("aria-label")).toBe("3 by 2");
  });

  it("the caption is aria-live=polite, so its reading is announced as the highlight moves", () => {
    const el = createMenu();
    renderTableSizeGrid(el, {});
    const caption = el.querySelector(".slash-table-grid-caption");
    expect(caption.getAttribute("aria-live")).toBe("polite");

    // The announced text tracks the same clamped value the visual caption
    // already showed for the row-0 snap case — not the raw hovered row.
    el.querySelector('.slash-table-grid-cell[data-row="0"][data-col="2"]').dispatchEvent(new Event("pointerenter"));
    expect(caption.textContent).toBe("3 × 2");
  });
});
