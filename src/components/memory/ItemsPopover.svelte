<!--
  ItemsPopover — small list anchored on a day's page-count or pin-count chip.
  Lists titles (pages) or kind chip + title (pins). Click an item to open it.
  "see all" jumps to the filtered memory view and closes the popover.
-->
<script>
  import Popover from "../../lib/ui/Popover.svelte";
  import { pinKind } from "../../lib/pin-display.js";

  /** @type {{
    anchor: HTMLElement | null,
    open: boolean,
    kind: "pages" | "pins",
    headerLabel: string,         // e.g. "3 pages · shizumu · 17 may"
    items: Array<any>,           // pages or pins, raw shape
    onOpen: (item: any) => void,
    onSeeAll: () => void,
    onClose: () => void,
  }} */
  let { anchor, open, kind, headerLabel, items = [], onOpen, onSeeAll, onClose } = $props();

  function pageTitle(p) {
    const t = (p?.what_matters_now || p?.title || "").trim();
    return t || "untitled page";
  }
  function pinTitle(pin) {
    if (pin?.title && pin.title.trim()) return pin.title.trim();
    if (typeof pin?.content === "string" && pin.content.trim()) {
      const first = pin.content.split("\n")[0].trim();
      return first.length > 50 ? first.slice(0, 50) + "…" : first || "untitled";
    }
    return "untitled";
  }
</script>

{#if open}
<Popover anchor={anchor} open onClose={onClose} placement="bottom-start" title="items">
  <div class="items-pop">
    <div class="head">{headerLabel}</div>
    <div class="list">
      {#each items as item (item.id)}
        <button
          type="button"
          class="row"
          onclick={() => { onOpen(item); onClose(); }}
        >
          {#if kind === "pins"}
            <span class="kind-chip">{pinKind(item)}</span>
          {/if}
          <span class="title">
            {kind === "pages" ? pageTitle(item) : pinTitle(item)}
          </span>
        </button>
      {/each}
    </div>
    {#if items.length >= 3}
      <button type="button" class="see-all" onclick={() => { onSeeAll(); onClose(); }}>
        ↗ see all in memory
      </button>
    {/if}
  </div>
</Popover>
{/if}

<style>
  .items-pop {
    width: 16rem;
    padding: 0.5rem 0.5rem 0.375rem;
    font-family: "Lora", Georgia, serif;
  }
  .head {
    font-family: "DM Mono", monospace;
    font-size: 0.5rem;
    letter-spacing: 0.05em;
    opacity: 0.35;
    text-transform: lowercase;
    padding: 0.125rem 0.4375rem 0.375rem;
  }
  .list { max-height: 18rem; overflow-y: auto; }
  .row {
    appearance: none;
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    padding: 0.3125rem 0.4375rem;
    border-radius: 0.25rem;
    cursor: pointer;
    display: flex;
    align-items: baseline;
    gap: 0.4375rem;
    font-size: 0.75rem;
  }
  .row:hover { background: color-mix(in srgb, var(--warm-accent) 6%, transparent); }
  .kind-chip {
    font-family: "DM Mono", monospace;
    font-size: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    padding: 0.0625rem 0.3125rem;
    border-radius: 0.25rem;
    opacity: 0.55;
    flex-shrink: 0;
  }
  .title {
    font-style: italic;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink);
    opacity: 0.85;
  }
  .see-all {
    appearance: none;
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    padding: 0.3125rem 0.4375rem;
    margin-top: 0.25rem;
    border-top: 1px solid color-mix(in srgb, var(--ink) 4%, transparent);
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
    color: var(--warm-accent);
    opacity: 0.75;
    cursor: pointer;
  }
  .see-all:hover { opacity: 1; }
</style>
