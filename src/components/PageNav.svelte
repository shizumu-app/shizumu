<script>
  import { onMount, onDestroy } from "svelte";
  import { getLocalDateStr, getYesterdayStr } from "../lib/utils.js";
  import { isPhoneViewport, watchPhoneViewport } from "../lib/responsive.js";
  import Popover from "../lib/ui/Popover.svelte";
  import TriggerChip from "../lib/ui/TriggerChip.svelte";
  import Icon from "../lib/ui/Icon.svelte";

  /** @type {{ date: string, pageNumber: number, totalPages: number, onPrev: () => void, onNext: () => void, onDateSelect: (date: string) => void, focuses: Array<{id: string, what_matters_now: string|null, page_number: number, date: string}>, onFocusSelect: (focus: any) => void, earliestDate: string | null, onNewPage?: () => void, canNewPage?: boolean }} */
  let { date, pageNumber, totalPages, onPrev, onNext, onDateSelect = () => {}, focuses = [], onFocusSelect = () => {}, earliestDate = null, onNewPage = () => {}, canNewPage = false, editorial = false } = $props();

  let isPhone = $state(isPhoneViewport());
  $effect(() => {
    const unwatch = watchPhoneViewport((m) => { isPhone = m; });
    return unwatch;
  });

  // MobileActionBar's "pages" button dispatches this event. Anchored
  // through a window event because the bar lives outside PageNav and
  // we don't want to plumb a bindable prop through every page-nav
  // consumer.
  function handleOpenPages() {
    showFocusList = true;
    showCal = false;
  }
  onMount(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("shizumu:open-pages", handleOpenPages);
  });
  onDestroy(() => {
    if (typeof window === "undefined") return;
    window.removeEventListener("shizumu:open-pages", handleOpenPages);
  });

  let showCal = $state(false);
  let showFocusList = $state(false);
  let calYear = $state(2026);
  let calMonth = $state(2);
  let calChipEl = $state(/** @type {HTMLElement | null} */ (null));
  let focusChipEl = $state(/** @type {HTMLElement | null} */ (null));
  let dateTitleEl = $state(/** @type {HTMLElement | null} */ (null));

  function checkIsToday() { return date === getLocalDateStr(); }

  function formatDate(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    // Compare against local-time today/yesterday to match how the backend
    // stores dates (chrono::Local::now()). UTC comparison drifts by a day in
    // non-UTC timezones and used to show "22 apr" when the user was on "today".
    if (dateStr === getLocalDateStr()) return "today";
    if (dateStr === getYesterdayStr()) return "yesterday";
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  function toggleCal() {
    showCal = !showCal;
    showFocusList = false;
    if (showCal) {
      const d = new Date(date + "T12:00:00");
      calYear = d.getFullYear();
      calMonth = d.getMonth();
    }
  }

  function toggleFocusList() {
    showFocusList = !showFocusList;
    showCal = false;
  }

  function prevMonth() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } }
  function nextMonth() {
    const now = new Date();
    const next = new Date(calYear, calMonth + 1, 1);
    if (next > now) return;
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  }

  function selectDay(day) {
    const m = String(calMonth + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    const selected = `${calYear}-${m}-${d}`;
    showCal = false;
    if (selected !== date) onDateSelect(selected);
  }

  function handleKeydown(e) {
    if (e.key === "Escape") { showCal = false; showFocusList = false; }
  }

  function getCalDays() {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = getLocalDateStr();
    const minDate = earliestDate || today; // Can't go before first focus (or today if none)
    const rows = [];
    let row = [];
    for (let i = 0; i < firstDay; i++) row.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const m = String(calMonth + 1).padStart(2, "0");
      const ds = String(d).padStart(2, "0");
      const dateStr = `${calYear}-${m}-${ds}`;
      const isFuture = dateStr > today;
      const isBeforeStart = dateStr < minDate;
      const isDisabled = isFuture || isBeforeStart;
      row.push({ day: d, dateStr, isCurrent: dateStr === date, isToday: dateStr === today, isFuture: isDisabled });
      if (row.length === 7) { rows.push(row); row = []; }
    }
    if (row.length > 0) { while (row.length < 7) row.push(null); rows.push(row); }
    return rows;
  }

  let calRows = $derived(getCalDays());
  const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const dayHeaders = ["su","mo","tu","we","th","fr","sa"];
</script>

<svelte:window onkeydown={(showCal || showFocusList) ? handleKeydown : undefined} />

{#if !editorial}
  <div class="page-nav label">
    <button class="nav-btn" onclick={onPrev} aria-label="previous page">←</button>

    <div class="nav-center">
      <span class="chip-anchor" bind:this={calChipEl}>
        <TriggerChip
          label={formatDate(date)}
          active={!checkIsToday()}
          onClick={toggleCal}
          ariaLabel="open date picker"
        >
          {#snippet trailing()}
            <span class="caret"><Icon name="chevron-down" /></span>
          {/snippet}
        </TriggerChip>
      </span>
      {#if !isPhone && totalPages > 1}
        <!-- Desktop only: the dot page-picker. On phone this is redundant —
             the FocusRail dots and the bottom bar's "pages" button both switch
             pages — so it's dropped to keep the small-screen header compact. -->
        <span class="chip-anchor" bind:this={focusChipEl}>
          <TriggerChip
            onClick={toggleFocusList}
            ariaLabel="select focus"
          >
            {#each Array(totalPages) as _, i}
              <span class="page-dot" class:page-dot-active={i + 1 === pageNumber}></span>
            {/each}
            {#snippet trailing()}
              <span class="caret"><Icon name="chevron-down" /></span>
            {/snippet}
          </TriggerChip>
        </span>
      {/if}
      {#if !checkIsToday()}
        <button class="go-today" onclick={() => onDateSelect(getLocalDateStr())}>→ today</button>
      {/if}
    </div>

    <button class="nav-btn" onclick={onNext} aria-label="next page">→</button>
  </div>
{:else}
  <div class="pn-title">
    <button type="button" class="pn-date" bind:this={dateTitleEl} onclick={toggleCal} aria-label="open date picker">
      {formatDate(date)}<span class="pn-caret"><Icon name="chevron-down" /></span>
    </button>
    {#if !checkIsToday()}
      <button type="button" class="pn-today" onclick={() => onDateSelect(getLocalDateStr())}>→ today</button>
    {/if}
  </div>
{/if}

<!-- Calendar grid — reusable snippet so phone (BottomSheet) and
     desktop (popover) render the same DOM. -->
{#snippet calendarGrid()}
  <div class="cal-header">
    <button class="cal-nav" onclick={prevMonth} aria-label="previous month"><Icon name="chevron-left" /></button>
    <span class="cal-title">{monthNames[calMonth]} {calYear}</span>
    <button class="cal-nav" onclick={nextMonth} aria-label="next month"><Icon name="chevron-right" /></button>
  </div>
  <div class="cal-grid">
    {#each dayHeaders as dh}
      <span class="cal-day-header">{dh}</span>
    {/each}
    {#each calRows as row}
      {#each row as cell}
        {#if cell}
          <button
            class="cal-day"
            class:current={cell.isCurrent}
            class:today={cell.isToday}
            class:future={cell.isFuture}
            disabled={cell.isFuture}
            onclick={() => selectDay(cell.day)}
          >{cell.day}</button>
        {:else}
          <span class="cal-day empty"></span>
        {/if}
      {/each}
    {/each}
  </div>
{/snippet}

{#snippet focusList()}
  {#each focuses as f}
    <button class="focus-list-item" class:active={f.page_number === pageNumber} onclick={() => { onFocusSelect(f); showFocusList = false; }}>
      <span class="focus-list-name">{f.what_matters_now || "untitled page"}</span>
      <span class="focus-list-num">{f.page_number}</span>
    </button>
  {/each}
  {#if canNewPage && isPhone}
    <button
      class="focus-list-item focus-list-new"
      onclick={() => { onNewPage(); showFocusList = false; }}
    >
      <span class="focus-list-name">+ new page</span>
    </button>
  {/if}
{/snippet}


<!-- PageNav lives in Page.svelte's bottom bar on desktop, so the panel
     must float ABOVE the trigger (top-start), not below it — the old
     bespoke popups opened upward for the same reason (ShortcutHelp uses
     top-end for the same bottom-bar constraint). -->
<Popover anchor={editorial ? dateTitleEl : calChipEl} open={showCal} onClose={() => (showCal = false)} title="date" placement="top-start">
  <div class="sheet-cal">{@render calendarGrid()}</div>
</Popover>
<Popover anchor={editorial ? dateTitleEl : focusChipEl} open={showFocusList} onClose={() => (showFocusList = false)} title="pages" placement="top-start">
  <div class="sheet-focus-list">{@render focusList()}</div>
</Popover>

<style>
  .page-nav {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    opacity: 0.55;
    transition: opacity var(--motion-fast);
    position: relative;
  }

  .page-nav:hover {
    opacity: 0.92;
  }


  .nav-btn {
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    color: var(--ink);
    cursor: pointer;
    font-family: "Inter", sans-serif;
    font-weight: 400;
    font-size: 0.9375rem;
    padding: 0.25rem 0.5rem;
    opacity: 0.55;
    transition: opacity var(--motion-fast), background var(--motion-fast);
  }

  .nav-btn:hover {
    opacity: 0.92;
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }

  .nav-btn:active {
    opacity: 1;
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }

  .nav-center {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .page-dot {
    display: inline-block;
    width: 0.3125rem;
    height: 0.3125rem;
    border-radius: 50%;
    background: var(--ink);
    opacity: 0.25;
  }

  .page-dot-active {
    opacity: 0.92;
  }

  .caret {
    font-size: 0.6875rem;
    opacity: 0.55;
  }

  .go-today {
    background: none;
    border: none;
    cursor: pointer;
    font-family: "Inter", sans-serif;
    font-weight: 400;
    font-size: 0.6875rem;
    color: var(--warm-accent);
    opacity: 0.55;
    padding: 0.125rem 0.375rem;
    border-radius: 0.1875rem;
    transition: opacity var(--motion-fast),
                background var(--motion-fast);
  }

  .go-today:hover {
    opacity: 0.92;
    background: var(--warm-accent-soft);
  }

  /* Wrapper for TriggerChip anchors — TriggerChip doesn't forward an
     element ref, so Popover needs a real box to measure via
     getBoundingClientRect(). inline-flex (not `display: contents`)
     keeps the wrapper's box identical to the chip's. */
  .chip-anchor {
    display: inline-flex;
  }

  .cal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .cal-title {
    font-family: "Lora", serif;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.75;
  }

  .cal-nav {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    transition: opacity var(--motion-fast);
  }

  .cal-nav:hover { opacity: 0.92; }

  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.125rem;
  }

  .cal-day-header {
    text-align: center;
    font-size: 0.625rem;
    color: var(--ink);
    opacity: 0.25;
    padding: 0.125rem 0;
  }

  .cal-day {
    text-align: center;
    background: none;
    border: none;
    cursor: pointer;
    font-family: "Inter", sans-serif;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.25rem 0.125rem;
    border-radius: 0.25rem;
    transition: background var(--motion-fast),
                opacity var(--motion-fast);
    line-height: 1.4;
  }

  .cal-day:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    opacity: 0.92;
  }

  .cal-day.current {
    background: var(--warm-accent);
    color: var(--canvas-bg);
    opacity: 0.92;
    font-weight: 500;
  }

  .cal-day.today:not(.current) {
    border: 1px solid color-mix(in srgb, var(--warm-accent) 35%, transparent);
    opacity: 0.75;
  }

  .cal-day.future { opacity: 0.12; cursor: default; }
  .cal-day.empty { pointer-events: none; }

  /* Focus list dropdown */
  .focus-list-item {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 0.375rem 0.875rem;
    transition: background var(--motion-fast);
  }

  .focus-list-item:hover {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }

  .focus-list-item.active {
    background: var(--warm-accent-soft);
  }

  .focus-list-name {
    flex: 1;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.92;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .focus-list-num {
    flex-shrink: 0;
    font-family: "Inter", sans-serif;
    font-size: 0.625rem;
    color: var(--ink);
    opacity: 0.55;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.25rem;
    padding: 0.0625rem 0.375rem;
    min-width: 1.125rem;
    text-align: center;
  }

  .focus-list-new .focus-list-name { color: var(--warm-accent); }

  /* Bottom-sheet variants: comfy touch targets. `.sheet-cal`/
     `.sheet-focus-list` wrap the same content on desktop (inside the
     Popover's anchored panel) and on phone (inside the Popover's
     built-in BottomSheet fallback) — gate the touch-target bump to the
     same isMobileNav() breakpoint Popover itself uses (responsive.js),
     so the desktop popover keeps its compact sizing. */
  @media (max-width: 480px), (pointer: coarse) and (max-width: 768px), (orientation: landscape) and (max-height: 480px) {
    .sheet-cal {
      padding: 0.25rem 0;
    }
    .sheet-cal :global(.cal-day) {
      font-size: 0.9375rem;
      min-height: 2.5rem;
      padding: 0.5rem 0.125rem;
    }
    .sheet-cal :global(.cal-day-header) {
      font-size: 0.75rem;
      padding: 0.375rem 0;
    }
    .sheet-cal :global(.cal-nav) {
      font-size: 1.25rem;
      min-width: 2.5rem;
      min-height: 2.5rem;
    }
    .sheet-cal :global(.cal-title) {
      font-size: 1rem;
    }

    .sheet-focus-list :global(.focus-list-item) {
      padding: 0.75rem 0.5rem;
      min-height: 3rem;
      border-radius: 0.375rem;
    }
    .sheet-focus-list :global(.focus-list-name) {
      font-size: 0.9375rem;
    }
    .sheet-focus-list :global(.focus-list-num) {
      font-size: 0.75rem;
      padding: 0.125rem 0.5rem;
    }
  }

  /* Phone overrides — kept at the END so they cascade past every base
     rule (the date/counter buttons have `border: none` baselines that
     would otherwise win against a higher-up media query). */
  @media (pointer: coarse) {
    .nav-btn { min-width: 2.75rem; min-height: 2.75rem; }
  }

  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    /* MobileActionBar's "pages" navigates to the writing surface; the
       in-header `pages ▾` chip remains the BROWSE-all dropdown. */
    .page-nav { opacity: 1; }
    .nav-center { gap: 0.5rem; }
    .go-today {
      font-size: 0.8125rem;
      padding: 0.25rem 0.5rem;
      opacity: 0.92;
    }
  }

  .pn-title { display: inline-flex; align-items: baseline; gap: var(--space-3); min-width: 0; }
  .pn-date {
    appearance: none; background: none; border: none; padding: 0;
    font-family: "DM Mono", monospace; font-size: 1rem; letter-spacing: 0.02em;
    color: var(--ink); opacity: 0.85; cursor: pointer;
    min-height: max(var(--touch-target), 44px);
    display: inline-flex; align-items: center; gap: 0.375rem;
  }
  .pn-date:active { opacity: 1; }
  .pn-date:focus-visible { outline: 2px solid var(--warm-accent); outline-offset: 2px; }
  /* Matches the chevron opacity used by the trail and pages chips. */
  .pn-caret { opacity: 0.55; display: inline-flex; margin-left: 0.125rem; }
  .pn-today {
    appearance: none; background: none; border: none; padding: 0 var(--space-2);
    font-family: "Inter", sans-serif; font-size: 0.8125rem;
    color: var(--warm-accent); cursor: pointer;
    min-height: max(var(--touch-target), 44px);
  }
</style>
