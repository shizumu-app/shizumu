<!--
  KeyHint — inline keyboard chip.
  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component visual specs.

  Renders each key in `keys` as a small mono-spaced chip joined by `+`,
  followed by ` · <label>` when label is provided.
  ARIA label reads "press <keys> to <label>".
-->
<script>
  /** @type {{
    keys: string[],
    label?: string,
  }} */
  let { keys, label } = $props();

  const ariaLabel = $derived(
    label
      ? `press ${keys.join(" plus ")} to ${label}`
      : `press ${keys.join(" plus ")}`
  );
</script>

<span class="key-hint" aria-label={ariaLabel}>
  {#each keys as key, i (i)}
    {#if i > 0}<span class="plus" aria-hidden="true">+</span>{/if}
    <span class="key">{key}</span>
  {/each}
  {#if label}
    <span class="sep" aria-hidden="true"> · </span>
    <span class="label">{label}</span>
  {/if}
</span>

<style>
  .key-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    line-height: 1.4;
    color: var(--ink);
    opacity: 0.55;
    user-select: none;
  }

  .key {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.25rem;
    padding: 0.125rem 0.25rem;
  }

  .plus {
    opacity: 0.5;
    padding: 0 0.0625rem;
  }

  .sep {
    margin: 0 0.125rem;
    opacity: 0.5;
  }

  .label {
    text-transform: lowercase;
  }

  @media (pointer: coarse) {
    .key-hint { display: none; }
  }
</style>
