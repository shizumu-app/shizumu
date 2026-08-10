<!-- src/lib/ui/SidebarNavRow.svelte -->
<!--
  SidebarNavRow — clickable navigation row for use inside SidebarShell's
  sidebar slot. Reads --sidebar-density via CSS cascade so compact mode
  scales padding and font-size. Active has neutral and accent variants
  (accent uses warm-accent-soft for continuous-trail selection).
-->
<script>
  /** @type {{
    active?: boolean,
    accent?: boolean,
    count?: number,
    indent?: number,
    tag?: string,
    onClick?: () => void,
    children?: import("svelte").Snippet,
  }} */
  let {
    active = false,
    accent = false,
    count,
    indent = 0,
    tag,
    onClick,
    children,
  } = $props();

  const clickable = $derived(typeof onClick === "function");
  const hasCount = $derived(typeof count === "number");
  const indentStyle = $derived(indent > 0 ? `${indent}rem` : null);

  function handleClick() {
    if (clickable) onClick?.();
  }

  function handleKeydown(e) {
    if (!clickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  }
</script>

{#if clickable}
  <div
    class="sidebar-nav-row clickable"
    class:active
    class:accent
    role="button"
    tabindex="0"
    aria-pressed={active}
    style:padding-left={indentStyle}
    onclick={handleClick}
    onkeydown={handleKeydown}
  >
    <span class="label">{#if children}{@render children()}{/if}</span>
    {#if tag}
      <span class="tag">{tag}</span>
    {/if}
    {#if hasCount}
      <span class="count">· {count}</span>
    {/if}
  </div>
{:else}
  <div
    class="sidebar-nav-row"
    class:active
    class:accent
    style:padding-left={indentStyle}
  >
    <span class="label">{#if children}{@render children()}{/if}</span>
    {#if tag}
      <span class="tag">{tag}</span>
    {/if}
    {#if hasCount}
      <span class="count">· {count}</span>
    {/if}
  </div>
{/if}

<style>
  .sidebar-nav-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: calc(0.8125rem * var(--sidebar-density, 1));
    padding-top: calc(0.25rem * var(--sidebar-density, 1));
    padding-bottom: calc(0.25rem * var(--sidebar-density, 1));
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    border-radius: 0.25rem;
    opacity: 0.55;
    background: transparent;
    color: var(--ink);
    min-height: 2rem;
    user-select: none;
  }

  .sidebar-nav-row.clickable {
    cursor: pointer;
  }

  .sidebar-nav-row.clickable:hover {
    opacity: 0.75;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }

  .sidebar-nav-row.active {
    opacity: 0.92;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }

  .sidebar-nav-row.active.accent {
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
  }

  .sidebar-nav-row.clickable:focus-visible {
    outline: 1px solid var(--warm-accent-soft);
    outline-offset: 2px;
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    font-family: "DM Mono", ui-monospace, monospace;
    font-style: normal;
    font-size: 0.625rem;
    opacity: 0.4;
    flex-shrink: 0;
  }

  .tag {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.5625rem;
    letter-spacing: 0.01em;
    opacity: 0.55;
    flex-shrink: 0;
    padding: 0.0625rem 0.4375rem;
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    border-radius: 0.5rem;
    line-height: 1.4;
    text-transform: lowercase;
    white-space: nowrap;
  }
  .sidebar-nav-row.active.accent .tag {
    border-color: color-mix(in srgb, var(--warm-accent) 35%, transparent);
    color: var(--warm-accent);
    opacity: 0.92;
  }

  @media (pointer: coarse) {
    .sidebar-nav-row {
      min-height: 2.75rem;
    }
  }
</style>
