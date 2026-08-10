<!-- src/lib/ui/PagesChip.svelte -->
<!--
  PagesChip — the phone header's page-position trigger. Replaces PageDots:
  instead of one dot per page (illegible past a handful, and gave no title
  context), a single "p. <current>/<total>" chip opens a BottomSheet listing
  the day's pages — number + what-matters-now, current page marked, "+ new
  page" when canNew. Presentation only: no data fetching, same onSelect/onNew
  contract PageDots used (onSelect receives the full focus object; the
  caller resolves it to whatever navigation key it needs).
-->
<script>
  import TriggerChip from "./TriggerChip.svelte";
  import Icon from "./Icon.svelte";
  import BottomSheet from "./BottomSheet.svelte";

  /** @type {{
    focuses: Array<{ id: string, page_number: number, date: string, what_matters_now: string | null }>,
    currentPageNumber: number,
    onSelect: (focus: any) => void,
    onNew?: () => void,
    canNew?: boolean,
  }} */
  let { focuses = [], currentPageNumber, onSelect, onNew = () => {}, canNew = false } = $props();

  let open = $state(false);
</script>

<!-- The wrapper exists so scoped CSS can reach the TriggerChip button and
     dress it in the control language's rest state (hairline pill). Line 2's
     header styling flattens chips to bare text, which read as a static
     label, not a control. -->
<span class="pages-chip">
  <TriggerChip
    label={`page ${currentPageNumber}/${focuses.length}`}
    onClick={() => (open = !open)}
    ariaLabel={open ? "close pages" : "open pages"}
  >
    {#snippet trailing()}
      <span class="caret"><Icon name="chevron-right" /></span>
    {/snippet}
  </TriggerChip>
</span>

<BottomSheet open={open} onClose={() => (open = false)} title="pages">
  <div class="pages-sheet-list">
    {#each focuses as f (f.id)}
      <button
        type="button"
        class="pages-sheet-row"
        class:current={f.page_number === currentPageNumber}
        onclick={() => { onSelect(f); open = false; }}
      >
        <span class="pages-sheet-num">{f.page_number}</span>
        <span class="pages-sheet-title">{f.what_matters_now || "untitled"}</span>
      </button>
    {/each}
    {#if canNew}
      <button
        type="button"
        class="pages-sheet-row pages-sheet-new"
        onclick={() => { onNew(); open = false; }}
      >
        <span class="pages-sheet-title">+ new page</span>
      </button>
    {/if}
  </div>
</BottomSheet>

<style>
  /* Opacity is the shared chevron value; the icon itself carries size. */
  .caret {
    opacity: 0.55;
    display: inline-flex;
  }
  .pages-sheet-list {
    display: flex;
    flex-direction: column;
  }
  .pages-sheet-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    width: 100%;
    min-height: max(var(--touch-target), 44px);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-sm);
    transition: background var(--motion-fast);
  }
  .pages-sheet-row:active {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .pages-sheet-row.current {
    background: var(--warm-accent-soft);
  }
  .pages-sheet-num {
    flex-shrink: 0;
    font-family: "DM Mono", monospace;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.55;
    min-width: 1.25rem;
  }
  .pages-sheet-title {
    flex: 1;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.9375rem;
    color: var(--ink);
    opacity: 0.92;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pages-sheet-new .pages-sheet-title {
    color: var(--warm-accent);
    font-style: normal;
    font-family: "Inter", sans-serif;
  }
</style>
