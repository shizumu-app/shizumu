import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import TableSizeGrid from "../TableSizeGrid.svelte";
import { GRID_SIZE } from "../../../lib/editor/table-size-picker.js";

afterEach(cleanupAll);

function cells(target) {
  return [...target.querySelectorAll(".shell-table-grid-cell")];
}

function highlighted(target) {
  return cells(target)
    .filter((c) => c.classList.contains("in-range"))
    .map((c) => `${c.dataset.row},${c.dataset.col}`);
}

describe("TableSizeGrid", () => {
  it("offers the whole 6×6 the size module defines", () => {
    // Not 36 as a literal: the count comes from GRID_SIZE, which is the
    // module's number, so a grid that stopped rendering a column would
    // fail here rather than quietly offering fewer sizes than /table does.
    // All six columns fit at 412px — see the component's header for the
    // arithmetic — so there is no truncated-on-phones case to allow for.
    const { target } = render(TableSizeGrid, { cell: { row: 2, col: 2 }, onPick: () => {} });
    expect(cells(target)).toHaveLength(GRID_SIZE * GRID_SIZE);
  });

  it("highlights the rectangle the cell commits, not the cell", () => {
    // The rectangle IS the preview. A desktop grid can afford to lean on
    // the caption because a mouse pointer is 1px wide; here the finger is
    // over the corner cell, so the shape spreading up and left is the part
    // of the feedback that survives being touched.
    const { target } = render(TableSizeGrid, { cell: { row: 1, col: 1 }, onPick: () => {} });
    expect(highlighted(target).sort()).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  });

  it("shows the snapped size, not the coordinates, on the top row", () => {
    // clampTableSize's floor, rendered: cell (0, 0) means "1 row by 1 col"
    // by coordinates and commits 2 rows, because withHeaderRow:true makes
    // rows:1 a header with no body. The highlight and the caption both
    // report what will actually be inserted — the alternative is a grid
    // that lies about its own top row.
    const { target } = render(TableSizeGrid, { cell: { row: 0, col: 0 }, onPick: () => {} });
    expect(target.querySelector(".shell-table-grid-caption").textContent).toBe("1 × 2");
    expect(highlighted(target).sort()).toEqual(["0,0", "1,0"]);
  });

  it("reports the cell it was tapped on and changes nothing itself", () => {
    // Fully controlled: the host holds the cell, because it also needs the
    // size for its `insert` row and two copies of that answer would be two
    // things that can disagree about the snapped top row. So a tap reports
    // and the render does not move until `cell` comes back down.
    const onPick = vi.fn();
    const { target } = render(TableSizeGrid, { cell: { row: 2, col: 2 }, onPick });
    const before = highlighted(target);

    target.querySelector('.shell-table-grid-cell[data-row="4"][data-col="5"]').click();

    expect(onPick).toHaveBeenCalledWith({ row: 4, col: 5 });
    // Unchanged because nothing re-rendered it: this is the controlled
    // contract, not a tap that failed to register — `onPick` above is the
    // evidence the tap landed.
    expect(highlighted(target)).toEqual(before);
  });

  it("names each cell's own size for a screen reader, snapped", () => {
    // A rectangle of highlighted divs says nothing without sight, and the
    // caption only reports where the selection IS. Per-cell labels are how
    // the coordinates are reachable at all — and they carry the clamp too,
    // so the top row announces "by 2" rather than the "by 1" its position
    // implies.
    const { target } = render(TableSizeGrid, { cell: { row: 2, col: 2 }, onPick: () => {} });
    const labelAt = (row, col) =>
      target
        .querySelector(`.shell-table-grid-cell[data-row="${row}"][data-col="${col}"]`)
        .getAttribute("aria-label");

    expect(labelAt(0, 0)).toBe("1 by 2");
    expect(labelAt(3, 4)).toBe("5 by 4");
  });

  it("exposes a grid/row/gridcell tree with the selection marked", () => {
    const { target } = render(TableSizeGrid, { cell: { row: 1, col: 1 }, onPick: () => {} });
    expect(target.querySelector('[role="grid"]')).not.toBeNull();
    // One "row" for the flat CSS grid rather than six wrapper divs the
    // layout does not need — renderTableSizeGrid's own reading, kept so
    // the two grids do not read differently to assistive tech.
    expect(target.querySelectorAll('[role="row"]')).toHaveLength(1);
    expect(target.querySelectorAll('[role="gridcell"]')).toHaveLength(GRID_SIZE * GRID_SIZE);
    expect(
      target.querySelectorAll('[role="gridcell"][aria-selected="true"]'),
    ).toHaveLength(4);
  });
});
