<!--
  BrandSlide — the opening stanza. Four verbs as the canon's lead, paired
  with a hero mockup of the app's main writing surface so the user sees
  what shizumu actually looks like before opening it.
-->
<script>
  import MockupWindow from "../MockupWindow.svelte";
</script>

<section class="slide">
  <h1 class="slide-title">shizumu</h1>
  <p class="slide-subtitle">
    write to think.<br>
    pin what matters.<br>
    trail what continues.<br>
    the rest sinks.
  </p>

  <MockupWindow title="shizumu" width="30rem" height="18rem">
    <div class="brand-canvas">
      <div class="brand-page-column">
        <div class="what-matters-mini">what matters now</div>
        <div class="page-snippet">today felt like clarity arriving slowly</div>
        <div class="page-snippet">three things became clear:</div>
        <div class="page-snippet faint">shape comes from constraint</div>
        <div class="page-snippet faint">a page that sinks lets you write to think</div>
      </div>
    </div>
  </MockupWindow>
</section>

<style>
  /*
    Shared onboarding slide layout + typography. Title sits at 2.75rem,
    one rung above the standard type ladder — a display rung extended
    for onboarding hero typography per the v0.4 refresh.
  */
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
    /* clamp the brand mockup to viewport width so 320px (iphone se) doesn't overflow */
    .slide :global(.mockup-window) {
      max-width: 100% !important;
      box-sizing: border-box;
    }
  }

  .brand-canvas {
    height: 100%;
    display: flex;
    justify-content: center;
    padding-top: 1.5rem;
  }
  .brand-page-column {
    width: 60%;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }
  .what-matters-mini {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.75rem;
    color: var(--warm-accent);
    opacity: 0.75;
    padding-bottom: 0.375rem;
    border-bottom: 1px dashed color-mix(in srgb, var(--warm-accent) 30%, transparent);
  }
  .page-snippet {
    font-family: "Lora", Georgia, serif;
    font-size: 0.8125rem;
    opacity: 0.75;
    color: var(--ink);
  }
  .page-snippet.faint { opacity: 0.4; }
</style>
