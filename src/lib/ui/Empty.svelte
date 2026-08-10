<!--
  Empty — empty-state block.
  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component visual specs.

  Slots:
    title  → Lora 18px ink × 0.4
    body   → Lora 13px ink × 0.55
    actions → only rendered when `hasActiveFilters` is true. Caller composes
              its own chips + a trailing `<Button variant="subtle">clear all</Button>`.
-->
<script>
  /** @type {{
    hasActiveFilters?: boolean,
    title?: import("svelte").Snippet,
    body?: import("svelte").Snippet,
    actions?: import("svelte").Snippet,
  }} */
  let { hasActiveFilters = false, title, body, actions } = $props();
</script>

<div class="empty" role="status" aria-live="polite">
  {#if title}
    <div class="empty-title">{@render title()}</div>
  {/if}
  {#if body}
    <div class="empty-body">{@render body()}</div>
  {/if}
  {#if hasActiveFilters && actions}
    <div class="empty-actions">{@render actions()}</div>
  {/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.75rem;
    padding-top: 2.5rem;
    padding-bottom: 2.5rem;
  }

  .empty-title {
    font-family: "Lora", serif;
    font-size: 1.125rem;
    line-height: 1.4;
    color: var(--ink);
    opacity: 0.4;
  }

  .empty-body {
    font-family: "Lora", serif;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--ink);
    opacity: 0.55;
    max-width: 28rem;
  }

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    margin-top: 0.25rem;
  }
</style>
