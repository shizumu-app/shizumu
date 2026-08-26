// table-size-picker.js — the size decisions behind /table's row×col grid
// (Task 3). Kept pure and DOM-free per CLAUDE.md's testing rule: the DOM
// rendering of the grid lives beside renderItems in slash-commands.js
// (renderTableSizeGrid); this module only decides numbers, so those
// decisions are unit-testable without a mounted menu or a real editor.
//
// The grid is a fixed 6×6, rendered cols-across / rows-down. A cell at
// (row, col) — both 0-based — means "hovering/picking this cell selects a
// table (row+1) rows by (col+1) cols." clampTableSize is the one place
// that enforces the product's floor: TipTap's insertTable with
// withHeaderRow:true turns rows:1 into a header-only table with no body
// row, so rows must never go below 2. The grid's own top row (row index 0,
// which would naively mean "1 row") therefore SNAPS to 2 rows rather than
// being made unselectable — one uniform, always-clickable 6×6 grid is
// simpler to build and to hit on a touch screen than a grid with a dead
// first row, and the live "{cols} × {rows}" caption already tells the user
// what they're about to get before they commit.

export const GRID_SIZE = 6;
export const MIN_ROWS = 2;
export const MIN_COLS = 1;
export const MAX_SIZE = 6;

// The hover cell a freshly-opened grid starts on, matching the size /table
// hardcoded before this task (3 rows × 3 cols) — so an immediate Enter
// with no arrow-key or pointer movement reproduces the old default.
export const DEFAULT_HOVER = { row: 2, col: 2 };

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * clampTableSize({rows, cols}) -> {rows, cols}
 * rows clamped to [MIN_ROWS, MAX_SIZE], cols clamped to [MIN_COLS, MAX_SIZE].
 */
export function clampTableSize({ rows, cols }) {
  return {
    rows: clamp(rows, MIN_ROWS, MAX_SIZE),
    cols: clamp(cols, MIN_COLS, MAX_SIZE),
  };
}

/**
 * gridCellsFor(hover) -> {rows, cols}
 *
 * hover: {row, col}, both 0-based indices into the 6×6 grid (row 0 = the
 * grid's top row, col 0 = its leftmost column). Hovering or picking cell
 * (row, col) means "rows: row+1, cols: col+1", then clamped — so the
 * grid's top row (row: 0) snaps to MIN_ROWS instead of producing the
 * header-only 1-row table insertTable can't render sanely.
 *
 * A missing/null hover (grid just mounted, nothing moved yet) resolves to
 * the smallest legal size rather than throwing.
 */
export function gridCellsFor(hover) {
  if (!hover) return clampTableSize({ rows: MIN_ROWS, cols: MIN_COLS });
  return clampTableSize({ rows: hover.row + 1, cols: hover.col + 1 });
}

/**
 * moveHover(hover, key) -> {row, col}
 *
 * Arrow-key navigation within the 6×6 grid, clamped to its bounds so
 * holding an arrow key at an edge just stops rather than wrapping or
 * going out of range. Any other key returns hover unchanged.
 */
export function moveHover(hover, key) {
  const h = hover || { row: 0, col: 0 };
  const last = GRID_SIZE - 1;
  switch (key) {
    case "ArrowUp":
      return { row: clamp(h.row - 1, 0, last), col: h.col };
    case "ArrowDown":
      return { row: clamp(h.row + 1, 0, last), col: h.col };
    case "ArrowLeft":
      return { row: h.row, col: clamp(h.col - 1, 0, last) };
    case "ArrowRight":
      return { row: h.row, col: clamp(h.col + 1, 0, last) };
    default:
      return h;
  }
}
