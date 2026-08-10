<!--
  DayBlock — one day row in the trail map timeline.
  Layout: [dot] [date column] [focus line + count chips].
  Pure presentational: parent shapes the data and routes the callbacks.
  All three click targets pass their DOM element as the popover anchor.
-->
<script>
  /** @type {{
    date: string,                     // YYYY-MM-DD
    focusText: string,                // "no focus" when empty
    focusEmpty: boolean,              // dims the focus line
    dotState: "active" | "empty" | "sub",
    isToday: boolean,
    pageCount: number,
    pinCount: number,
    countsText?: string,              // optional small mono suffix (e.g. "· 3 trails")
    onDotClick: (anchor: HTMLElement) => void,
    onPagesClick: (anchor: HTMLElement) => void,
    onPinsClick: (anchor: HTMLElement) => void,
    hideDate?: boolean,                // sub-rows reuse the parent row's date stamp
  }} */
  let {
    date, focusText, focusEmpty = false, dotState = "active", isToday = false,
    pageCount = 0, pinCount = 0, countsText = "",
    onDotClick, onPagesClick, onPinsClick,
    hideDate = false,
  } = $props();

  const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const WEEKDAYS = ["sun","mon","tue","wed","thu","fri","sat"];
  function shortMonth(iso) {
    const d = new Date(iso + "T00:00:00");
    return `${MONTHS[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}`;
  }
</script>

<div class="day-block" class:today={isToday}>
  <button
    type="button"
    class="dot"
    class:active={dotState === "active"}
    class:empty={dotState === "empty"}
    class:sub={dotState === "sub"}
    class:today={isToday}
    onclick={(e) => onDotClick(e.currentTarget)}
    aria-label={`day ${date}`}
  ></button>
  {#if !hideDate}
    <span class="date-col">
      <span class="day-num">{parseInt(date.slice(8, 10), 10)}</span>
      <span class="month-line">{shortMonth(date)}</span>
    </span>
  {/if}
  <div class="day-body">
    <div class="focus-line" class:empty={focusEmpty}>{focusText}</div>
    {#if pageCount > 0 || pinCount > 0 || countsText}
      <div class="chip-row">
        {#if pageCount > 0}
          <button
            type="button"
            class="count-chip"
            onclick={(e) => { e.stopPropagation(); onPagesClick(e.currentTarget); }}
          >{pageCount} {pageCount === 1 ? "page" : "pages"}</button>
        {/if}
        {#if pinCount > 0}
          <button
            type="button"
            class="count-chip pin"
            onclick={(e) => { e.stopPropagation(); onPinsClick(e.currentTarget); }}
          >↗ {pinCount} {pinCount === 1 ? "pin" : "pins"}</button>
        {/if}
        {#if countsText}
          <span class="counts-text">{countsText}</span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .day-block {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.5rem 0;
    position: relative;
  }
  .dot {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    border: 1.5px solid var(--ink);
    background: var(--warm-accent);
    flex-shrink: 0;
    padding: 0;
    cursor: pointer;
    margin-top: 0.125rem;
  }
  .dot.empty { background: transparent; }
  .dot.sub { background: var(--warm-accent); opacity: 0.6; }
  .dot.today {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--warm-accent) 25%, transparent);
  }
  .dot:hover { transform: scale(1.15); transition: transform 120ms cubic-bezier(0.2, 0, 0, 1); }
  .date-col {
    min-width: 2.75rem;
    font-family: "DM Mono", monospace;
    line-height: 1.1;
    flex-shrink: 0;
  }
  .day-num { font-size: 0.875rem; opacity: 0.92; display: block; }
  .month-line { font-size: 0.5625rem; opacity: 0.55; }
  .day-body {
    flex: 1;
    min-width: 0;
    padding-top: 0.0625rem;
  }
  .focus-line {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.875rem;
    color: var(--ink);
    opacity: 0.92;
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .focus-line.empty { opacity: 0.55; }
  .chip-row {
    display: flex;
    gap: 0.4375rem;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 0.3125rem;
  }
  .count-chip {
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
    color: var(--ink);
    opacity: 0.75;
    padding: 0.0625rem 0.4375rem;
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--warm-accent) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--warm-accent) 18%, transparent);
    cursor: pointer;
    line-height: 1.4;
  }
  .count-chip:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }
  .counts-text {
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
    opacity: 0.45;
  }
</style>
