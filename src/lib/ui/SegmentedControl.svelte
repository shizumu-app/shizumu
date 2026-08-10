<!--
  SegmentedControl — exclusive choice among 2-5 options.
  One hairline container; the active segment gets the accent wash. Replaces
  Chip-as-radio (Settings tone/font/scale) and loose TriggerChip tab rows.
-->
<script>
  /** @type {{
    options: Array<{ value: string, label: string }>,
    value: string,
    onChange?: (value: string) => void,
    ariaLabel?: string,
  }} */
  let { options = [], value = $bindable(""), onChange, ariaLabel } = $props();

  function select(v) {
    if (v === value) return;
    value = v;
    onChange?.(v);
  }

  function handleKeydown(e) {
    if (!options.length) return;
    const idx = options.findIndex((o) => o.value === value);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      select(options[(idx + 1) % options.length].value);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      select(options[(idx - 1 + options.length) % options.length].value);
    }
  }
</script>

<div class="seg" role="radiogroup" tabindex="-1" aria-label={ariaLabel} onkeydown={handleKeydown}>
  {#each options as opt, i}
    <button
      type="button"
      class="seg-btn"
      class:active={opt.value === value}
      role="radio"
      aria-checked={opt.value === value}
      tabindex={opt.value === value || (i === 0 && !options.some((o) => o.value === value)) ? 0 : -1}
      onclick={() => select(opt.value)}
    >{opt.label}</button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    gap: 0.125rem;
    padding: 0.125rem;
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    border-radius: var(--radius-md);
  }
  .seg-btn {
    appearance: none;
    border: none;
    background: transparent;
    padding: 0.3125rem 0.6875rem;
    min-height: 1.75rem;
    border-radius: calc(var(--radius-md) - 0.125rem);
    font-family: "Inter", sans-serif;
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--ink);
    opacity: 0.6;
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--motion-fast), color var(--motion-fast), opacity var(--motion-fast);
  }
  .seg-btn:hover { opacity: 0.85; }
  .seg-btn:active { background: color-mix(in srgb, var(--warm-accent) 12%, transparent); }
  .seg-btn.active {
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
    opacity: 1;
  }
  .seg-btn:focus-visible {
    outline: 2px solid var(--warm-accent);
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    .seg-btn {
      min-height: max(calc(var(--touch-target) - 0.25rem), 40px);
      padding: 0.4375rem 0.75rem;
    }
  }
</style>
