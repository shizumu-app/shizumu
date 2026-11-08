<!--
  TrailMap — orchestrator for the memory trail-map view.

  Layout: one row per active day, in a column capped at reading width
  beside the day gutter. Inside each day, one entry per page: trail path,
  title, the page's first line as a preview, and every pin kept from that
  page under it (spec 2026-11-01 §3; trail-map-entries.js decides all of
  it). A pin whose page is not on the map shows on its own line on its day.

  Single variant (lineageId set): pages/pins are already scoped by Memory
  to that trail + its descendants. Global variant (lineageId null): pages
  and pins from every trail flow through; trail blocks separate them by
  trail.
-->
<script>
  import { onMount, tick } from "svelte";
  import { daysWithActivity } from "../lib/memory-filters.js";
  import { trailMapDay } from "../lib/trail-map-entries.js";

  /** @type {{
    pages: Array<any>,
    pins: Array<any>,
    lineageId: string | null,
    lineages: Array<any>,
    subtrails?: Array<{ lineage: any, pages: Array<any>, pins: Array<any> }>,
    dateFilter?: any,
    todayStr: string,
    onSelectPage: (page: any) => void,
    onOpenSpecificPin?: (pin: any) => void,
    onSwitchMode?: (mode: string, opts?: any) => void,
    onSwitchSidebar?: (lineageId: string) => void,
  }} */
  let {
    pages, pins = [], lineageId, lineages, subtrails = [], dateFilter, todayStr,
    onSelectPage, onOpenSpecificPin, onSwitchMode, onSwitchSidebar,
  } = $props();
  void dateFilter;
  void subtrails;
  // The "n pins" chip and its popover were the only callers; a pin now
  // shows under its page and opens directly.
  void onSwitchMode;

  // Active days only — empty days dominate the view with "no focus" noise.
  let days = $derived(daysWithActivity(pages, pins));

  // Scroll-to-today on mount.
  onMount(async () => {
    await tick();
    const el = document.querySelector(".trail-map [data-day='" + todayStr + "']");
    el?.scrollIntoView({ block: "center" });
  });

  const monthNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const weekdayNames = ["sun","mon","tue","wed","thu","fri","sat"];
  function formatDay(date) {
    const d = new Date(date + "T12:00:00");
    return {
      num: String(d.getDate()),
      month: monthNames[d.getMonth()],
      weekday: weekdayNames[d.getDay()],
    };
  }

</script>

<div class="trail-map">
  {#if days.length === 0}
    <div class="empty">no writing here yet</div>
  {:else}
    <div class="spine-track">
      {#each days as d (d.date)}
        {@const fmt = formatDay(d.date)}
        {@const day = trailMapDay({ pages, pins, lineages, lineageId, date: d.date })}
        <div class="day-row" data-day={d.date}>
          <div class="day-date">
            <span class="day-num">{fmt.num}</span>
            <span class="day-when">{fmt.month}, {fmt.weekday}</span>
          </div>
          <div class="day-dot" class:today={d.date === todayStr}></div>
          <div class="day-body">
            {#each day.entries as e (e.page.id)}
              <article class="entry">
                {#if e.crumb}
                  <button
                    type="button"
                    class="entry-trail"
                    onclick={() => onSwitchSidebar?.(e.lineageId ?? "__untrailed__")}
                    aria-label={`show the trail ${e.crumb}`}
                  >{e.crumb}</button>
                {/if}
                <button
                  type="button"
                  class="entry-title"
                  class:untitled={e.untitled}
                  onclick={() => onSelectPage(e.page)}
                >{e.title}</button>
                {#if e.preview}
                  <p class="entry-preview">{e.preview}</p>
                {/if}
                {#each e.pins as k (k.pin.id)}
                  <button type="button" class="entry-pin" onclick={() => onOpenSpecificPin?.(k.pin)}>
                    <span aria-hidden="true">↗</span> {k.title}
                  </button>
                {/each}
              </article>
            {/each}
            {#each day.loosePins as k (k.pin.id)}
              <div class="entry loose">
                {#if k.crumb}<span class="entry-trail static">{k.crumb}</span>{/if}
                <button type="button" class="entry-pin" onclick={() => onOpenSpecificPin?.(k.pin)}>
                  <span aria-hidden="true">↗</span> {k.title}
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>


<style>
  .trail-map {
    padding: 1rem 1.25rem;
    position: relative;
  }

  /* Phone: smaller side padding + allow horizontal scroll if the spine
     plus row labels overflow. Vertical scroll is the natural one for
     the spine layout. */
  @media (pointer: coarse) {
    .trail-map {
      padding: 0.5rem 0.25rem;
      overflow-x: auto;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-x pan-y;
      overscroll-behavior: contain;
    }
    /* Tighter columns: date label + dot rail eat less horizontal space
       so the card stretches further. */
    .day-row {
      grid-template-columns: 2.25rem 1rem 1fr;
      column-gap: 0.375rem;
      padding: 0.625rem 0;
    }
    .spine-track::before {
      /* Center on the dot column: 2.25rem (date) + 0.375rem gap
         + 0.5rem (half of 1rem dot col) = 3.125rem. */
      left: 3.125rem;
    }
    .day-num {
      font-size: 1rem;
    }
    .day-when {
      font-size: 0.5rem;
    }
  }
  .empty {
    text-align: center;
    padding: 3rem 1rem;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    color: var(--ink-soft);
  }

  /* The spine is a single vertical line drawn behind the dots. Days
     attach their dots to it via fixed positioning relative to the row. */
  .spine-track {
    position: relative;
  }
  .spine-track::before {
    content: "";
    position: absolute;
    /* Center the spine on the dot column. Day-row grid is
       3.875rem (date) + 0.5rem gap + 1.5rem (dot column).
       Dot center sits at 3.875 + 0.5 + 0.75 = 5.125rem from the row's
       left edge, which equals the spine-track's left edge. */
    left: 5.125rem;
    top: 0;
    bottom: 0;
    width: 1px;
    background: color-mix(in srgb, var(--ink) 10%, transparent);
  }

  .day-row {
    position: relative;
    display: grid;
    grid-template-columns: 3.875rem 1.5rem 1fr;
    align-items: start;
    column-gap: 0.5rem;
    padding: 0.875rem 0 0.875rem 0;
  }
  .day-date {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.1;
    padding-top: 0.0625rem;
  }
  .day-num {
    font-family: "Lora", Georgia, serif;
    font-size: 1.125rem;
    color: var(--ink-soft);
  }
  .day-when {
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
    color: var(--ink-soft);
    margin-top: 0.125rem;
    letter-spacing: 0.03em;
  }
  .day-dot {
    width: 0.5625rem;
    height: 0.5625rem;
    border-radius: 50%;
    background: var(--warm-accent);
    margin-top: 0.4375rem;
    justify-self: center;
    box-shadow: 0 0 0 3px var(--canvas-bg);
    position: relative;
    z-index: 1;
  }
  .day-dot.today {
    box-shadow: 0 0 0 3px var(--canvas-bg), 0 0 0 4px color-mix(in srgb, var(--warm-accent) 35%, transparent);
  }

  /* Reading width (spec §3): an entry is a title and a line or two, and a
     card stretched across a wide window put the eye a long way from the
     date it belongs to. */
  .day-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    max-width: 47.5rem;
  }

  /* One page. The memory card family's surface (Memory.svelte .cards). */
  .entry {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1875rem;
    padding: 0.625rem 0.875rem;
    background: color-mix(in srgb, var(--warm-accent) 4%, color-mix(in srgb, var(--ink) 3%, var(--canvas-bg)));
    border-radius: 0.625rem;
    box-shadow: 0 1px 3px var(--card-shadow);
    min-width: 0;
  }
  .entry.loose { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  .entry-trail {
    appearance: none;
    background: transparent;
    border: none;
    padding: 0;
    font-family: "DM Mono", monospace;
    font-size: 0.75rem;
    color: var(--accent-text);
    cursor: pointer;
    text-align: left;
  }
  .entry-trail.static { cursor: default; }
  button.entry-trail:hover { text-decoration: underline; text-underline-offset: 0.2em; }
  .entry-title {
    appearance: none;
    background: transparent;
    border: none;
    padding: 0;
    font-family: "Lora", Georgia, serif;
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--ink);
    cursor: pointer;
    text-align: left;
    max-width: 100%;
  }
  .entry-title:hover { color: var(--accent-text); }
  .entry-title.untitled { font-style: italic; color: var(--ink-soft); }
  .entry-preview {
    margin: 0;
    font-family: "Lora", Georgia, serif;
    font-size: 0.84375rem;
    line-height: 1.45;
    color: var(--ink-soft);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* A pin kept from this page: the pin itself, not a count of pins. */
  .entry-pin {
    appearance: none;
    background: transparent;
    border: none;
    border-left: 2px solid var(--warm-accent);
    margin-top: 0.375rem;
    padding: 0 0 0 0.5rem;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--ink-soft);
    cursor: pointer;
    text-align: left;
    max-width: 100%;
  }
  .entry.loose .entry-pin { margin-top: 0.125rem; }
  .entry-pin:hover { color: var(--accent-text); }
</style>
