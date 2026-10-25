<!--
  A month, to pick a day from.

  The fourth device pass asked for the desktop's date picker in two
  places: memory's filters ("the filters does not show date picker
  similar to desktop") and the page's day sheet ("also in the today").
  Both get this one, because they are the same question — which day —
  and the only thing that differs is what a day means when it is tapped.

  ── THE MONTH IS THE CALLER'S ─────────────────────────────────────────

  `month` comes in and `onMonth` goes out; this component holds no state
  at all. Two sheets can then open on the month that matters to each of
  them — the selected day's for a filter, today's for the day sheet —
  and a sheet that closes and reopens does not come back on whatever
  month the writer last paged to somewhere else.

  ── WHAT A DAY WITH NO WRITING DOES ───────────────────────────────────

  `markedOnly` is the difference between the two callers, and it is a
  real one rather than a style. In memory a filter may name a day that
  has nothing on it: the answer is an empty list, which is an answer. On
  the page's day sheet a day with no page has nothing to open — the
  sheet's rows are the days that HAVE pages — so an unmarked day is
  inert there rather than a tap that does nothing. A control that cannot
  act is not drawn as one (the shell's rule since P2d); here it stays
  legible, because a calendar with holes in it is unreadable, and says
  what it is by being unpressable.

  TODAY IS ALWAYS PRESSABLE, even unmarked and even under `markedOnly`:
  the day sheet's first row is today whether or not a page exists yet,
  because `getOrCreateToday` makes one. The grid must not be the one
  surface that refuses it.

  ── THE MARK ──────────────────────────────────────────────────────────

  A dot under the number, in the accent the timeline's day dots use
  (MemoryScreen's spine) — the same mark for the same fact,
  "there is writing here". The selected day takes a filled disc behind
  the number, and today a ring: three states a writer can tell apart at
  a glance without reading, which a calendar has to be.

  ── THE BUTTONS ───────────────────────────────────────────────────────

  Raw `<button>`s, which is why this file is on the rules test's
  PRIMITIVE_BUTTON_FILES: a day is a control, forty-two of them in a
  grid, and a Row each would be forty-two 44px stripes. Each cell is one
  tap target at `var(--tap)`; seven of those fit a 360px phone with the
  band's inset to spare.

  The month arrows act on `click` rather than `pointerdown`: they are
  not editor chrome and nothing here has a selection to preserve, so the
  plain thing is right (ToolbarButton's header draws that line).
-->
<script>
  import { monthGrid, monthLabel, shiftMonth, WEEKDAYS } from "../calendar-month.js";

  /** @type {{
    month: string,
    today?: string,
    marked?: string[] | Set<string>,
    selected?: string | null,
    markedOnly?: boolean,
    label?: string,
    onMonth?: ((month: string) => void) | null,
    onPick?: ((date: string) => void) | null,
  }} */
  let {
    month,
    today = "",
    marked = [],
    selected = null,
    markedOnly = false,
    label = "pick a day",
    onMonth = null,
    onPick = null,
  } = $props();

  const weeks = $derived(monthGrid({ month, today, marked, selected }));
  const heading = $derived(monthLabel(month));

  const pressable = (cell) => !markedOnly || cell.marked || cell.today;

  function step(delta) {
    const next = shiftMonth(month, delta);
    if (next) onMonth?.(next);
  }
</script>

<section class="shell-calendar" aria-label={label}>
  <div class="shell-calendar-head">
    <button class="shell-calendar-step" type="button" aria-label="previous month" onclick={() => step(-1)}>‹</button>
    <span class="shell-calendar-month" aria-live="polite">{heading}</span>
    <button class="shell-calendar-step" type="button" aria-label="next month" onclick={() => step(1)}>›</button>
  </div>

  <div class="shell-calendar-week" aria-hidden="true">
    {#each WEEKDAYS as day, i (i)}
      <span class="shell-calendar-weekday">{day}</span>
    {/each}
  </div>

  {#each weeks as week, i (i)}
    <div class="shell-calendar-week">
      {#each week as cell (cell.date)}
        {#if pressable(cell)}
          <button
            class="shell-calendar-day"
            type="button"
            data-date={cell.date}
            data-outside={cell.inMonth ? null : "true"}
            data-marked={cell.marked ? "true" : null}
            data-today={cell.today ? "true" : null}
            aria-pressed={cell.selected}
            onclick={() => onPick?.(cell.date)}
          >
            {cell.day}
          </button>
        {:else}
          <span
            class="shell-calendar-day"
            data-date={cell.date}
            data-outside={cell.inMonth ? null : "true"}
            data-empty="true"
          >{cell.day}</span>
        {/if}
      {/each}
    </div>
  {/each}
</section>

<style>
  .shell-calendar {
    padding: 0 var(--space-4) var(--space-2);
  }

  .shell-calendar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .shell-calendar-month {
    flex: 1 1 auto;
    text-align: center;
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  .shell-calendar-step {
    flex: 0 0 auto;
    min-width: var(--tap);
    min-height: var(--tap);
    padding: 0;
    background: none;
    border: none;
    color: var(--ink-soft);
    font-family: var(--font-ui);
    font-size: var(--text-lg);
    line-height: 1;
    cursor: pointer;
  }

  /* Seven equal columns. `minmax(0, 1fr)` rather than `1fr`: a grid
     column's default minimum is its content, which a two-digit day in a
     scaled font can push past a narrow phone's band. */
  .shell-calendar-week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .shell-calendar-weekday {
    padding: var(--space-1) 0;
    color: var(--ink-soft);
    text-align: center;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    line-height: var(--leading-xs);
    opacity: var(--ink-secondary);
  }

  /* The cell is the tap target — one --tap high, the floor every control
     in this tree is measured against. The number sits in the middle and
     the marks are drawn around it (below), so nothing in the cell moves
     between states. */
  .shell-calendar-day {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--tap);
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--radius-md);
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    cursor: pointer;
  }

  /* Last month's and next month's days: still there, still tappable,
     drawn back so the month the writer is reading is the one that reads
     as present. */
  .shell-calendar-day[data-outside="true"] {
    color: var(--ink-soft);
    opacity: var(--ink-tertiary);
  }

  /* A day with nothing to open (the day sheet). Legible, and not a
     control: a calendar with holes in it cannot be read. */
  .shell-calendar-day[data-empty="true"] {
    color: var(--ink-soft);
    opacity: var(--ink-tertiary);
    cursor: default;
  }

  /* THE MARK IS THE SPINE'S DOT: writing on this day. Under the number
     rather than behind it, so a marked day that is also selected says
     both things at once. */
  .shell-calendar-day[data-marked="true"]::after {
    content: "";
    position: absolute;
    bottom: 0.375rem;
    width: 0.25rem;
    height: 0.25rem;
    border-radius: 50%;
    background: var(--warm-accent);
  }

  .shell-calendar-day[data-today="true"] {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warm-accent) 45%, transparent);
  }

  .shell-calendar-day[aria-pressed="true"] {
    background: var(--warm-accent);
    color: var(--canvas-bg);
  }

  .shell-calendar-day[aria-pressed="true"]::after {
    background: var(--canvas-bg);
  }
</style>
