<script>
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { navPush, navClose } from "../lib/navstack.js";

  /**
   * TrailIndex — Cmd+K navigation palette for a continuous trail's dayMarkers.
   * Opens a centered searchable list; selecting a day scrolls the editor to it.
   */

  /** @type {{
   *   markers: Array<{ pos: number, date: string, whatMatters: string }>,
   *   onSelect: (date: string) => void,
   *   onClose: () => void,
   * }} */
  let { markers = [], onSelect, onClose } = $props();

  let filter = $state("");
  let activeIndex = $state(0);
  let inputEl = $state(null);

  // Most-recent first.
  let sorted = $derived([...markers].sort((a, b) => (b.date || "").localeCompare(a.date || "")));

  let filtered = $derived(
    filter.trim().length === 0
      ? sorted
      : sorted.filter((m) => {
          const q = filter.toLowerCase();
          return (m.date || "").toLowerCase().includes(q) ||
                 (m.whatMatters || "").toLowerCase().includes(q);
        })
  );

  $effect(() => {
    if (activeIndex >= filtered.length) activeIndex = 0;
  });

  onMount(() => {
    inputEl?.focus();
  });

  // Mounted/unmounted by the caller's {#if showTrailIndex} — register once
  // on mount, same lifecycle-pinned pattern as SharedObjectsPanel. Hardware
  // back closes it via the same onClose the overlay click / Esc already use.
  let trailIndexNavId = null;
  onMount(() => {
    trailIndexNavId = navPush("trail-index", () => {
      trailIndexNavId = null;
      onClose?.();
    }, { hideBar: true });
  });
  onDestroy(() => {
    if (trailIndexNavId !== null) navClose(trailIndexNavId);
  });

  function formatDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + "T00:00:00");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.floor((today - d) / 86400000);
      if (diff === 0) return "today";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toLowerCase();
    } catch {
      return dateStr;
    }
  }

  function choose(marker) {
    if (!marker) return;
    onSelect(marker.date);
    onClose();
  }

  function handleKeydown(e) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length > 0) activeIndex = (activeIndex + 1) % filtered.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length > 0) activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(filtered[activeIndex]);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose} transition:fade={{ duration: 120 }}>
  <div class="panel" onclick={(e) => e.stopPropagation()}>
    <input
      bind:this={inputEl}
      type="text"
      class="panel-input selectable"
      placeholder="jump to a day..."
      bind:value={filter}
      onkeydown={handleKeydown}
      spellcheck="false"
    />

    <div class="panel-list">
      {#if filtered.length === 0}
        <div class="panel-empty">no days match</div>
      {:else}
        {#each filtered as marker, i (marker.pos)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <button
            class="panel-row"
            class:active={i === activeIndex}
            onmouseenter={() => activeIndex = i}
            onclick={() => choose(marker)}
          >
            <span class="row-date">{formatDate(marker.date)}</span>
            <span class="row-sep">·</span>
            <span class="row-focus">{marker.whatMatters || "—"}</span>
          </button>
        {/each}
      {/if}
    </div>

    <div class="panel-hint label">↑↓ navigate · enter open · esc close</div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 25%, transparent);
    z-index: 200;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 18vh;
  }

  .panel {
    width: 26.25rem;
    max-width: calc(100vw - 2rem);
    background: var(--canvas-bg);
    border: 1px solid var(--card-border);
    border-radius: 0.75rem;
    box-shadow: 0 1.5rem 5rem var(--card-shadow-hover),
                0 0.25rem 1rem var(--card-shadow);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .panel-input {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    outline: none;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.9375rem;
    color: var(--ink);
    padding: 0.875rem 1.125rem;
    box-sizing: border-box;
    transition: border-color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .panel-input:focus {
    border-bottom-color: color-mix(in srgb, var(--ink) 12%, transparent);
  }

  .panel-input::placeholder {
    color: var(--ink);
    opacity: 0.35;
  }

  .panel-list {
    max-height: 20rem;
    overflow-y: auto;
    padding: 0.25rem 0;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--ink) 10%, transparent) transparent;
  }

  .panel-empty {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.35;
    padding: 1.125rem;
    text-align: center;
  }

  .panel-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 0.5rem 1.125rem;
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .panel-row.active,
  .panel-row:focus-visible {
    background: var(--warm-accent-soft);
    outline: none;
  }

  .row-date {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    color: var(--ink);
    opacity: 0.55;
    letter-spacing: 0.02em;
    flex-shrink: 0;
    min-width: 4.5rem;
  }

  .row-sep {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    opacity: 0.35;
    flex-shrink: 0;
  }

  .row-focus {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.875rem;
    color: var(--ink);
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .panel-row.active .row-focus {
    color: var(--warm-accent);
  }

  .panel-hint {
    padding: 0.5rem 1.125rem 0.625rem;
    border-top: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    font-size: 0.625rem;
    opacity: 0.35;
    display: flex;
    justify-content: flex-end;
  }
</style>
