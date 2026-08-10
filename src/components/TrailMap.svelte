<!--
  TrailMap — orchestrator for the memory trail-map view.

  Layout: one row per active day. Inside each day, every trail that wrote
  on that day renders as its own block — pins chip + trail name on the
  header, then one clickable row per page showing its what_matters_now.
  No SVG arcs, no spawn-day indentation; subtrails are simply additional
  blocks under the same date. Pin clicks open the items popover so the
  user can pick a specific pin to view.

  Single variant (lineageId set): pages/pins are already scoped by Memory
  to that trail + its descendants. Global variant (lineageId null): pages
  and pins from every trail flow through; trail blocks separate them by
  trail.
-->
<script>
  import { onMount, tick } from "svelte";
  import {
    daysWithActivity, trailGroupsForDate, dayItemsFor, relativeLineagePath,
  } from "../lib/memory-filters.js";
  import ItemsPopover from "./memory/ItemsPopover.svelte";

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

  // Active days only — empty days dominate the view with "no focus" noise.
  let days = $derived(daysWithActivity(pages, pins));

  // Single popover slot for pin chip clicks.
  /** @type {{ anchor: HTMLElement, payload: { date: string, lineageId: string, kind: "pins" | "pages" } } | null} */
  let popover = $state(null);
  function openPinsPopover(date, lid, anchor) {
    popover = { anchor, payload: { date, lineageId: lid, kind: "pins" } };
  }
  function closePopover() { popover = null; }

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

  // Always render the leaf trail name only (no parent prefix). Hide
  // the chip entirely when the entry's trail IS the active sidebar
  // selection — the sidebar already names that context.
  function trailBreadcrumb(group) {
    if (group.lineageId === "__untrailed__") return "untrailed";
    const path = group.path || [];
    if (path.length === 0) return null;
    // Pages-only blocks on the active sidebar trail render as plain
    // prose (no card chrome). The chip there reads as redundant since
    // the sidebar already names that trail. Cards with pins always
    // show the chip — an empty card header looks confusing.
    const hasPins = group.pins.length > 0;
    if (!hasPins && lineageId && group.lineageId === lineageId) return null;
    const rel = relativeLineagePath(path, lineageId, lineages);
    return rel.map((l) => l.name).join(" › ");
  }

  function itemsHeader(date, lid, count) {
    const f = formatDay(date);
    const trailLabel = lid === "__untrailed__"
      ? "untrailed"
      : (lineages.find((l) => l.id === lid)?.name || "trail");
    return `${count} ${count === 1 ? "pin" : "pins"} · ${trailLabel} · ${f.num} ${f.month}`;
  }
</script>

<div class="trail-map">
  {#if days.length === 0}
    <div class="empty">no writing here yet</div>
  {:else}
    <div class="spine-track">
      {#each days as d (d.date)}
        {@const groups = trailGroupsForDate({ pages, pins, lineages, date: d.date })}
        {@const fmt = formatDay(d.date)}
        <div class="day-row" data-day={d.date}>
          <div class="day-date">
            <span class="day-num">{fmt.num}</span>
            <span class="day-when">{fmt.month}, {fmt.weekday}</span>
          </div>
          <div class="day-dot" class:today={d.date === todayStr}></div>
          <div class="day-body">
            {#each groups as g (g.lineageId)}
              {@const crumb = trailBreadcrumb(g)}
              <div class="trail-block has-chrome">
                {#if g.pins.length > 0 || crumb}
                  <header class="trail-header">
                    {#if crumb}
                      <button
                        type="button"
                        class="trail-name"
                        onclick={() => onSwitchSidebar?.(g.lineageId)}
                      >{crumb}</button>
                    {/if}
                    {#if g.pins.length > 0}
                      <button
                        type="button"
                        class="pins-chip"
                        onclick={(e) => openPinsPopover(d.date, g.lineageId, e.currentTarget)}
                        title="open pins from this trail on {d.date}"
                      >↗ {g.pins.length} {g.pins.length === 1 ? "pin" : "pins"}</button>
                    {/if}
                  </header>
                {/if}
                {#if g.pages.length > 0}
                  <ul class="trail-pages">
                    {#each g.pages as p (p.id)}
                      <li>
                        <button
                          type="button"
                          class="page-row"
                          onclick={() => onSelectPage(p)}
                        class:untitled={!(p.what_matters_now && p.what_matters_now.trim())}
                        >{(p.what_matters_now && p.what_matters_now.trim()) || "untitled"}</button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if popover}
  {@const { date, lineageId: lid, kind } = popover.payload}
  {@const items = dayItemsFor({ pages, pins, date, lineageId: lid, kind })}
  <ItemsPopover
    anchor={popover.anchor}
    open
    kind={kind}
    headerLabel={itemsHeader(date, lid, items.length)}
    items={items}
    onOpen={(item) => {
      if (kind === "pages") onSelectPage(item);
      else onOpenSpecificPin?.(item);
      closePopover();
    }}
    onSeeAll={() => {
      onSwitchMode?.(kind, { dateFilter: { kind: "specific", date }, lineageId: lid });
      closePopover();
    }}
    onClose={closePopover}
  />
{/if}

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
    color: var(--ink);
    opacity: 0.45;
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
    color: var(--ink);
    opacity: 0.78;
  }
  .day-when {
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
    color: var(--ink);
    opacity: 0.45;
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

  .day-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .trail-block {
    display: flex;
    flex-direction: column;
    gap: 0.1875rem;
  }
  /* Card chrome only when the block carries a trail chip or pins —
     keeps the chip-less "pages on the active trail" rows as plain
     prose without a box around them. */
  .trail-block.has-chrome {
    /* Mirror the memory card surface (Memory.svelte's .cards / .pin-rows
       :global(.card)): borderless, warm-tinted background + barely-there
       lift, rounded, comfy padding — so the trail map block reads as the
       same card family as the pages and pins cards. */
    padding: 0.875rem 1rem;
    border: none;
    background: color-mix(in srgb, var(--warm-accent) 4%, color-mix(in srgb, var(--ink) 3%, var(--canvas-bg)));
    border-radius: 0.625rem;
    box-shadow: 0 1px 3px var(--card-shadow);
    gap: 0.25rem;
  }
  .trail-header {
    display: inline-flex;
    align-items: center;
    gap: 0.4375rem;
    flex-wrap: wrap;
  }
  .pins-chip {
    appearance: none;
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
    color: var(--warm-accent);
    opacity: 0.85;
    padding: 0.0625rem 0.4375rem;
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--warm-accent) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--warm-accent) 25%, transparent);
    cursor: pointer;
    letter-spacing: 0.02em;
    transition: background 120ms cubic-bezier(0.2, 0, 0, 1);
  }
  .pins-chip:hover {
    background: color-mix(in srgb, var(--warm-accent) 18%, transparent);
    opacity: 1;
  }
  .trail-name {
    appearance: none;
    background: transparent;
    border: none;
    padding: 0;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.8125rem;
    color: var(--warm-accent);
    opacity: 0.85;
    cursor: pointer;
    text-align: left;
  }
  .trail-name:hover {
    opacity: 1;
    text-decoration: underline;
  }

  .trail-pages {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .trail-pages li + li {
    border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    margin-top: 0.25rem;
    padding-top: 0.25rem;
  }
  .page-row {
    appearance: none;
    background: transparent;
    border: none;
    padding: 0.25rem 0;
    font-family: "Lora", Georgia, serif;
    font-size: 0.9375rem;
    color: var(--ink);
    opacity: 0.85;
    cursor: pointer;
    text-align: left;
    width: 100%;
    line-height: 1.4;
  }
  .page-row:hover {
    opacity: 1;
    color: var(--warm-accent);
  }
  .page-row.untitled {
    font-style: italic;
    opacity: 0.5;
  }
</style>
