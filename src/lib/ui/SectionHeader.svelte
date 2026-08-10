<!--
  SectionHeader — group / date label.
  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component visual specs.

  Inter 11px, ink × 0.35, lowercase, letter-spacing 0.05em.
  Optional `count` renders as ` · <n>` in DM Mono at ink × 0.25.
-->
<script>
  /** @type {{
    label?: string,
    count?: number,
    children?: import("svelte").Snippet,
  }} */
  let { label, count, children } = $props();
</script>

<h3 class="section-header" aria-level="3">
  <span class="label">
    {#if children}{@render children()}{:else}{label}{/if}
  </span>
  {#if count !== undefined}
    <span class="count" aria-hidden="true"> · {count}</span>
  {/if}
</h3>

<style>
  .section-header {
    margin: 1.75rem 0 0.5rem;
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    font-weight: 500;
    line-height: 1.4;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    color: var(--ink);
  }

  .label {
    opacity: 0.35;
  }

  .count {
    font-family: "DM Mono", monospace;
    opacity: 0.25;
    margin-left: 0.125rem;
  }

  /* Touch devices: bump readability. Section labels on phone need to
     clearly separate groups (trail / date / sort / filter sections in
     the filter sheet, and date-group headers in Memory). A subtle hair
     rule above the header reinforces "new section starts here". */
  @media (pointer: coarse) {
    .section-header {
      margin: 1.5rem 0 0.625rem;
      font-size: 0.875rem;
      font-weight: 600;
      padding-top: 1rem;
      border-top: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
      text-transform: none;
      letter-spacing: 0;
    }
    .section-header:first-child {
      margin-top: 0.5rem;
      padding-top: 0;
      border-top: none;
    }
    .label {
      opacity: 0.7;
      font-family: "Lora", Georgia, serif;
      font-style: italic;
      font-weight: 500;
    }
    .count {
      font-size: 0.75rem;
      opacity: 0.5;
    }
  }
</style>
