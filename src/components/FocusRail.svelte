<script>
  import { onDestroy } from "svelte";
  import { getLocalDateStr } from "../lib/utils.js";
  import { isCoarsePointer } from "../lib/responsive.js";

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
    gap: 0.625rem;
    padding: 0.5rem 0 0.75rem;
    opacity: 0.55;
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
      width: 0.875rem;
      height: 0.875rem;
      border-width: 2px;
      opacity: 0.75;
    }
    .focus-rail { opacity: 1; }
  }

  .focus-rail:hover {
    opacity: 0.92;
  }

  .focus-rail.continuous {
    opacity: 0.55;
  }

  .rail-dot-wrap {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.125rem;
  }

  /* Invisible 1rem hit target centered on the visible dot. */
  .rail-dot-hit {
    width: 1rem;
    height: 1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .rail-dot {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 50%;
    border: 1.5px solid var(--ink);
    background: transparent;
    opacity: 0.55;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                transform 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1),
                border-color 180ms cubic-bezier(0.2, 0, 0, 1),
                width 180ms cubic-bezier(0.2, 0, 0, 1),
                height 180ms cubic-bezier(0.2, 0, 0, 1);
    display: block;
    position: relative;
  }

  .rail-dot.closed {
    background: var(--ink);
  }

  /* Today anchor — a subtle tick under the dot whose date is today.
     Independent of .current so the "you are here" and "today" signals compose. */
  .rail-dot.today::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: -0.3125rem;
    transform: translateX(-50%);
    width: 0.375rem;
    height: 1.5px;
    border-radius: 1px;
    background: var(--warm-accent);
    opacity: 0.55;
  }

  .rail-dot.current {
    width: 0.75rem;
    height: 0.75rem;
    border-color: var(--warm-accent);
    background: color-mix(in srgb, var(--warm-accent) 18%, transparent);
    opacity: 0.92;
  }

  .rail-dot.current.closed {
    background: var(--warm-accent);
  }

  .rail-dot-hit:hover .rail-dot {
    opacity: 0.92;
    transform: scale(1.25);
  }

  .rail-dot-hit:hover .rail-dot.current {
    transform: scale(1.15);
  }

  .rail-delete {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.35;
    padding: 0 0.125rem;
    line-height: 1;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                color 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .rail-delete:hover,
  .rail-delete.confirming {
    opacity: 0.92;
    color: var(--warm-accent);
  }
  .rail-delete.confirming {
    background: var(--warm-accent-soft);
    border-radius: 50%;
    width: 1.125rem;
    height: 1.125rem;
    padding: 0;
    font-size: 0.875rem;
    color: var(--warm-accent);
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
    .rail-delete:not(.confirming) {
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
    opacity: 0.92;
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
  }

  .tip-date {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    font-style: normal;
    opacity: 0.55;
    letter-spacing: 0.02em;
  }

  .tip-focus {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .confirm-hint {
    color: var(--warm-accent);
    opacity: 0.75;
    font-style: normal;
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
  }

  .rail-add {
    background: none;
    border: 1.5px dashed color-mix(in srgb, var(--ink) 35%, transparent);
    border-radius: 50%;
    width: 1rem;
    height: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-family: "Inter", sans-serif;
    font-size: 0.75rem;
    line-height: 1;
    color: var(--ink);
    opacity: 0.35;
    padding: 0;
    margin-left: 0.125rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                border-color 180ms cubic-bezier(0.2, 0, 0, 1),
                color 180ms cubic-bezier(0.2, 0, 0, 1),
                border-style 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .rail-add:hover {
    opacity: 0.92;
    border-color: var(--warm-accent);
    border-style: solid;
    color: var(--warm-accent);
  }
</style>
