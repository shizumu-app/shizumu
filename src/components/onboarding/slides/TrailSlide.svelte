<!--
  TrailSlide — the structural through-line. One compact stack illustrates
  both trail modes: a discrete trail (per-day dots, a fresh page each day)
  above a continuous trail (a single dayMarker-stamped living document).
  The trail tag is the composition's one accent thread, matching the real
  app's editorial header (accent text, no box/pill). A reshape strip below
  names v0.3's flexibility: any trail can be renamed, moved, folded,
  deleted without touching the writing inside.
-->
<script>
  import MockupWindow from "../MockupWindow.svelte";
</script>

<section class="slide">
  <h1 class="slide-title">trail</h1>
  <p class="slide-subtitle">
    trails carry one topic across many days.<br>
    nest them. reshape them. the writing inside stays where it is.
  </p>
  <p class="slide-anchor">pin × trail is the executive summary of a project.</p>

  <MockupWindow title="shizumu, trails" width="24rem" height="11rem">
    <div class="trail-canvas">
      <div class="trail-example">
        <div class="trail-breadcrumb">project alpha › shipping</div>
        <div class="trail-rail" aria-hidden="true">
          <span class="trail-dot active"></span>
          <span class="trail-dot"></span>
          <span class="trail-dot"></span>
        </div>
        <div class="trail-day-label">today</div>
        <div class="trail-page-content">
          <div class="trail-page-snippet">today's notes</div>
          <div class="trail-page-snippet faint">a fresh page each day</div>
        </div>
      </div>
      <div class="trail-example">
        <div class="trail-breadcrumb">project alpha › the book</div>
        <div class="trail-day-marker">today · 2026-05-19</div>
        <div class="trail-page-snippet faint">one living document</div>
      </div>
    </div>
  </MockupWindow>

  <div class="reshape-strip" aria-hidden="true">
    <span class="reshape-label">reshape</span>
    <span class="reshape-pill">rename</span>
    <span class="reshape-pill">move under</span>
    <span class="reshape-pill">fold into</span>
    <span class="reshape-pill danger">delete</span>
  </div>
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
    /* clamp the trail mockup to viewport width so 320px (iphone se) doesn't overflow */
    .slide :global(.mockup-window) {
      max-width: 100% !important;
      box-sizing: border-box;
    }
  }

  .trail-canvas {
    height: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 0.75rem 0.875rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .trail-example {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .trail-rail {
    display: flex;
    gap: 0.375rem;
    align-items: center;
    margin-bottom: 0.375rem;
  }
  .trail-dot {
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ink) 25%, transparent);
  }
  .trail-dot.active {
    background: var(--warm-accent);
    opacity: 0.92;
  }
  .trail-day-label {
    font-family: "Inter", sans-serif;
    font-size: 0.5625rem;
    letter-spacing: 0.05em;
    opacity: 0.35;
  }
  .trail-day-marker {
    font-family: "Inter", sans-serif;
    font-size: 0.5625rem;
    letter-spacing: 0.05em;
    opacity: 0.45;
  }
  .trail-page-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .trail-page-snippet {
    font-family: "Lora", Georgia, serif;
    font-size: 0.6875rem;
    opacity: 0.75;
  }
  .trail-page-snippet.faint { opacity: 0.4; }

  /* The trail tag is this composition's one accent thread — matching the
     real editorial header's trail chip (accent text, no box/pill),
     DM Mono for the label feel. */
  .trail-breadcrumb {
    font-family: "DM Mono", "JetBrains Mono", monospace;
    font-size: 0.625rem;
    letter-spacing: 0.03em;
    color: var(--warm-accent);
    opacity: 0.85;
    margin-bottom: 0.25rem;
  }

  .reshape-strip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.4375rem 0.625rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 3%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 6%, transparent);
    margin-top: -0.5rem;
  }
  .reshape-label {
    font-family: "Inter", sans-serif;
    font-size: 0.5625rem;
    letter-spacing: 0.08em;
    opacity: 0.45;
    text-transform: lowercase;
    padding-right: 0.25rem;
  }
  .reshape-pill {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.6875rem;
    opacity: 0.75;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--canvas-bg, transparent);
  }
  .reshape-pill.danger {
    color: var(--warm-accent);
    opacity: 0.85;
  }
</style>
