<!--
  Onboarding — thin slide controller. Hosts six per-slide components
  and handles navigation (keyboard, touch swipe, dashes). Per-slide
  content lives in src/components/onboarding/slides/.
-->
<script>
  import Button from "../lib/ui/Button.svelte";
  import BrandSlide from "./onboarding/slides/BrandSlide.svelte";
  import WriteSlide from "./onboarding/slides/WriteSlide.svelte";
  import PinSlide from "./onboarding/slides/PinSlide.svelte";
  import TrailSlide from "./onboarding/slides/TrailSlide.svelte";
  import SinksSlide from "./onboarding/slides/SinksSlide.svelte";
  import BeginSlide from "./onboarding/slides/BeginSlide.svelte";
  import { markOnboardingComplete } from "../lib/api.js";
  import { SLIDE_SWIPE_PX } from "../lib/gestures.js";

  /** @type {{ onComplete: () => void }} */
  let { onComplete } = $props();

  const slides = [BrandSlide, WriteSlide, PinSlide, TrailSlide, SinksSlide, BeginSlide];
  let index = $state(0);

  function back() { if (index > 0) index--; }
  function next() {
    if (index < slides.length - 1) index++;
    else complete();
  }
  async function complete() {
    try { await markOnboardingComplete(); } catch {}
    onComplete?.();
  }
  function onKeydown(e) {
    if (e.key === "ArrowLeft") back();
    else if (e.key === "ArrowRight" || e.key === "Enter") next();
    else if (e.key === "Escape") complete();
  }

  let touchStartX = null;
  function onTouchStart(e) { touchStartX = e.touches[0].clientX; }
  function onTouchEnd(e) {
    if (touchStartX == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (dx < -SLIDE_SWIPE_PX) next();
    else if (dx > SLIDE_SWIPE_PX) back();
    touchStartX = null;
  }

  let CurrentSlide = $derived(slides[index]);
</script>

<svelte:window onkeydown={onKeydown} />

<div class="onboarding" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
  <header class="titlebar">
    <span class="brand">shizumu</span>
    <Button variant="ghost" onClick={complete}>skip</Button>
  </header>

  <main class="slide-stage">
    {#key index}
      <CurrentSlide />
    {/key}
  </main>

  <footer class="controls">
    <Button variant="ghost" disabled={index === 0} onClick={back}>← back</Button>
    <Button variant="ghost" onClick={next}>
      {index === slides.length - 1 ? "begin →" : "next →"}
    </Button>
  </footer>

  <div class="progress">
    {#each slides as _, i}
      <span class="dash" class:current={i === index}></span>
    {/each}
  </div>
</div>

<style>
  .onboarding {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--canvas-bg);
    color: var(--ink);
  }
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.75rem;
    border-bottom: 1px solid var(--horizon);
  }
  .brand {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    opacity: 0.35;
    letter-spacing: 0.05em;
  }
  .slide-stage {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    justify-content: center;
    min-width: 0;
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.75rem;
  }
  .progress {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    padding: 0.5rem 0 1rem;
  }
  .dash {
    width: 1.5rem;
    height: 1px;
    background: color-mix(in srgb, var(--ink) 12%, transparent);
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .dash.current {
    background: var(--warm-accent);
    opacity: 0.92;
  }

  /* Phone: tighten gutters and respect safe areas so onboarding doesn't
     hug the camera notch / gesture bar. */
  @media (pointer: coarse) {
    .titlebar {
      padding: max(var(--safe-top), 0.75rem) 1rem 0.625rem;
    }
    .controls {
      padding: 0.625rem 1rem;
    }
    .controls :global(.button) {
      min-height: 44px;
      min-width: 44px;
    }
    .progress {
      padding-bottom: calc(var(--safe-bottom) + 1rem);
    }
    .dash {
      height: 3px;
      width: 1.75rem;
      border-radius: 2px;
    }
    .slide-stage {
      padding: 0;
    }
  }

</style>
