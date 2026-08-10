<!-- src/lib/ui/TriggerChip.svelte -->
<!--
  TriggerChip — large touch-target chip for header triggers, dropdown
  launchers, and bottom-sheet openers. Distinct from the existing dense
  Chip (which is for status/filter pills inside lists).

  Use this for:
  - Page header: today / trail / pins
  - Memory toolbar: mode pills + filters
  - Pin panel toolbar: filter button
  - LineageSelector trigger

  See docs/superpowers/specs/2026-06-05-mobile-ui-overhaul-phase-a-design.md
  § Chip primitive.
-->
<script>
  /** @type {{
    label?: string,
    count?: number,
    active?: boolean,
    onClick?: () => void,
    leading?: import("svelte").Snippet,
    trailing?: import("svelte").Snippet,
    children?: import("svelte").Snippet,
    ariaLabel?: string,
  }} */
  let { label, count, active = false, onClick, leading, trailing, children, ariaLabel } = $props();
</script>

<button
  type="button"
  class="trigger-chip"
  class:active
  aria-pressed={active}
  aria-label={ariaLabel}
  onclick={onClick}
>
  {#if leading}
    <span class="leading">{@render leading()}</span>
  {/if}
  <span class="label">
    <!-- Prefer `label` when set. Passing named snippets (leading/trailing)
         turns the whitespace between them into an implicit (empty) `children`
         snippet — `{#if children}` would then render nothing and swallow the
         label (this was the "pins shows only the icon" bug). -->
    {#if label}{label}{:else if children}{@render children()}{/if}
  </span>
  {#if typeof count === "number"}
    <span class="count">{count}</span>
  {/if}
  {#if trailing}
    <span class="trailing">{@render trailing()}</span>
  {/if}
</button>

<style>
  .trigger-chip {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    /* One interactive-control family: Inter, the same height/radius/padding as
       Button, so chips and buttons read as one system (no Lora-italic, no
       oversized chip). The subtle border is the only thing marking it as a
       toggle/dropdown trigger. */
    padding: 0.4375rem 0.6875rem;
    min-height: 2rem;
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    border-radius: var(--radius-md);
    font-family: "Inter", sans-serif;
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--ink);
    opacity: 0.92;
    cursor: pointer;
    transition: background-color var(--motion-fast), opacity var(--motion-fast), transform var(--motion-fast);
  }
  .trigger-chip:hover {
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }
  .trigger-chip:active {
    transform: scale(0.97);
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }
  .trigger-chip:focus-visible {
    outline: 2px solid var(--warm-accent);
    outline-offset: 2px;
  }
  .trigger-chip.active {
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
    border-color: color-mix(in srgb, var(--warm-accent) 30%, transparent);
    opacity: 1;
  }

  .label {
    /* Don't let the label shrink to zero under flex pressure — these chips
       are short nav triggers ("pins", "filters", "trail map"); collapsing the
       label leaves a bare icon + count with no meaning. */
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .leading,
  .trailing {
    display: inline-flex;
    align-items: center;
  }
  .count {
    font-family: "DM Mono", ui-monospace, monospace;
    font-style: normal;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.55;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.25rem;
    padding: 0.0625rem 0.375rem;
  }
  .trigger-chip.active .count {
    color: var(--warm-accent);
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
    opacity: 1;
  }

  @media (pointer: coarse) {
    .trigger-chip {
      min-height: max(var(--touch-target), 44px);
      padding: 0.5rem 0.75rem;
    }
  }
</style>
