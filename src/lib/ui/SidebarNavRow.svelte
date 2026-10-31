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
    expanded?: boolean,
    onToggle?: () => void,
    children?: import("svelte").Snippet,
  }} */
  let {
    active = false,
    accent = false,
    count,
    indent = 0,
    tag,
    onClick,
    // A row with children (memory's trail tree): `expanded` names its
    // state, and ArrowRight / ArrowLeft open and fold it, the keys a tree
    // row answers to. Absent, the row is a leaf and says nothing about it.
    expanded,
    onToggle,
    children,
  } = $props();
  const foldable = $derived(typeof expanded === "boolean" && typeof onToggle === "function");

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
      return;
    }
    if (foldable && ((e.key === "ArrowRight" && !expanded) || (e.key === "ArrowLeft" && expanded))) {
      e.preventDefault();
      onToggle?.();
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
    aria-expanded={foldable ? expanded : undefined}
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
    border-radius: var(--radius-sm, 0.25rem);
    background: transparent;
    /* Quiet by colour, not by fading (the phone's rows; 2026-10-31): at
       0.55 opacity a section name read washed out on every tone. */
    color: var(--ink-soft);
    transition: background-color var(--motion-fast), color var(--motion-fast);
    min-height: 2rem;
    user-select: none;
  }

  .sidebar-nav-row.clickable {
    cursor: pointer;
  }

  .sidebar-nav-row.clickable:hover {
    color: var(--ink);
    background: var(--hover-tint);
  }
  .sidebar-nav-row.clickable:active {
    background: var(--press-tint);
  }

  .sidebar-nav-row.active {
    color: var(--ink);
    background: var(--press-tint);
  }

  .sidebar-nav-row.active.accent {
    background: var(--warm-accent-soft);
    color: var(--accent-text);
  }


  .label {
    /* The row's face, not global.css's `.label` (the interface face),
       which this span's class name also matches: settings and memory
       showed their section names in a slanted DM Mono (2026-10-31). */
    font-family: inherit;
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
    color: var(--ink-soft);
    flex-shrink: 0;
  }

  .tag {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.5625rem;
    letter-spacing: 0.01em;
    color: var(--ink-soft);
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
    color: var(--accent-text);
  }

  @media (pointer: coarse) {
    .sidebar-nav-row {
      min-height: 2.75rem;
    }
  }
</style>
