<!--
  BeginSlide — the shortcuts panel that closes onboarding. The cheat-sheet
  IS the mockup; type scale is enhanced to match the rest of the deck.
  Coarse pointers (phone/tablet) get no use for a keyboard cheat-sheet, so
  under `(pointer: coarse) and (max-width: 480px)` the subtitle and content
  swap for touch-native hints — how to move between slides and where the
  app's own navigation lives. Fine pointers see the keys list unchanged.
-->
<script>
  import KeyHint from "../../../lib/ui/KeyHint.svelte";
</script>

<section class="slide">
  <h1 class="slide-title">begin</h1>
  <p class="slide-subtitle subtitle-fine">a few keys to know.</p>
  <p class="slide-subtitle subtitle-touch">how to move.</p>
  <div class="shortcut-list">
    <div class="shortcut-row"><KeyHint keys={["/"]} /><span>tools</span></div>
    <div class="shortcut-row"><KeyHint keys={["↗"]} /><span>pin what matters</span></div>
    <div class="shortcut-row"><KeyHint keys={["ctrl", "↑"]} /><span>open memory</span></div>
    <div class="shortcut-row">
      <span class="key-pair">
        <KeyHint keys={["ctrl", "←"]} />
        <KeyHint keys={["ctrl", "→"]} />
      </span>
      <span>navigate pages</span>
    </div>
    <div class="shortcut-row"><KeyHint keys={["ctrl", ","]} /><span>settings</span></div>
  </div>
  <div class="touch-hints">
    <div class="touch-hint-row">swipe left or right to move between slides</div>
    <div class="touch-hint-row">pages, memory and settings live in the bottom bar</div>
    <div class="touch-hint-row">swipe up on the page to open memory</div>
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
  }

  /* Fine pointer (desktop/laptop, incl. narrow desktop windows) sees the
     keys list; only a genuinely touch-sized coarse pointer swaps to the
     touch-native hints below. */
  .subtitle-touch { display: none; }
  .touch-hints { display: none; }

  .shortcut-list {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    margin-top: 1rem;
  }
  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    justify-content: space-between;
    min-width: 18rem;
    font-family: "Lora", Georgia, serif;
    font-size: 1.0625rem;
    opacity: 0.75;
  }
  .key-pair {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  /* Touch hints reuse the shortcut-row cadence (in-flow rows, no card
     chrome) but drop its fixed min-width — full-width/centered so 320px
     phones never overflow, and each row keeps the 44px touch floor. */
  .touch-hint-row {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: max(var(--touch-target), 44px);
    width: 100%;
    max-width: 22rem;
    margin: 0 auto;
    font-family: "Lora", Georgia, serif;
    font-size: 1rem;
    opacity: 0.7;
    text-align: center;
    line-height: 1.5;
  }

  @media (pointer: coarse) and (max-width: 480px), (pointer: coarse) and (orientation: landscape) and (max-height: 480px) {
    .subtitle-fine { display: none; }
    .shortcut-list { display: none; }
    .subtitle-touch { display: block; }
    .touch-hints {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-top: 1rem;
      width: 100%;
    }
  }
</style>
