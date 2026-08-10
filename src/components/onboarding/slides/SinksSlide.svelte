<!--
  SinksSlide — the passive default, taught explicitly. Faithful miniature
  of the memory view: search line, mode segmented control, and a couple of
  day cards. No sidebar, no trail chrome — memory itself is the point, not
  where it lives. The volume of writing is not the artifact; pins are.
-->
<script>
  import MockupWindow from "../MockupWindow.svelte";
</script>

<section class="slide">
  <h1 class="slide-title">the rest sinks</h1>
  <p class="slide-subtitle">
    what isn't pinned settles into memory — still there, just not in the way.<br>
    a page that sinks lets you write honestly.
  </p>

  <MockupWindow title="shizumu, memory" width="34rem" height="18rem">
    <div class="sinks-canvas">
      <div class="sinks-search-row">
        <span class="sinks-search">search your writing…</span>
      </div>
      <div class="sinks-seg" role="presentation">
        <span class="seg-opt active">pages</span>
        <span class="seg-opt">trail map</span>
        <span class="seg-opt">pins</span>
      </div>
      <div class="sinks-entries">
        <div class="sinks-entry">
          <span class="entry-date">today</span>
          <div class="entry-card">
            <div class="entry-title">thinking about how writing shapes ideas</div>
            <div class="entry-faded">the act of filing kills the act of thinking.</div>
          </div>
        </div>
        <div class="sinks-entry">
          <span class="entry-date">yesterday</span>
          <div class="entry-card">
            <div class="entry-title">morning reflections</div>
            <div class="entry-faded">three things became clear today.</div>
          </div>
        </div>
      </div>
    </div>
  </MockupWindow>
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
    /* clamp the memory mockup to viewport width so 320px (iphone se) doesn't overflow */
    .slide :global(.mockup-window) {
      max-width: 100% !important;
      box-sizing: border-box;
    }
  }

  .sinks-canvas {
    height: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 0.875rem 1.125rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .sinks-search-row {
    padding-bottom: 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
  }
  .sinks-search {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.8125rem;
    opacity: 0.45;
  }

  /* Segmented control — visual copy of src/lib/ui/SegmentedControl.svelte's
     .seg / .seg-btn. Plain spans, not buttons: a static mockup must not be
     interactive. */
  .sinks-seg {
    display: inline-flex;
    align-self: flex-start;
    gap: 0.125rem;
    padding: 0.125rem;
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    border-radius: var(--radius-md);
  }
  .seg-opt {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    line-height: 1.3;
    padding: 0.25rem 0.5625rem;
    border-radius: calc(var(--radius-md) - 0.125rem);
    color: var(--ink);
    opacity: 0.6;
    white-space: nowrap;
  }
  .seg-opt.active {
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
    opacity: 1;
  }

  .sinks-entries {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .sinks-entry {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .entry-date {
    font-family: "DM Mono", "JetBrains Mono", monospace;
    font-size: 0.625rem;
    opacity: 0.4;
  }
  .entry-card {
    width: 100%;
    max-width: 32ch;
    min-width: 0;
    box-sizing: border-box;
    padding: 0.625rem 0.75rem;
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: 0 0.25rem 0.75rem var(--card-shadow);
    display: flex;
    flex-direction: column;
    gap: 0.1875rem;
  }
  .entry-title {
    font-family: "Lora", Georgia, serif;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.92;
    overflow-wrap: break-word;
  }
  .entry-faded {
    font-family: "Lora", Georgia, serif;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.5;
    overflow-wrap: break-word;
  }
</style>
