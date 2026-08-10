<!--
  PinRowActions — STUB for v0.4 UI refresh Task 2.4.
  The full implementation (rename / carry-forward / inject / scope-menu /
  delete buttons) lands in Task 2.4. For Task 2.1 we just thread the props
  through so PinRow has somewhere to mount them.
-->
<script>
  /** @type {{
    pin: any,
    autoInsert?: boolean,
    scopeActions?: Array<{ kind: string, label: string, target: string|null }>,
    scopeMenuOpen?: boolean,
    onRename?: () => void,
    onCarryForward?: () => void,
    onInject?: () => void,
    onDelete?: () => void,
    onScopeChange?: (scope: any) => void,
    onScopeMenuToggle?: () => void,
    onScopeAction?: (action: any) => void,
  }} */
  let {
    pin,
    autoInsert = false,
    scopeActions = [],
    scopeMenuOpen = false,
    onRename,
    onCarryForward,
    onInject,
    onDelete,
    onScopeChange,
    onScopeMenuToggle,
    onScopeAction,
  } = $props();
</script>

<div class="row-actions">
  {#if scopeActions.length > 0}
    <button
      class="row-act"
      onclick={(e) => { e.stopPropagation(); onScopeMenuToggle?.(); }}
      aria-label="scope"
    >⋯</button>
  {/if}
  <button
    class="row-act"
    class:active={autoInsert}
    title="carries forward on tomorrow's page"
    onclick={(e) => { e.stopPropagation(); onCarryForward?.(); }}
    aria-label="carry-forward"
  >↻</button>
  <button
    class="row-act"
    title="inject into current page"
    onclick={(e) => { e.stopPropagation(); onInject?.(); }}
    aria-label="inject"
  >↓</button>
  <button
    class="row-act row-act-del"
    onclick={(e) => { e.stopPropagation(); onDelete?.(); }}
    aria-label="delete"
  >×</button>
</div>

{#if scopeMenuOpen && scopeActions.length > 0}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scope-menu" onclick={(e) => e.stopPropagation()}>
    {#each scopeActions as act}
      <button
        class="scope-opt"
        onclick={(e) => { e.stopPropagation(); onScopeAction?.(act); }}
      >{act.label}</button>
    {/each}
  </div>
{/if}

<style>
  /* Task 2.4 will polish this; for now we mirror the original row-actions
     visual contract so nothing visibly regresses. */
  .row-actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    flex-shrink: 0;
    opacity: 0.55;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  :global(.pin-row-wrap:hover) .row-actions { opacity: 0.92; }
  :global(.card:hover) .row-actions { opacity: 0.92; }

  /* Touch devices can't hover. Make the actions always visible
     so they're discoverable; bigger hit targets for the row icons. */
  @media (pointer: coarse) {
    .row-actions {
      opacity: 0.92;
      gap: 0.25rem;
    }
    .row-act {
      min-width: 2.25rem;
      min-height: 2.25rem;
      padding: 0.375rem 0.5rem;
      font-size: 0.875rem;
      opacity: 0.75;
    }
  }

  .row-act {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.1875rem 0.3125rem;
    border-radius: 0.25rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1),
                color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .row-act:hover {
    opacity: 0.92;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .row-act.active {
    color: var(--warm-accent);
    opacity: 0.92;
  }
  .row-act-del:hover {
    color: var(--warm-accent);
  }

  .scope-menu {
    position: absolute;
    right: 0.375rem;
    top: calc(100% - 0.25rem);
    z-index: 5;
    background: var(--canvas-bg);
    border: 1px solid var(--card-border);
    box-shadow: 0 0.25rem 1rem var(--card-shadow);
    border-radius: 0.5rem;
    padding: 0.25rem;
    display: flex;
    flex-direction: column;
    min-width: 11.25rem;
  }
  .scope-opt {
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 0.375rem 0.5rem;
    border-radius: 0.3125rem;
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.75;
    white-space: nowrap;
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1),
                opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .scope-opt:hover {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    opacity: 0.92;
    color: var(--warm-accent);
  }
</style>
