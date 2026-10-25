<!--
  /table's row×col size grid, for a thumb.

  The desktop's picker is `renderTableSizeGrid` (slash-commands.js:642) —
  imperative DOM built to replace the slash menu's item list INSIDE the
  same floating node. None of that is ported. What is ported is its
  DECISIONS, and they all already live in a pure module
  (`lib/editor/table-size-picker.js`), which is why this file imports the
  numbers rather than restating them:

    · a fixed 6×6 grid, read cols-across / rows-down;
    · cell (row, col) means "row+1 rows by col+1 cols";
    · the top row SNAPS to two rows rather than being dead, because
      insertTable with withHeaderRow:true turns rows:1 into a header with
      no body (clampTableSize is the floor);
    · the reading is "{cols} × {rows}", in that order.

  The default cell and the arrow-key movement are decisions too, and both
  stay with the host: `moveHover` is for a keyboard the phone does not
  have, and the default is the host's to reset each time the sheet opens
  (see ShellApp's tableCell).

  ── WHAT A THUMB CHANGES ───────────────────────────────────────────────
  Two things, and the second is the one that is easy to miss.

  NO HOVER. The desktop previews on `pointerenter`, which a real tap never
  fires, so on a coarse pointer its grid has no preview step at all and
  `onclick` commits directly. That is the right fallback for a popover
  with no room for anything else. It is the wrong one here, because of:

  THE THUMB COVERS THE CELL IT IS ON. A 44px cell is smaller than the
  fingertip pressing it, so at the moment of commit the writer cannot see
  the thing they are committing to — and the snap makes that worse, since
  the top row commits a size (2 rows) that is not the one the finger is
  pointing at. A direct commit here would be a blind commit. So the tap
  SELECTS and the host's `insert` row commits: two taps, and the size is
  legible between them.

  THE READOUT SITS ABOVE THE GRID, not below it as on the desktop. A hand
  reaching a phone comes from the bottom, so everything below the touched
  cell is behind the hand and everything above it is not. The caption is
  the one thing that must stay visible while a thumb is on the grid, so it
  goes where a thumb cannot be.

  ── HOW MANY COLUMNS FIT ───────────────────────────────────────────────
  All six. The frame is 412px and Sheet's content padding is --space-4 a
  side, which is 14px at the phone's --ui-scale (0.875) — so the grid gets
  384px. Six cells at the --tap floor (44px) plus five --space-1 gaps
  (3.5px) is 281.5px. The desktop's grid therefore transfers whole: nothing
  is truncated, nothing scrolls sideways, and the spare 100px is spent on
  the cells rather than on a seventh column the size module does not offer
  — `minmax(var(--tap), 1fr)` lets each cell settle around 61px, half again
  over the floor. Rows are square by aspect-ratio, so six of them are
  ~366px, which a full detent (0.92 of the frame height) has room for
  alongside the caption and the commit row.

  ── STATE LIVES IN THE HOST ────────────────────────────────────────────
  `cell` comes down and `onPick` goes up. The host needs the chosen size
  anyway (its `insert` row is labelled with it, and it is what the slash
  command is called with), and a copy here would be a second answer to the
  same question — the drift class this workstream keeps catching. This
  file renders a cell and reports a tap.
-->
<script>
  import { GRID_SIZE, gridCellsFor } from "../../lib/editor/table-size-picker.js";

  /** @type {{
    cell: { row: number, col: number },
    onPick: (cell: { row: number, col: number }) => void,
  }} */
  let { cell, onPick } = $props();

  // The clamped size the current cell commits — the same function the
  // desktop paints from and the same one the host inserts with.
  const size = $derived(gridCellsFor(cell));

  const indices = Array.from({ length: GRID_SIZE }, (_, i) => i);

  function inRange(row, col) {
    return row < size.rows && col < size.cols;
  }

  // The size THIS cell would commit, clamped the same way, so a screen
  // reader hears the snapped value on the top row rather than the
  // un-clamped "by 1" the coordinates would suggest.
  function cellLabel(row, col) {
    const own = gridCellsFor({ row, col });
    return `${own.cols} by ${own.rows}`;
  }
</script>

<div class="shell-table-grid">
  <!-- aria-live so the reading is announced as the selection moves; it is
       also the only readout a sighted writer can see past their own hand. -->
  <div class="shell-table-grid-caption" aria-live="polite">{size.cols} × {size.rows}</div>

  <!-- A conforming grid needs a "row" layer between "grid" and "gridcell",
       and this is one flat CSS grid of 36 buttons rather than six wrapper
       divs the layout does not otherwise need. So the outer carries "grid"
       and the flat container stands in as its one row — the same reading
       renderTableSizeGrid's own comment records. -->
  <div
    class="shell-table-grid-cells-outer"
    role="grid"
    aria-label="table size"
    style="--grid-size: {GRID_SIZE}"
  >
    <div class="shell-table-grid-cells" role="row">
      {#each indices as row (row)}
        {#each indices as col (col)}
          <button
            type="button"
            class="shell-table-grid-cell"
            class:in-range={inRange(row, col)}
            role="gridcell"
            aria-selected={inRange(row, col)}
            aria-label={cellLabel(row, col)}
            data-row={row}
            data-col={col}
            onclick={() => onPick({ row, col })}
          ></button>
        {/each}
      {/each}
    </div>
  </div>
</div>

<style>
  .shell-table-grid-caption {
    padding: var(--space-2) 0 var(--space-3);
    color: var(--ink-soft);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    text-align: center;
  }

  /* --grid-size is written inline from GRID_SIZE (see the markup) rather
     than restated as a literal 6 here, for Sheet's --detent-fraction
     reason: a number the CSS and the JS both hardcode is a number they can
     drift on.

     minmax(var(--tap), 1fr) is the floor and the stretch in one
     declaration — --tap is max(--touch-target, 44px), so the cells cannot
     fall under the shell's 44px minimum however narrow the frame gets, and
     they take the slack when it is wider. Below ~282px of content width
     six columns stop fitting and this grid would overflow its container
     rather than reflow; no phone the shell targets is close (see the
     header's arithmetic), and reflowing would be wrong anyway — the
     columns ARE the sizes on offer. */
  .shell-table-grid-cells {
    display: grid;
    grid-template-columns: repeat(var(--grid-size, 6), minmax(var(--tap), 1fr));
    gap: var(--space-1);
  }

  .shell-table-grid-cell {
    min-width: var(--tap);
    min-height: var(--tap);
    aspect-ratio: 1;
    padding: 0;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sm);
    transition: background var(--motion-fast), border-color var(--motion-fast);
  }

  .shell-table-grid-cell.in-range {
    background: var(--warm-accent-soft);
    border-color: var(--warm-accent);
  }

  .shell-table-grid-cell:focus-visible {
    outline: 2px solid var(--warm-accent);
    outline-offset: -2px;
  }
</style>
