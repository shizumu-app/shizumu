<!--
  DatePopover - calendar popover for the date filter chip in Memory.

  Anchors to a trigger element via Popover. Renders a preset row
  (today / this week / this month / all), a calendar grid for the
  shown month (with per-cell pin/page density), and a footer with
  the selected date or range plus a clear link.

  Per docs/superpowers/specs/2026-05-17-memory-v0.5-amendment.md
  section Date popover.
-->
<script>
  import Popover from "../../lib/ui/Popover.svelte";
  import SegmentedControl from "../../lib/ui/SegmentedControl.svelte";
  import TriggerChip from "../../lib/ui/TriggerChip.svelte";

  /** @type {{
    anchor: HTMLElement | null,
    open: boolean,
    inline?: boolean,
    filter: { kind: string, date?: string, from?: string, to?: string } | null,
    todayStr: string,
    activityByDate: Record<string, { pages: number, pins: number }>,
    onChange: (filter: { kind: string, date?: string, from?: string, to?: string } | null) => void,
    onClose: () => void,
  }} */
  let { anchor, open, inline = false, filter, todayStr, activityByDate = {}, onChange, onClose } = $props();

  // Which month is shown in the calendar grid.
  // Tracks the month of the currently-selected date (if specific/range);
  // otherwise the current month containing todayStr.
  let shownMonth = $state(monthOf(todayStr));

  $effect(() => {
    if (filter?.kind === "specific" && filter.date) {
      shownMonth = monthOf(filter.date);
    } else if (filter?.kind === "range" && filter.from) {
      shownMonth = monthOf(filter.from);
    }
  });

  let dragStart = $state(null); // YYYY-MM-DD when click-drag is active
  let rangeArm = $state(false); // touch path: armed for a two-tap range selection

  function monthOf(isoDate) {
    return isoDate.slice(0, 7); // "YYYY-MM"
  }

  function daysInMonth(monthStr) {
    const [y, m] = monthStr.split("-").map((x) => parseInt(x, 10));
    return new Date(y, m, 0).getDate();
  }

  function firstWeekday(monthStr) {
    // Returns Monday-based weekday (0=Mon, 6=Sun) of the 1st of the month
    const [y, m] = monthStr.split("-").map((x) => parseInt(x, 10));
    const d = new Date(y, m - 1, 1);
    const jsDay = d.getDay(); // 0=Sun..6=Sat
    return (jsDay + 6) % 7;
  }

  // Inline formatter (Svelte 5 has no <script context="module">).
  function formatShort(isoDate) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const [, m, d] = isoDate.split("-");
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]}`;
  }

  let cells = $derived.by(() => {
    const total = daysInMonth(shownMonth);
    const lead = firstWeekday(shownMonth);
    const arr = [];
    for (let i = 0; i < lead; i++) arr.push({ kind: "lead" });
    for (let day = 1; day <= total; day++) {
      const date = `${shownMonth}-${String(day).padStart(2, "0")}`;
      arr.push({ kind: "day", day, date });
    }
    return arr;
  });

  function isToday(date) { return date === todayStr; }

  function isSelected(date) {
    if (filter?.kind === "specific") return filter.date === date;
    if (filter?.kind === "range") return date >= filter.from && date <= filter.to;
    return false;
  }

  function pickPreset(kind) {
    // A preset always wins outright over any in-progress range gesture —
    // otherwise a stale dragStart from an abandoned two-tap arm survives
    // the preset pick, and the next calendar tap silently commits a bogus
    // range instead of starting fresh from the preset.
    rangeArm = false;
    dragStart = null;
    onChange({ kind });
  }

  function pickSpecific(date) {
    onChange({ kind: "specific", date });
  }

  function startDrag(date) {
    if (rangeArm) return; // touch two-tap path owns selection while armed
    dragStart = date;
  }

  function continueDrag(date) {
    if (dragStart == null) return;
    const from = dragStart <= date ? dragStart : date;
    const to = dragStart <= date ? date : dragStart;
    onChange({ kind: "range", from, to });
  }

  function endDrag() {
    if (rangeArm) return; // touch two-tap path owns dragStart; a synthesized
    // mouseup after a tap must not clear it before tapCell's click runs.
    dragStart = null;
  }

  function tapCell(date) {
    if (rangeArm) {
      if (dragStart == null) {
        dragStart = date; // first tap: arm the start
        onChange({ kind: "range", from: date, to: date });
      } else {
        continueDrag(date); // second tap: existing from/to math commits
        dragStart = null;
        rangeArm = false;
      }
      return;
    }
    pickSpecific(date);
  }

  function clear() {
    // Same fix class as pickPreset: clearing must disarm any in-progress
    // range gesture, otherwise a stale dragStart/rangeArm survives and the
    // next calendar tap silently commits a bogus range.
    rangeArm = false;
    dragStart = null;
    onChange(null);
  }

  // Month navigation — step the shownMonth back/forward without
  // changing the filter selection. Lets the user browse older /
  // newer months without first picking a specific date.
  function stepMonth(delta) {
    const [y, m] = shownMonth.split("-").map((x) => parseInt(x, 10));
    const d = new Date(y, m - 1 + delta, 1);
    shownMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  function stepYear(delta) {
    const [y, m] = shownMonth.split("-").map((x) => parseInt(x, 10));
    shownMonth = `${y + delta}-${String(m).padStart(2, "0")}`;
  }
</script>

{#snippet body()}
  <div class="date-popover">
    {#if !inline}
      <div class="section-label">range</div>
    {/if}
    <div class="preset-row">
      <SegmentedControl
        options={[
          { value: "today", label: "today" },
          { value: "thisWeek", label: "this week" },
          { value: "thisMonth", label: "this month" },
          { value: "all", label: "all" },
        ]}
        value={filter?.kind ?? "all"}
        onChange={(v) => pickPreset(v)}
        ariaLabel="date preset"
      />
      <TriggerChip
        label="range"
        active={rangeArm || filter?.kind === "range"}
        onClick={() => { rangeArm = !rangeArm; dragStart = null; }}
        ariaLabel="select a date range"
      />
    </div>

    <div class="month-nav">
      <button type="button" class="nav-btn" onclick={() => stepYear(-1)} aria-label="previous year">«</button>
      <button type="button" class="nav-btn" onclick={() => stepMonth(-1)} aria-label="previous month">‹</button>
      <span class="month-title">{(() => {
        const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
        const [y, m] = shownMonth.split("-").map((x) => parseInt(x, 10));
        return `${months[m - 1]} ${y}`;
      })()}</span>
      <button type="button" class="nav-btn" onclick={() => stepMonth(1)} aria-label="next month">›</button>
      <button type="button" class="nav-btn" onclick={() => stepYear(1)} aria-label="next year">»</button>
    </div>
    <div class="calendar">
      {#each ["m","t","w","t","f","s","s"] as h, i (i)}
        <div class="cal-head">{h}</div>
      {/each}
      {#each cells as c, i (i)}
        {#if c.kind === "lead"}
          <div class="cal-cell faded"></div>
        {:else}
          {@const activity = activityByDate[c.date] || { pages: 0, pins: 0 }}
          <button
            type="button"
            class="cal-cell"
            class:has-pages={activity.pages > 0}
            class:has-pins={activity.pins > 0}
            class:today={isToday(c.date)}
            class:selected={isSelected(c.date)}
            onmousedown={() => startDrag(c.date)}
            onmouseenter={() => continueDrag(c.date)}
            onmouseup={endDrag}
            onclick={() => tapCell(c.date)}
          >{c.day}</button>
        {/if}
      {/each}
    </div>

    {#if filter?.kind === "specific" || filter?.kind === "range"}
      <div class="footer">
        <span class="selected-label">
          {#if filter.kind === "specific"}
            selected: {formatShort(filter.date)}
          {:else}
            {formatShort(filter.from)} to {formatShort(filter.to)}
          {/if}
        </span>
        <button type="button" class="clear" onclick={clear}>clear</button>
      </div>
    {/if}
  </div>
{/snippet}

{#if open && inline}
  {@render body()}
{:else if open}
  <Popover anchor={anchor} open onClose={onClose} placement="bottom-end">
    {@render body()}
  </Popover>
{/if}

<style>
  .date-popover {
    /* min-width, not width. At a fixed 14rem this was narrower than the
       preset SegmentedControl it contains — four options (today / this week /
       this month / all) form one indivisible row needing ~18rem, so the panel
       clipped and grew a horizontal scrollbar: the calendar and the "all"
       preset were both cut off. .preset-row wraps, but a segmented control
       can't wrap inside itself. A floor keeps the narrow-content case looking
       the same; the content sets the width when it needs more. */
    min-width: 14rem;
    font-family: "Inter", sans-serif;
    padding: 0.5rem;
  }
  .section-label {
    font-size: 0.5625rem;
    letter-spacing: 0.04em;
    opacity: 0.35;
    text-transform: lowercase;
    margin-bottom: 0.375rem;
  }
  .preset-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.625rem;
  }
  .month-nav {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin: 0.375rem 0 0.5rem;
  }
  .month-title {
    flex: 1;
    text-align: center;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.75;
  }
  .nav-btn {
    appearance: none;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--ink);
    opacity: 0.55;
    font-size: 1rem;
    line-height: 1;
    padding: 0.25rem 0.375rem;
    border-radius: 0.25rem;
  }
  .nav-btn:hover { opacity: 1; background: color-mix(in srgb, var(--ink) 6%, transparent); }

  .calendar {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.0625rem;
    font-size: 0.625rem;
  }
  .cal-head {
    font-family: "DM Mono", monospace;
    font-size: 0.5rem;
    opacity: 0.35;
    text-align: center;
    padding-bottom: 0.125rem;
  }
  .cal-cell {
    appearance: none;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: center;
    padding: 0.25rem 0;
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
    color: color-mix(in srgb, var(--ink) 75%, transparent);
    border-radius: 50%;
  }
  .cal-cell.faded { opacity: 0; pointer-events: none; }
  .cal-cell:hover {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .cal-cell.has-pages {
    color: var(--ink);
    font-weight: 500;
  }
  .cal-cell.has-pins {
    color: var(--warm-accent);
    font-weight: 500;
  }
  .cal-cell.today {
    box-shadow: 0 0 0 1px var(--warm-accent) inset;
  }
  .cal-cell.selected {
    background: var(--warm-accent);
    color: var(--canvas-bg);
    box-shadow: none;
  }
  .footer {
    margin-top: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.5625rem;
  }
  .selected-label {
    opacity: 0.55;
  }
  .clear {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--warm-accent);
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }

  /* Phone: when rendered inline inside a BottomSheet the popover has
     room to breathe. Bump everything to comfy touch-sized cells. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .date-popover {
      width: 100%;
      padding: 0;
    }
    .section-label {
      font-size: 0.75rem;
      margin-bottom: 0.5rem;
      opacity: 0.55;
    }
    .preset-row {
      gap: 0.375rem;
      margin-bottom: 1rem;
    }
    .calendar {
      gap: 0.25rem;
      font-size: 0.875rem;
    }
    .cal-head {
      font-size: 0.75rem;
      padding-bottom: 0.5rem;
      opacity: 0.55;
    }
    .month-nav {
      margin: 0.5rem 0 0.75rem;
      gap: 0.5rem;
    }
    .month-title {
      font-size: 1rem;
    }
    .nav-btn {
      font-size: 1.25rem;
      min-width: 2.5rem;
      min-height: 2.5rem;
      padding: 0.5rem;
    }
    .cal-cell {
      font-size: 0.875rem;
      min-height: 2.5rem;
      padding: 0.5rem 0;
      border-radius: 0.5rem;
    }
    .cal-cell.today {
      box-shadow: 0 0 0 1.5px var(--warm-accent) inset;
    }
    .footer {
      margin-top: 1rem;
      font-size: 0.875rem;
      padding-top: 0.75rem;
      border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    }
    .clear {
      font-size: 0.875rem;
      padding: 0.5rem 0.75rem;
    }
  }
</style>
