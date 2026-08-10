<!--
  Divider — hairline rule. 1px @ ink × 0.06.
  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component visual specs.
-->
<script>
  /** @type {{
    vertical?: boolean,
    inset?: number,
  }} */
  let { vertical = false, inset = 0 } = $props();
</script>

<div
  class="divider"
  class:vertical
  style="--inset: {inset}rem"
  role="separator"
  aria-orientation={vertical ? "vertical" : "horizontal"}
></div>

<style>
  .divider {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    flex-shrink: 0;
  }

  .divider:not(.vertical) {
    height: 1px;
    width: calc(100% - var(--inset, 0) * 2);
    margin-left: var(--inset, 0);
    margin-right: var(--inset, 0);
  }

  .divider.vertical {
    width: 1px;
    height: calc(100% - var(--inset, 0) * 2);
    margin-top: var(--inset, 0);
    margin-bottom: var(--inset, 0);
  }
</style>
