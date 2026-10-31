<!--
  The three roots, in the one bottom slot.

  Re-tapping the root you are already on is deliberately inert. The
  obvious implementation fires onSelect every tap, and the host then
  resets that root's push stack — so tapping "memory" while reading a day
  throws the day away. Making it a no-op here means no host has to
  remember the special case.
-->
<script>
  /** @type {{
    tabs?: Array<{id: string, label: string}>,
    active?: string,
    onSelect?: (id: string) => void,
  }} */
  let { tabs = [], active = "", onSelect } = $props();

  function choose(id) {
    if (id === active) return;
    onSelect?.(id);
  }
</script>

<nav class="shell-tabbar" aria-label="sections">
  {#each tabs as tab (tab.id)}
    <button
      class="shell-tab"
      class:active={tab.id === active}
      type="button"
      data-tab-id={tab.id}
      aria-current={tab.id === active ? "page" : null}
      onclick={() => choose(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</nav>

<style>
  .shell-tabbar {
    display: flex;
    align-items: stretch;
    height: 100%;
  }

  .shell-tab {
    flex: 1 1 0;
    min-height: var(--tap);
    background: none;
    border: none;
    color: var(--ink-soft);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    line-height: var(--leading-xs);
    cursor: pointer;
  }

  .shell-tab.active {
    color: var(--accent-text);
  }
  /* Visual pass (2026-10-30): a press shows, and the tab you are on reads
     a touch firmer than the colour alone says. */
  .shell-tab {
    border-radius: var(--radius-md);
    transition: background-color var(--motion-fast), color var(--motion-fast);
  }
  .shell-tab:active { background: var(--press-tint); }
  .shell-tab.active { font-weight: 500; }
</style>
