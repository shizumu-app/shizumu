<script>
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { getLocalDateStr, getYesterdayStr, getWeekAgoStr } from "../lib/utils.js";
  import ThreadCard from "./ThreadCard.svelte";
  import ThreadPageView from "./ThreadPageView.svelte";
  import { getThread, searchPages } from "../lib/api.js";

  /** @type {{ onNavigatePage: () => void }} */
  let { onNavigatePage } = $props();

  let pages = $state([]);
  let loading = $state(true);
  let searchQuery = $state("");
  let searchResults = $state(null);
  let matchingIds = $state(null);
  let searchDebounce = $state(null);

  // Full page view
  let viewingPage = $state(null);

  onMount(async () => {
    await loadThread();
  });

  onDestroy(() => {
    if (searchDebounce) clearTimeout(searchDebounce);
  });

  async function loadThread() {
    loading = true;
    try {
      pages = await getThread(50, 0);
    } catch (err) {
      console.error("Failed to load thread:", err);
    } finally {
      loading = false;
    }
  }

  function handleSearch(e) {
    searchQuery = e.target.value;
    if (searchDebounce) clearTimeout(searchDebounce);

    if (searchQuery.trim().length === 0) {
      searchResults = null;
      matchingIds = null;
      return;
    }

    searchDebounce = setTimeout(async () => {
      try {
        const results = await searchPages(searchQuery.trim());
        searchResults = results;
        matchingIds = new Set(results.map(r => r.id));
      } catch (err) {
        console.error("Search error:", err);
      }
    }, 200);
  }

  function clearSearch() {
    searchQuery = "";
    searchResults = null;
    matchingIds = null;
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      if (viewingPage) {
        viewingPage = null;
      } else {
        e.preventDefault();
        onNavigatePage();
      }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "ArrowDown") {
      e.preventDefault();
      onNavigatePage();
    }
  }

  // Group pages by relative date
  function groupByDate(pageList) {
    const today = getLocalDateStr();
    const yesterday = getYesterdayStr();
    const weekAgo = getWeekAgoStr();

    const groups = [];
    let currentLabel = null;
    let currentPages = [];

    for (const p of pageList) {
      let label;
      if (p.date === today) label = "today";
      else if (p.date === yesterday) label = "yesterday";
      else if (p.date >= weekAgo) label = "this week";
      else {
        const d = new Date(p.date + "T12:00:00");
        const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
        label = `${months[d.getMonth()]} ${d.getFullYear()}`;
      }

      if (label !== currentLabel) {
        if (currentLabel !== null) {
          groups.push({ label: currentLabel, pages: currentPages });
        }
        currentLabel = label;
        currentPages = [p];
      } else {
        currentPages.push(p);
      }
    }

    if (currentLabel !== null) {
      groups.push({ label: currentLabel, pages: currentPages });
    }

    return groups;
  }

  function isDimmed(pageId) {
    if (!matchingIds) return false;
    return !matchingIds.has(pageId);
  }

  let activeFocuses = $derived(pages.filter(p => p.is_open));
  let closedPages = $derived(pages.filter(p => !p.is_open));
  let groups = $derived(groupByDate(closedPages));
  let resultCount = $derived(searchResults ? searchResults.length : null);
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="thread" in:fade={{ duration: 300 }}>
  <!-- Search bar -->
  <div class="thread-search">
    <input
      type="text"
      class="search-input selectable"
      placeholder="search your writing..."
      value={searchQuery}
      oninput={handleSearch}
      spellcheck="false"
    />
    {#if searchQuery.length > 0}
      <button class="search-clear label" onclick={clearSearch}>×</button>
    {/if}
  </div>

  {#if resultCount !== null}
    <p class="result-count label">{resultCount} page{resultCount !== 1 ? 's' : ''}</p>
  {/if}

  <!-- Focus cards -->
  <div class="thread-scroll">
    {#if loading}
      <!-- quiet loading -->
    {:else if pages.length === 0}
      <p class="empty-state label">nothing here yet.</p>
    {:else}
      <!-- Active (open) focuses section -->
      {#if activeFocuses.length > 0}
        <div class="active-section">
          <h3 class="group-label label">open pages</h3>
          <div class="group-cards">
            {#each activeFocuses as summary (summary.id)}
              <ThreadCard
                {summary}
                dimmed={isDimmed(summary.id)}
                onclick={() => viewingPage = { date: summary.date, pageNumber: summary.page_number, pageId: summary.id }}
              />
            {/each}
          </div>
        </div>
      {/if}

      <!-- Closed focuses grouped by date -->
      {#each groups as group}
        <div class="date-group">
          <h3 class="group-label label">{group.label}</h3>
          <div class="group-cards">
            {#each group.pages as summary (summary.id)}
              <ThreadCard
                {summary}
                dimmed={isDimmed(summary.id)}
                onclick={() => viewingPage = { date: summary.date, pageNumber: summary.page_number, pageId: summary.id }}
              />
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Back to page hint -->
  <div class="back-hint label">
    <button class="back-btn" onclick={onNavigatePage}>↓ back to the page</button>
  </div>
</div>

<!-- Full page view overlay -->
{#if viewingPage}
  <ThreadPageView
    date={viewingPage.date}
    pageNumber={viewingPage.pageNumber}
    pageId={viewingPage.pageId ?? null}
    onClose={() => viewingPage = null}
  />
{/if}

<style>
  .thread {
    width: 100%;
    max-width: 700px;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    background: var(--canvas-bg);
    z-index: 1;
    padding: 24px 48px 0;
    box-sizing: border-box;
  }

  /* Search */
  .thread-search {
    flex-shrink: 0;
    position: relative;
    margin-bottom: 8px;
  }

  .search-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 16px;
    color: var(--ink);
    padding: 12px 0;
    opacity: var(--ink-secondary);
  }

  .search-input::placeholder {
    color: var(--ink);
    opacity: var(--ink-tertiary);
  }

  .search-input:focus {
    opacity: 1;
  }

  .search-clear {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    cursor: pointer;
    font-size: 18px;
    color: var(--ink);
    opacity: 0.4;
    padding: 8px;
  }

  .search-clear:hover {
    opacity: 0.7;
  }

  .result-count {
    opacity: 0.35;
    margin-bottom: 12px;
  }

  /* Scrollable content */
  .thread-scroll {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: none;
    padding-bottom: 40px;
  }

  .thread-scroll::-webkit-scrollbar {
    display: none;
  }

  .empty-state {
    opacity: 0.35;
    padding-top: 40px;
    text-align: center;
  }

  /* Active focuses section */
  .active-section {
    margin-bottom: 28px;
    padding-bottom: 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--horizon) 25%, transparent);
  }

  /* Date groups */
  .date-group {
    margin-bottom: 28px;
  }

  .group-label {
    opacity: 0.6;
    margin-bottom: 10px;
    margin-top: 8px;
    font-weight: 400;
  }

  .group-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Back hint */
  .back-hint {
    flex-shrink: 0;
    padding: 12px 0 20px;
    text-align: center;
  }

  .back-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-family: "Inter", sans-serif;
    font-weight: 400;
    font-size: 12px;
    color: var(--ink);
    opacity: 0.4;
    padding: 8px 16px;
    transition: opacity 200ms ease;
  }

  .back-btn:hover {
    opacity: 0.7;
  }
</style>
