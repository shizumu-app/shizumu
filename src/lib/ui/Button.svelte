<!--
  Button — action trigger.
  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component visual specs.

  Variants are intentional, never default-implicit. Every call site declares
  its intent: `ghost` (no chrome), `subtle` (ink-tint on hover), `accent`
  (warm accent, sparingly).
-->
<script>
  /** @type {{
    variant?: "ghost" | "subtle" | "accent",
    disabled?: boolean,
    loading?: boolean,
    type?: "button" | "submit" | "reset",
    ariaLabel?: string,
    onClick?: (e: MouseEvent) => void,
    children?: import("svelte").Snippet,
  }} */
  let {
    variant = "ghost",
    disabled = false,
    loading = false,
    type = "button",
    ariaLabel,
    onClick,
    children,
  } = $props();
</script>

<button
  class="btn"
  class:ghost={variant === "ghost"}
  class:subtle={variant === "subtle"}
  class:accent={variant === "accent"}
  class:loading
  {type}
  disabled={disabled || loading}
  aria-disabled={disabled || undefined}
  aria-busy={loading || undefined}
  aria-label={ariaLabel}
  onclick={onClick}
>
  {#if loading}
    <span class="spinner" aria-hidden="true">··</span>
  {:else if children}
    {@render children()}
  {/if}
</button>

<style>
  .btn {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    /* Roomier, legible tap target. Radius matches the TriggerChip family
       (0.5rem) so every button-like control shares one corner language. */
    padding: 0.4375rem 0.8125rem;
    min-height: 2rem;
    border: none;
    border-radius: var(--radius-md);
    font-family: "Inter", sans-serif;
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--ink);
    background: transparent;
    cursor: pointer;
    user-select: none;
    transition: background var(--motion-fast),
                opacity var(--motion-fast),
                transform var(--motion-fast),
                color var(--motion-fast);
  }
  .btn:active {
    transform: scale(0.97);
  }

  .btn.ghost {
    background: transparent;
    opacity: 0.6;
  }
  .btn.ghost:hover {
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    opacity: 0.85;
  }

  .btn.subtle {
    background: color-mix(in srgb, var(--ink) 5%, transparent);
    opacity: 0.8;
  }
  .btn.subtle:hover {
    background: color-mix(in srgb, var(--ink) 9%, transparent);
    opacity: 1;
  }

  .btn.accent {
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
    opacity: 0.95;
  }
  .btn.accent:hover {
    background: color-mix(in srgb, var(--warm-accent) 16%, transparent);
    opacity: 1;
  }

  .btn:focus-visible {
    outline: 2px solid var(--warm-accent);
    outline-offset: 2px;
  }

  .btn.ghost:active,
  .btn.subtle:active {
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }

  @media (pointer: coarse) {
    .btn {
      min-height: max(var(--touch-target), 44px);
      padding: 0.5rem 0.9375rem;
    }
  }

  .btn:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  .btn.loading {
    cursor: wait;
  }

  .spinner {
    font-family: "DM Mono", monospace;
    letter-spacing: 0.1em;
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 0.92; }
  }
</style>
