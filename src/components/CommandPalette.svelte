<script>
  import { fade } from "svelte/transition";
  import { getLineages, searchPagesForMention } from "../lib/api.js";
  import { buildMentionLabel } from "../lib/mention-label.js";

  /** @type {{ open: boolean, onClose: () => void, onNavigate: (pageId: string) => void }} */
  let { open = false, onClose = () => {}, onNavigate = () => {} } = $props();

  let query = $state("");
  let results = $state([]);
  let selectedIndex = $state(0);
  let inputEl = $state(null);
  let lineagesCache = $state([]);
  let debounceTimer = null;

  async function loadResults(q) {
    try {
      const trimmed = (q || "").trim();
      const [rows, lins] = await Promise.all([
        searchPagesForMention(trimmed, 50),
        lineagesCache.length ? Promise.resolve(lineagesCache) : getLineages().catch(() => []),
      ]);
      if (lins && lins.length) lineagesCache = lins;
      const seen = new Set();
      const next = [];
      for (const row of rows) {
        if (seen.has(row.page_id)) continue;
        seen.add(row.page_id);
        next.push({
          pageId: row.page_id,
          label: buildMentionLabel({ page: row, lineages: lineagesCache }),
        });
      }
      results = next;
      if (selectedIndex >= results.length) selectedIndex = 0;
    } catch {
      results = [];
    }
  }

  function close() {
    query = "";
    results = [];
    selectedIndex = 0;
    onClose();
  }

  function commit() {
    const row = results[selectedIndex];
    if (!row) return;
    const id = row.pageId;
    close();
    onNavigate(id);
  }

  function onInput(e) {
    query = e.currentTarget.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadResults(query), 60);
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) selectedIndex = (selectedIndex + 1) % results.length;
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) selectedIndex = (selectedIndex - 1 + results.length) % results.length;
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  // Auto-load when opened. Fresh fetch — recents may have changed.
  $effect(() => {
    if (open) {
      query = "";
      selectedIndex = 0;
      loadResults("");
      requestAnimationFrame(() => inputEl?.focus());
    } else {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    }
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="palette-overlay" onclick={close} transition:fade={{ duration: 80 }}>
    <div class="palette" onclick={(e) => e.stopPropagation()}>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:this={inputEl}
        type="text"
        class="palette-input selectable"
        placeholder="jump to a page..."
        value={query}
        oninput={onInput}
        onkeydown={onKeydown}
        spellcheck="false"
        autofocus
      />
      <div class="palette-results">
        {#each results as r, i (r.pageId)}
          <button
            class="palette-row"
            class:selected={i === selectedIndex}
            onmousemove={() => selectedIndex = i}
            onclick={() => { selectedIndex = i; commit(); }}
          >
            <span class="palette-arrow">→</span>
            <span class="palette-label">{r.label}</span>
          </button>
        {/each}
        {#if results.length === 0 && query.trim().length > 0}
          <div class="palette-empty label">no matches</div>
        {/if}
        {#if results.length === 0 && query.trim().length === 0}
          <div class="palette-empty label">nothing yet</div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Phone: hide. The Cmd/Ctrl+K palette is keyboard-only; the
     MobileActionBar (pages / memory / settings) covers navigation. */
  @media (pointer: coarse) {
    .palette-overlay {
      display: none !important;
    }
  }

  .palette-overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 25%, transparent);
    z-index: 240;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 14vh;
  }
  .palette {
    width: min(35rem, 90vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--canvas-bg);
    border: 1px solid var(--card-border);
    border-radius: 0.75rem;
    box-shadow: 0 1.5rem 5rem var(--card-shadow-hover),
                0 0.25rem 1rem var(--card-shadow);
    overflow: hidden;
  }
  .palette-input {
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-family: "Lora", serif;
    font-size: 1rem;
    color: var(--ink);
    padding: 0.875rem 1.125rem 0.75rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    transition: border-color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .palette-input:focus {
    border-bottom-color: color-mix(in srgb, var(--ink) 12%, transparent);
  }
  .palette-input::placeholder { color: var(--ink); opacity: 0.35; font-style: italic; }
  .palette-results {
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0;
  }
  .palette-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: "Lora", serif;
    font-size: 0.875rem;
    color: var(--ink);
    opacity: 0.75;
    padding: 0.4375rem 1.125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1),
                opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .palette-row.selected {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    opacity: 0.92;
  }
  .palette-arrow {
    color: var(--warm-accent);
    opacity: 0.55;
    flex-shrink: 0;
  }
  .palette-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .palette-empty {
    padding: 0.875rem 1.125rem;
    opacity: 0.35;
    font-size: 0.75rem;
    font-style: italic;
    font-family: "Lora", serif;
  }
</style>
