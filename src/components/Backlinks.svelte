<script>
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { getBacklinksForPage, getLineages } from "../lib/api.js";
  import { buildMentionLabel } from "../lib/mention-label.js";
  import SectionHeader from "../lib/ui/SectionHeader.svelte";

  /** @type {{ pageId: string|null, onNavigate: (id: string) => void }} */
  let { pageId = null, onNavigate = () => {} } = $props();

  let rows = $state([]);
  let loading = $state(false);
  let lineagesCache = $state([]);

  async function load() {
    if (!pageId) { rows = []; return; }
    loading = true;
    try {
      const [back, lins] = await Promise.all([
        getBacklinksForPage(pageId).catch(() => []),
        getLineages().catch(() => []),
      ]);
      lineagesCache = lins;
      const seen = new Set();
      const next = [];
      for (const r of back) {
        if (seen.has(r.page_id)) continue;
        seen.add(r.page_id);
        next.push({ pageId: r.page_id, label: buildMentionLabel({ page: r, lineages: lins }) });
      }
      rows = next;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // Refresh on every page switch + on trail mutations (renames change labels).
  $effect(() => {
    if (pageId) load();
  });

  function handleMutated() { load(); }
  $effect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("shizumu:trail-mutated", handleMutated);
    return () => window.removeEventListener("shizumu:trail-mutated", handleMutated);
  });
</script>

{#if rows.length > 0}
  <div class="backlinks" transition:fade={{ duration: 180 }}>
    <SectionHeader label="referenced from" count={rows.length} />
    <ul class="backlinks-list">
      {#each rows as r (r.pageId)}
        <li>
          <button class="backlink" onclick={() => onNavigate(r.pageId)}>
            <span class="backlink-arrow">→</span>
            <span class="backlink-label">{r.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  /* Slim list of pointers, not full Cards — using ui/Card per row would
     stack hairlines on top of itself and feel heavy for what is really
     just a list of references. SectionHeader for the label, plain
     ghost-button rows for navigation. */
  .backlinks {
    margin: 1.5rem 0 0.5rem;
    padding-top: 0.625rem;
    border-top: 1px dashed color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .backlinks-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .backlink {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: "Lora", serif;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.25rem 0;
    border-radius: 0.1875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .backlink:hover { opacity: 0.92; }
  .backlink-arrow { color: var(--warm-accent); opacity: 0.55; flex-shrink: 0; }
  .backlink-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
</style>
