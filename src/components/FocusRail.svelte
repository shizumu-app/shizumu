<script>
  import { onDestroy } from "svelte";
  import { getLocalDateStr } from "../lib/utils.js";
  import { isCoarsePointer } from "../lib/responsive.js";
  import { railDots } from "../lib/rail-dots.js";

  /**
   * FocusRail — dots representing today's focuses (pages) the user is working on.
   *
   * Scoping:
   *   • No trail (lineageId == null): show untrailed focuses for today.
   *   • Discrete trail: show focuses for today whose lineage_id matches.
   *   • Continuous trail: show the single canonical focus if it exists today; hide +.
   */

  /** @type {{
   *   focuses: Array<{id: string, what_matters_now: string|null, is_open: boolean, lineage_id: string|null, date?: string}>,
   *   currentId: string,
   *   onSelect: (id: string) => void,
   *   onNew: () => void,
   *   onDelete: (id: string) => void,
   *   trailMode: "continuous" | "discrete" | null,
   *   lineageId: string | null,
   *   isToday: boolean,
   * }} */
  let {
    focuses = [],
    currentId = "",
    onSelect,
    onNew,
    onDelete = () => {},
    trailMode = null,
    lineageId = null,
    isToday = true,
  } = $props();

  let hoveredId = $state(null);
  // Touch-mode reveal state — pointer:coarse devices don't fire
  // mouseenter, so a tap on a dot sets `revealedId` for 4s to expose
  // the delete affordance (mirrors what a mouse user sees on hover).
  // Cleared on next select or when the auto-hide timer fires.
  let revealedId = $state(null);
  let revealTimer = null;
  let confirmDeleteId = $state(null);

  function revealOnTouch(focusId) {
    if (!isCoarsePointer()) return;
    revealedId = focusId;
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      revealedId = null;
      confirmDeleteId = null;
    }, 4000);
  }

  // Long-press a dot on touch → enter delete-confirm directly.
  // No always-visible × on touch (visually too heavy in a thin dot
  // strip); long-press is the standard mobile context-action gesture.
  let longPressTimer = null;
  function startLongPress(e, focus) {
    if (!isCoarsePointer()) return;
    if (!canDelete(focus)) return;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      revealedId = focus.id;
      confirmDeleteId = focus.id;
      if (revealTimer) clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        revealedId = null;
        confirmDeleteId = null;
      }, 3000);
      longPressTimer = null;
    }, 500);
  }
  function clearLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  onDestroy(() => {
    if (revealTimer) clearTimeout(revealTimer);
    clearLongPress();
  });

  let visibleFocuses = $derived(focuses);
  // Dots while they can be counted, a count after that (lib/rail-dots.js,
  // which carries the measurement): twenty-odd dots ran into the header's
  // chips. The count keeps the click-to-another-page the dots gave, as a
  // step either side.
  let shape = $derived(railDots({
    count: visibleFocuses.length,
    index: visibleFocuses.findIndex((f) => f.id === currentId),
  }));
  let todayStr = $derived(getLocalDateStr());

  // "+" is available on today's rail regardless of trail mode. Discrete parity:
  // a continuous canonical dated today still gets "+" to append a sibling
  // untrailed focus at the end. Past-dated continuous canonicals have
  // isToday=false so "+" stays hidden.
  let canAddFocus = $derived(isToday);

  function handleDelete(e, focusId) {
    e.stopPropagation();
    if (confirmDeleteId === focusId) {
      onDelete(focusId);
      confirmDeleteId = null;
    } else {
      confirmDeleteId = focusId;
      setTimeout(() => { confirmDeleteId = null; }, 2000);
    }
  }

  function canDelete(focus) {
    if (trailMode === "continuous") return false;
    // A continuous trail's canonical can appear on other pages' rails as an
    // injected dot (isContinuousCanonical). Never allow rail-delete of it —
    // deleting the DB row would destroy the entire trail's living document.
    if (focus.isContinuousCanonical) return false;
    return focus.is_open && visibleFocuses.length > 1;
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + "T00:00:00");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.floor((today - d) / 86400000);
      if (diff === 0) return "today";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
    } catch {
      return dateStr;
    }
  }
</script>

<div class="focus-rail" class:continuous={trailMode === "continuous"}>
  {#if shape.kind === "count"}
    <button
      class="rail-step"
      disabled={shape.prev === null}
      onclick={() => shape.prev !== null && onSelect(visibleFocuses[shape.prev].id)}
      aria-label="previous page"
    >‹</button>
    <span class="rail-count" aria-live="polite">{shape.label}</span>
    <button
      class="rail-step"
      disabled={shape.next === null}
      onclick={() => shape.next !== null && onSelect(visibleFocuses[shape.next].id)}
      aria-label="next page"
    >›</button>
    <!-- The dots' × was the only page delete on a desktop, so past eight
         pages none could be deleted (sync journey J6.2). The count keeps it,
         for the page on screen, behind the same two-tap confirm. -->
    {@const current = visibleFocuses.find((f) => f.id === currentId)}
    {#if current && canDelete(current)}
      <button
        class="rail-delete rail-count-delete"
        class:confirming={confirmDeleteId === current.id}
        onclick={(e) => handleDelete(e, current.id)}
        aria-label={confirmDeleteId === current.id ? "tap to delete this page" : "delete this page"}
      >×</button>
    {/if}
  {:else}
  {#each visibleFocuses as focus (focus.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="rail-dot-wrap"
      onmouseenter={() => hoveredId = focus.id}
      onmouseleave={() => { hoveredId = null; confirmDeleteId = null; }}
    >
      <button
        class="rail-dot-hit"
        onclick={() => { revealOnTouch(focus.id); onSelect(focus.id); }}
        onpointerdown={(e) => startLongPress(e, focus)}
        onpointerup={clearLongPress}
        onpointerleave={clearLongPress}
        onpointercancel={clearLongPress}
        aria-label={focus.what_matters_now || "focus"}
      >
        <span
          class="rail-dot"
          class:current={focus.id === currentId}
          class:closed={!focus.is_open}
          class:today={focus.date === todayStr}
        ></span>
      </button>

      {#if (hoveredId === focus.id || revealedId === focus.id) && canDelete(focus)}
        <button
          class="rail-delete"
          class:confirming={confirmDeleteId === focus.id}
          onclick={(e) => handleDelete(e, focus.id)}
          aria-label={confirmDeleteId === focus.id ? "tap to delete this focus" : "remove focus"}
        >×</button>
      {/if}

      <!-- Tooltip is mouse-only — touch users get the inline action button
           instead, no floating hint. -->
      {#if hoveredId === focus.id && confirmDeleteId !== focus.id && (focus.what_matters_now || focus.date)}
        <span class="rail-tooltip">
          {#if focus.date}
            <span class="tip-date">{formatDate(focus.date)}</span>
          {/if}
          {#if focus.what_matters_now}
            <span class="tip-focus">{focus.what_matters_now}</span>
          {/if}
        </span>
      {/if}
    </div>
  {/each}
  {/if}
  {#if canAddFocus}
    <button class="rail-add" onclick={onNew} aria-label="new focus">+</button>
  {/if}
</div>

<style>
  /* The rail is its own visual primitive — dots, hit targets, tooltip.
     Per the spec we keep it bespoke but route every dimension through
     rem/tokens so it scales with --ui-scale and respects the opacity
     ladder. Sub-rem rule thicknesses (1px borders, 1.5px tick) stay in px
     because rem'd hairlines drift to fractional pixels at non-1x DPI. */
  .focus-rail {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0 0.75rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  /* On tablet/phone the rail can overflow horizontally on days with
     many focuses. Allow scroll instead of forcing layout overflow; a
     collapsed-drawer treatment was considered but the typical 1–3
     dots/day doesn't earn the extra chrome. */
  @media (max-width: 768px), (orientation: landscape) and (max-height: 480px) {
    .focus-rail {
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .focus-rail::-webkit-scrollbar {
      display: none;
    }
  }

  /* Phone: bump dot size + hit target so the rail reads as the second
     row of header chrome, not as a ghost. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .rail-dot-hit {
      width: 1.75rem;
      height: 1.75rem;
    }
    .rail-dot {
      width: 10px;
      height: 10px;
      border-radius: 5px;
    }
    .rail-dot.current { width: 24px; }
    .focus-rail { opacity: 1; }
  }

  .focus-rail:hover {
    color: var(--ink);
    opacity: 1;
  }

  .focus-rail.continuous {
    color: var(--ink-soft);
  }

  .rail-dot-wrap {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.125rem;
  }

  /* Invisible 1rem hit target centered on the visible dot. */
  .rail-dot-hit {
    min-width: 1rem;
    height: 1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  /* Solid dots in whole pixels, like the phone's (PageHeader.svelte).
     Sized in px, not rem: --ui-scale turned a 0.5625rem ring with a 1.5px
     border into a fractional, blurred outline next to a bigger filled
     blob (2026-10-31, owner: "make them crispy"). The page on screen is
     the same height drawn as an accent pill, so "you are here" reads by
     shape as well as colour. Open and closed pages are told apart by the
     tooltip, not by a hairline ring too thin to draw cleanly. The rail
     shows one day's pages, so a "today" tick under each dot said nothing
     the date did not, and read as a row of underscores; it is gone. */
  .rail-dot {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: var(--ink-soft);
    transition: width 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1);
    display: block;
  }

  .rail-dot.current {
    width: 20px;
    background: var(--warm-accent);
  }

  .rail-dot-hit:hover .rail-dot:not(.current) {
    background: var(--ink);
  }


  .rail-delete {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.6875rem;
    color: var(--ink-soft);
    padding: 0 0.125rem;
    line-height: 1;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                color 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .rail-delete:hover,
  .rail-delete.confirming {
    color: var(--accent-text);
    opacity: 1;
  }
  .rail-delete.confirming {
    background: var(--warm-accent-soft);
    border-radius: 50%;
    width: 1.125rem;
    height: 1.125rem;
    padding: 0;
    font-size: 0.875rem;
    color: var(--accent-text);
    opacity: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  /* Touch: the always-visible × in a dot strip is visually heavy.
     On coarse pointer the × is hidden — long-press a dot to enter
     delete-confirm directly (see handler in script).
     The confirming chip still renders if the user holds the dot
     for ~500ms. Tooltip is also hidden on touch. */
  @media (pointer: coarse) {
    /* Not the count's ×: there is no dot to long-press past eight pages. */
    .rail-delete:not(.confirming):not(.rail-count-delete) {
      display: none;
    }
    .rail-delete.confirming {
      width: 2rem;
      height: 2rem;
      font-size: 1rem;
    }
    .rail-tooltip {
      display: none;
    }
  }

  .rail-tooltip {
    position: absolute;
    top: 1.375rem;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.8125rem;
    color: var(--ink);
    background: var(--canvas-bg);
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    box-shadow: 0 0.25rem 1rem var(--card-shadow);
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    pointer-events: none;
    z-index: 10;
    max-width: 17.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-flex;
    align-items: baseline;
    gap: 0.375rem;
    opacity: 1;
  }

  .tip-date {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    font-style: normal;
    letter-spacing: 0.02em;
    color: var(--ink-soft);
  }

  .tip-focus {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .confirm-hint {
    color: var(--accent-text);
    font-style: normal;
    font-family: var(--font-ui);
    font-size: 0.6875rem;
  }

  /* The count that replaces the dots past eight, and its two steps. Same
     ink and the same quiet as the dots — it is the same indicator, saying
     the same thing in a form that still fits. */
  .rail-count {
    font-family: "DM Mono", monospace;
    font-size: 0.75rem;
    letter-spacing: 0.02em;
    color: var(--ink);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .rail-step {
    background: none;
    border: none;
    padding: 0 0.25rem;
    font-size: 0.875rem;
    line-height: 1;
    color: var(--ink);
    cursor: pointer;
  }
  .rail-step:disabled {
    opacity: 0.3;
    cursor: default;
  }
  /* A plain + in the interface face, the size of the dots' row; the
     dashed circle around it was bigger and busier than the dots. */
  .rail-add {
    background: none;
    border: none;
    border-radius: 4px;
    min-width: 1.25rem;
    height: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: 15px;
    line-height: 1;
    color: var(--ink-soft);
    padding: 0;
    margin-left: 2px;
    transition: color 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .rail-add:hover {
    color: var(--accent-text);
    background: var(--hover-tint);
  }
</style>
