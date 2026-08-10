<!-- src/lib/ui/MobileNavRow.svelte -->
<!--
  MobileNavRow — full-width row for the phone settings root list. Two-line
  layout (title + blurb), chevron on the right, ≥56px touch target.
  See docs/superpowers/specs/2026-06-03-mobile-settings-stacked-nav-design.md.
-->
<script>
  /** @type {{
    title: string,
    blurb?: string,
    accent?: boolean,
    onClick?: () => void,
  }} */
  let { title, blurb, accent = false, onClick } = $props();

  function handleKeydown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  }
</script>

<button
  type="button"
  class="mobile-nav-row"
  class:accent
  onclick={onClick}
  onkeydown={handleKeydown}
>
  <span class="text">
    <span class="title">{title}</span>
    {#if blurb}
      <span class="blurb">{blurb}</span>
    {/if}
  </span>
  <span class="chev" aria-hidden="true">›</span>
</button>

<style>
  .mobile-nav-row {
    appearance: none;
    border: none;
    background: transparent;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 3.5rem;
    padding: 0.875rem 1rem;
    text-align: left;
    color: var(--ink);
    cursor: pointer;
    border-radius: 0.5rem;
    transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1);
  }
  .mobile-nav-row:hover,
  .mobile-nav-row:active {
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }
  .mobile-nav-row:focus-visible {
    outline: 2px solid var(--warm-accent-soft);
    outline-offset: -2px;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    flex: 1;
    min-width: 0;
  }
  .title {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 1rem;
    line-height: 1.3;
    color: var(--ink);
    opacity: 0.92;
  }
  .mobile-nav-row.accent .title {
    color: var(--warm-accent);
    opacity: 1;
  }
  .blurb {
    font-family: "Lora", Georgia, serif;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--ink);
    opacity: 0.55;
  }
  .chev {
    font-family: "DM Mono", ui-monospace, monospace;
    font-size: 1rem;
    color: var(--ink);
    opacity: 0.4;
    flex-shrink: 0;
  }
</style>
