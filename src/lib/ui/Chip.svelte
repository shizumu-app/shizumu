<!--
  Chip — filter pill / status pill / removable token.
  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component visual specs.

  Composition rule: chips are clickable when `onClick` is provided. Add the
  trailing × by setting `removable={true}` and providing `onRemove`. Both
  can be present at once (click body to open, × to remove).
-->
<script>
  /** @type {{
    label?: string,
    variant?: "neutral" | "accent",
    removable?: boolean,
    active?: boolean,
    onClick?: () => void,
    onRemove?: () => void,
    children?: import("svelte").Snippet,
  }} */
  let {
    label,
    variant = "neutral",
    removable = false,
    active = false,
    onClick,
    onRemove,
    children,
  } = $props();

  function handleKeydown(e) {
    if (removable && onRemove && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      onRemove();
      return;
    }
    if (onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<span
  class="chip"
  class:accent={variant === "accent"}
  class:active
  class:clickable={!!onClick}
  role={onClick ? "button" : undefined}
  tabindex={onClick ? 0 : undefined}
  aria-pressed={onClick && active ? "true" : undefined}
  onclick={onClick}
  onkeydown={handleKeydown}
>
  <span class="label">
    {#if children}{@render children()}{:else}{label}{/if}
  </span>
  {#if removable && onRemove}
    <button
      class="remove"
      type="button"
      aria-label={`remove ${label ?? "chip"}`}
      onclick={(e) => { e.stopPropagation(); onRemove(); }}
    >×</button>
  {/if}
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    line-height: 1.4;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    color: var(--ink);
    opacity: 0.75;
    user-select: none;
  }

  .chip.clickable {
    cursor: pointer;
  }

  .chip.clickable:hover,
  .chip.active {
    background: color-mix(in srgb, var(--ink) 12%, transparent);
    opacity: 0.92;
  }

  .chip.accent {
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
    opacity: 0.92;
  }

  .chip.accent.clickable:hover,
  .chip.accent.active {
    background: color-mix(in srgb, var(--warm-accent) 14%, transparent);
    opacity: 1;
  }

  .chip:focus-visible {
    outline: 2px solid var(--warm-accent);
    outline-offset: 2px;
  }

  .label {
    display: inline-block;
  }

  .remove {
    appearance: none;
    background: none;
    border: none;
    padding: 0;
    font-family: inherit;
    font-size: 0.8125rem;
    line-height: 1;
    color: inherit;
    opacity: 0.55;
    cursor: pointer;
    margin-left: 0.125rem;
  }

  .remove:hover {
    opacity: 1;
  }

  .remove:focus-visible {
    outline: 2px solid var(--warm-accent);
    outline-offset: 2px;
    border-radius: 0.125rem;
  }

  @media (pointer: coarse) {
    .chip {
      min-height: 2.25rem;
      padding: 0.25rem 0.625rem;
      font-size: 0.75rem;
    }
    .remove {
      position: relative;
    }
    .remove::before {
      /* Invisible 44px hit area centered on the glyph. */
      content: "";
      position: absolute;
      inset: 50% auto auto 50%;
      width: 44px;
      height: 44px;
      transform: translate(-50%, -50%);
    }
  }
</style>
