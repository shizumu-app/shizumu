<!--
  NodeShapePicker — small 4-button segmented chip that picks a flowchart
  node's shape: rect (default), rounded, diamond, circle. The buttons
  show a glyph that mirrors the rendered shape so the user can read the
  picker without a label.
-->
<script>
  /** @type {{
    value: "rect" | "rounded" | "diamond" | "circle",
    onChange: (next: "rect" | "rounded" | "diamond" | "circle") => void,
  }} */
  let { value = "rect", onChange } = $props();

  const shapes = [
    { key: "rect", glyph: "▭", title: "rectangle" },
    { key: "rounded", glyph: "▢", title: "rounded" },
    { key: "diamond", glyph: "◇", title: "diamond" },
    { key: "circle", glyph: "○", title: "circle" },
  ];
</script>

<div class="shape-picker">
  {#each shapes as s (s.key)}
    <button
      type="button"
      class="shape-btn"
      class:active={value === s.key}
      title={s.title}
      aria-label={s.title}
      onclick={() => onChange(s.key)}
    >{s.glyph}</button>
  {/each}
</div>

<style>
  .shape-picker {
    display: inline-flex;
    gap: 0.125rem;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    border-radius: 0.375rem;
    padding: 0.125rem;
  }
  .shape-btn {
    appearance: none;
    background: transparent;
    border: none;
    padding: 0.125rem 0.375rem;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.55;
    cursor: pointer;
    border-radius: 0.25rem;
    line-height: 1.4;
  }
  .shape-btn:hover { opacity: 0.92; }
  .shape-btn.active {
    opacity: 0.92;
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
    color: var(--warm-accent);
  }
</style>
