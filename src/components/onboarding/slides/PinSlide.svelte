<!--
  PinSlide — the kept artifact. Faithful miniature of the pins surface
  (SharedObjectsPanel / the phone pins sheet): a stacked list of pin rows,
  each tagged with its block type and titled in italic. One row carries
  the accent highlight — the single accent element in this composition.
  Desktop adds the scope rail alongside the list; phone shows the list
  alone, matching the real phone pins sheet.
-->
<script>
  import MockupWindow from "../MockupWindow.svelte";
  import { isPhoneViewport, watchPhoneViewport } from "../../../lib/responsive.js";

  let isPhone = $state(isPhoneViewport());
  $effect(() => {
    const unwatch = watchPhoneViewport((m) => { isPhone = m; });
    return unwatch;
  });
</script>

{#snippet pinList()}
  <div class="pin-row">
    <span class="pin-type">text</span>
    <span class="pin-title">the killer cross-product is pin x trail</span>
  </div>
  <div class="pin-row accent">
    <span class="pin-type">text</span>
    <span class="pin-title">sink lowers the stakes</span>
  </div>
  <div class="pin-row">
    <span class="pin-type">text</span>
    <span class="pin-title">a good pin means something out of context</span>
  </div>
{/snippet}

<section class="slide">
  <h1 class="slide-title">pin</h1>
  <p class="slide-subtitle">
    what matters gets pinned.<br>
    notes, boards, single lines. kept across sessions.
  </p>
  <p class="slide-anchor">your thinking happens on the page. the pins are where you left it.</p>

  <MockupWindow title="shizumu, pins" width="34rem" height="18rem">
    {#if isPhone}
      <div class="pin-canvas phone">
        <div class="pin-list">
          {@render pinList()}
        </div>
      </div>
    {:else}
      <div class="pin-canvas desktop">
        <div class="pin-list">
          {@render pinList()}
        </div>
        <div class="scope-rail">
          <div class="rail-label">pins</div>
          <div class="rail-nav active">all</div>
          <div class="rail-nav">notes</div>
          <div class="rail-nav">boards</div>
          <div class="rail-label">scope</div>
          <div class="rail-nav">this trail</div>
          <div class="rail-nav">inherited</div>
          <div class="rail-nav">global</div>
        </div>
      </div>
    {/if}
  </MockupWindow>

  <p class="slide-caption">a good pin still means something out of context.</p>
</section>

<style>
  /* Display rung 2.75rem is intentionally off-ladder for onboarding hero type. */
  .slide {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
    padding-top: 3rem;
    padding-bottom: 2.5rem;
    max-width: 48rem;
    width: 100%;
    min-width: 0;
    margin: 0 auto;
    animation: slide-in 280ms cubic-bezier(0.2, 0, 0, 1);
  }
  .slide-title {
    font-family: "Lora", Georgia, serif;
    font-weight: 500;
    font-size: 2.75rem;
    letter-spacing: -0.01em;
    margin: 0;
    color: var(--ink);
    opacity: 0.92;
  }
  .slide-subtitle {
    font-family: "Lora", Georgia, serif;
    font-size: 1.0625rem;
    line-height: 1.6;
    opacity: 0.55;
    text-align: center;
    margin: 0;
    max-width: 32rem;
  }
  .slide-anchor {
    font-family: "Lora", Georgia, serif;
    font-size: 1rem;
    font-style: italic;
    opacity: 0.75;
    margin: 0;
    text-align: center;
  }
  .slide-caption {
    font-family: "Lora", Georgia, serif;
    font-size: 0.8125rem;
    font-style: italic;
    opacity: 0.55;
    margin: 0;
    text-align: center;
  }
  @keyframes slide-in {
    from { opacity: 0; transform: translateY(0.5rem); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .slide-title { font-size: 2rem; }
    .slide-subtitle { font-size: 0.9375rem; }
    .slide {
      padding-top: 1.75rem;
      gap: 1.25rem;
      padding-left: var(--space-4);
      padding-right: var(--space-4);
    }
    /* clamp the pin mockup to viewport width so 320px (iphone se) doesn't overflow */
    .slide :global(.mockup-window) {
      max-width: 100% !important;
      box-sizing: border-box;
    }
  }

  .pin-canvas {
    height: 100%;
    min-width: 0;
    padding: 0.875rem 1rem;
    box-sizing: border-box;
  }
  .pin-canvas.desktop {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 0 1rem;
  }
  .pin-canvas.phone {
    display: flex;
  }

  .pin-list {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4375rem;
  }

  .pin-row {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.5rem 0.625rem;
    background: var(--surface);
    border-radius: var(--radius-md);
  }
  .pin-row.accent {
    background: var(--warm-accent-soft);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--warm-accent) 25%, transparent);
  }

  .pin-type {
    flex-shrink: 0;
    font-family: "DM Mono", "JetBrains Mono", monospace;
    font-size: 0.625rem;
    letter-spacing: 0.02em;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.0625rem 0.375rem;
    border: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
    border-radius: 0.25rem;
    line-height: 1.3;
  }

  .pin-title {
    min-width: 0;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--ink);
    opacity: 0.85;
    overflow-wrap: break-word;
  }
  .pin-row.accent .pin-title {
    color: var(--warm-accent);
    opacity: 0.92;
  }

  .scope-rail {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding-left: 0.75rem;
    border-left: 1px solid var(--horizon);
  }
  .rail-label {
    font-family: "Inter", sans-serif;
    font-size: 0.5625rem;
    letter-spacing: 0.06em;
    opacity: 0.35;
    text-transform: lowercase;
    margin-top: 0.5rem;
  }
  .rail-label:first-child { margin-top: 0; }
  .rail-nav {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.75rem;
    opacity: 0.55;
    padding: 0.1875rem 0.375rem;
    border-radius: 0.25rem;
  }
  .rail-nav.active {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    opacity: 0.92;
  }
</style>
