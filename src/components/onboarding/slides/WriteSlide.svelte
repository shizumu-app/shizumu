<!--
  WriteSlide — the page is the writing surface. Faithful miniature of
  Page.svelte: what-matters above, editor body in the middle (highlighted
  in warm-accent so the user maps "where you think" to a visible region),
  what-settled closing the day below. The bottom region is hidden on
  continuous trails in the actual app; we show it here because the slide
  is the user's first look at the discrete-trail surface they'll write on.
-->
<script>
  import MockupWindow from "../MockupWindow.svelte";
</script>

<section class="slide">
  <h1 class="slide-title">write</h1>
  <p class="slide-subtitle">
    the page is where you think.<br>
    what matters sits above the page, what settled closes the day.
  </p>

  <MockupWindow title="shizumu" width="32rem" height="20rem">
    <div class="write-canvas">
      <div class="write-page">
        <div class="region region-what-matters">
          <span class="region-label">what matters now</span>
          <div class="what-matters-input">one thought, then return</div>
        </div>
        <div class="region region-editor highlight">
          <div class="editor-title">thinking about how writing shapes ideas</div>
          <div class="editor-line">the best ideas come when you stop trying to organize them.</div>
          <div class="editor-line">the act of filing kills the act of thinking.</div>
          <div class="editor-line">three things became clear today:</div>
        </div>
        <div class="region region-settled">
          <span class="region-label">what settled</span>
        </div>
      </div>
    </div>
  </MockupWindow>

  {#if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches)}
    <aside class="touch-tip" role="note" aria-label="touch tip">
      <span class="touch-tip-label">on touch</span>
      <span class="touch-tip-body">
        tap the left margin of a paragraph to reveal block actions
        (pin, insert, copy, delete). long-press to drag. swipe from
        the right edge for a new page.
      </span>
    </aside>
  {/if}
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
    /* clamp the write mockup to viewport width so 320px (iphone se) doesn't overflow */
    .slide :global(.mockup-window) {
      max-width: 100% !important;
      box-sizing: border-box;
    }
  }

  .write-canvas {
    height: 100%;
    display: flex;
    justify-content: center;
    padding: 1rem 1.5rem;
  }
  .write-page {
    width: 100%;
    max-width: 90%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .region {
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    position: relative;
  }
  .region.highlight {
    background: color-mix(in srgb, var(--warm-accent) 6%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--warm-accent) 40%, transparent);
  }
  .region-label {
    font-family: "Inter", sans-serif;
    font-size: 0.5625rem;
    letter-spacing: 0.05em;
    color: var(--warm-accent);
    opacity: 0.75;
    text-transform: lowercase;
  }
  .what-matters-input {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.75rem;
    opacity: 0.55;
    margin-top: 0.25rem;
  }
  .editor-title {
    font-family: "Lora", Georgia, serif;
    font-size: 0.875rem;
    color: var(--warm-accent);
    opacity: 0.92;
    margin-bottom: 0.375rem;
    max-width: 100%;
    overflow-wrap: break-word;
  }
  .editor-line {
    font-family: "Lora", Georgia, serif;
    font-size: 0.8125rem;
    opacity: 0.75;
    line-height: 1.5;
    max-width: 100%;
    overflow-wrap: break-word;
  }
  .touch-tip {
    margin: 1.5rem auto 0;
    max-width: 100%;
    width: 28rem;
    padding: 0.75rem 1rem;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-md);
    box-shadow: 0 0.25rem 0.75rem var(--card-shadow);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    text-align: left;
  }
  .touch-tip-label {
    font-family: "Inter", sans-serif;
    font-size: 0.625rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: lowercase;
    color: var(--warm-accent);
    opacity: 0.85;
  }
  .touch-tip-body {
    font-family: "Lora", Georgia, serif;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.85;
    line-height: 1.5;
  }
</style>
