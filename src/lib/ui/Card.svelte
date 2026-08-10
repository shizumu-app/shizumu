<!--
  Card — list-row container.
  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component visual specs.

  Slots: meta (top row, e.g. lineage + date), default (body), footer.
  The card stays flat: transparent bg, hairline bottom-border, no radius.
  Focused state renders a 2px warm-accent-soft left ring; the `accent`
  prop adds the same kind of strip at lower opacity (continuous-trail rows).
-->
<script>
  /** @type {{
    focused?: boolean,
    dimmed?: boolean,
    accent?: boolean,
    variant?: "flat" | "boxed",
    onClick?: () => void,
    meta?: import("svelte").Snippet,
    footer?: import("svelte").Snippet,
    children?: import("svelte").Snippet,
  }} */
  let {
    focused = false,
    dimmed = false,
    accent = false,
    variant = "flat",
    onClick,
    meta,
    footer,
    children,
  } = $props();

  function handleKeydown(e) {
    if (onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="card"
  class:focused
  class:dimmed
  class:accent={accent && !focused}
  class:boxed={variant === "boxed"}
  class:clickable={!!onClick}
  role={onClick ? "button" : undefined}
  tabindex={onClick ? 0 : undefined}
  aria-current={focused ? "true" : undefined}
  onclick={onClick}
  onkeydown={handleKeydown}
>
  {#if meta}
    <div class="meta">{@render meta()}</div>
  {/if}
  {#if children}
    <div class="body">{@render children()}</div>
  {/if}
  {#if footer}
    <div class="footer">{@render footer()}</div>
  {/if}
</div>

<style>
  .card {
    display: block;
    padding: 0.75rem 0.25rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    background: transparent;
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1);
    position: relative;
  }

  .card.clickable {
    cursor: pointer;
  }

  .card.clickable:hover {
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }

  /* Boxed variant — matches the timeline trail-block.has-chrome look.
     Hairline border, tinted background, 8pt internal padding, radius.
     Used by ThreadCard and PinRow when the list is meant to read as a
     stack of separable artifacts (memory pages/pins lists), not a
     dense journal index. */
  .card.boxed {
    padding: 0.625rem 0.875rem;
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    background: color-mix(in srgb, var(--ink) 1.5%, transparent);
    border-radius: 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    margin-bottom: 0.5rem;
  }
  .card.boxed.clickable:hover {
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }
  .card.boxed.focused {
    border-left: 2px solid var(--warm-accent);
    padding-left: calc(0.875rem - 1px);
  }
  .card.boxed.accent {
    border-left: 2px solid color-mix(in srgb, var(--warm-accent) 50%, transparent);
    padding-left: calc(0.875rem - 1px);
  }

  .card.focused {
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border-left: 2px solid var(--warm-accent);
    padding-left: calc(0.875rem - 2px);
    padding-right: 0.875rem;
  }

  .card.accent {
    border-left: 2px solid color-mix(in srgb, var(--warm-accent) 50%, transparent);
    padding-left: calc(0.875rem - 2px);
    padding-right: 0.875rem;
  }

  .card.dimmed {
    opacity: 0.25;
    pointer-events: none;
  }

  .card:focus-visible {
    outline: none;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.1875rem;
  }

  .body {
    min-width: 0;
  }

  .footer {
    margin-top: 0.375rem;
  }
</style>
