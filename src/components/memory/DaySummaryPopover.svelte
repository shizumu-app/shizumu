<!--
  DaySummaryPopover — small popover anchored on a day's dot.
  Single variant: focus + open page + see pin + continue from here actions.
  Global variant: per-trail breakdown rows with breadcrumb naming,
  counts, click trail name to switch sidebar selection.
-->
<script>
  import Popover from "../../lib/ui/Popover.svelte";

  /** @type {{
    anchor: HTMLElement | null,
    open: boolean,
    variant: "single" | "global",
    date: string,
    focusText: string,                          // single only
    pagesCount: number,                         // single only
    pinsCount: number,                          // single only
    breakdown: Array<{ lineageId: string, name: string, path: string[], pageCount: number, pinCount: number }>, // global only
    onClose: () => void,
    onOpenPage?: () => void,                    // single only
    onSeePins?: () => void,                     // single only
    onContinueFromHere?: () => void,            // single only
    onSelectTrail?: (lineageId: string) => void, // global only
    onSeeTrailPages?: (lineageId: string) => void, // global only
    onSeeTrailPins?: (lineageId: string) => void,  // global only
  }} */
  let {
    anchor, open, variant, date,
    focusText = "", pagesCount = 0, pinsCount = 0,
    breakdown = [],
    onClose,
    onOpenPage, onSeePins, onContinueFromHere,
    onSelectTrail, onSeeTrailPages, onSeeTrailPins,
  } = $props();

  function shortDate(iso) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const weekdays = ["sun","mon","tue","wed","thu","fri","sat"];
    const d = new Date(iso + "T00:00:00");
    return `${parseInt(iso.slice(8, 10), 10)} ${months[d.getMonth()]}, ${weekdays[d.getDay()]}`;
  }

  function breadcrumb(path) {
    if (!path || path.length === 0) return "untrailed";
    if (path.length === 1) return path[0];
    return `${path[path.length - 2]} › ${path[path.length - 1]}`;
  }
</script>

{#if open}
<Popover anchor={anchor} open onClose={onClose} placement="bottom-end" title="day">
  <div class="day-summary-pop">
    <div class="head">
      {shortDate(date)}
      {#if variant === "global"} · {breakdown.length} {breakdown.length === 1 ? "trail" : "trails"} active{/if}
    </div>

    {#if variant === "single"}
      {#if focusText}
        <div class="focus">{focusText}</div>
      {/if}
      <button type="button" class="row" onclick={onOpenPage} disabled={pagesCount === 0} class:dim={pagesCount === 0}>
        open the page
        <span class="kbd">↵</span>
      </button>
      <button type="button" class="row" onclick={onSeePins} disabled={pinsCount === 0} class:dim={pinsCount === 0}>
        see pins on this day
        <span class="kbd">p</span>
      </button>
      <button type="button" class="row accent" onclick={onContinueFromHere}>
        continue from here
        <span class="kbd">c</span>
      </button>
    {:else}
      {#each breakdown as row (row.lineageId)}
        <div class="trail-row">
          <button
            type="button"
            class="trail-name"
            onclick={() => onSelectTrail?.(row.lineageId)}
          >{breadcrumb(row.path)}</button>
          <div class="trail-actions">
            {#if row.pageCount > 0}
              <button
                type="button"
                class="trail-chip"
                onclick={() => onSeeTrailPages?.(row.lineageId)}
              >{row.pageCount} {row.pageCount === 1 ? "page" : "pages"}</button>
            {/if}
            {#if row.pinCount > 0}
              <button
                type="button"
                class="trail-chip pin"
                onclick={() => onSeeTrailPins?.(row.lineageId)}
              >↗ {row.pinCount} {row.pinCount === 1 ? "pin" : "pins"}</button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</Popover>
{/if}

<style>
  .day-summary-pop {
    width: 17rem;
    padding: 0.625rem 0.75rem;
    font-family: "Lora", Georgia, serif;
  }
  .head {
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
    letter-spacing: 0.05em;
    opacity: 0.55;
    text-transform: lowercase;
    padding-bottom: 0.4375rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .focus {
    font-style: italic;
    color: var(--warm-accent);
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
    line-height: 1.5;
  }
  .row {
    appearance: none;
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    padding: 0.3125rem 0.375rem;
    border-radius: 0.25rem;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.85;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .row:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
  .row.accent { color: var(--warm-accent); }
  .row.dim { opacity: 0.3; cursor: not-allowed; }
  .kbd {
    font-family: "DM Mono", monospace;
    font-size: 0.5rem;
    opacity: 0.35;
    font-style: normal;
  }

  .trail-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.375rem 0.25rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 4%, transparent);
  }
  .trail-row:last-child { border-bottom: none; }
  .trail-name {
    appearance: none;
    background: transparent;
    border: none;
    padding: 0;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.8125rem;
    color: var(--warm-accent);
    opacity: 0.92;
    cursor: pointer;
    flex: 1;
    text-align: left;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trail-name:hover { opacity: 1; text-decoration: underline; }
  .trail-actions { display: flex; gap: 0.3125rem; flex-shrink: 0; }
  .trail-chip {
    appearance: none;
    font-family: "DM Mono", monospace;
    font-size: 0.5rem;
    padding: 0.0625rem 0.375rem;
    border-radius: 0.375rem;
    background: color-mix(in srgb, var(--warm-accent) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--warm-accent) 18%, transparent);
    color: var(--ink);
    opacity: 0.75;
    cursor: pointer;
  }
  .trail-chip:hover { opacity: 1; }
</style>
