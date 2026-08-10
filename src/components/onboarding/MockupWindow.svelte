<!--
  MockupWindow — app-window frame primitive for onboarding slides.

  Renders a stylized desktop window (titlebar with traffic-light controls,
  faint shadow, rounded corners) so each slide can host a faithful miniature
  of an app surface inside it.

  Token exception: the traffic-light dots use the macOS hex values
  (#ed6a5e, #f5bf4f, #62c554). These are an intentional, documented exception
  to "use only existing CSS tokens" because they are a recognised visual
  convention for the window-controls metaphor.
-->
<script>
  /** @type {{
    title?: string,
    width?: string,
    height?: string,
    children?: import("svelte").Snippet,
  }} */
  let { title = "shizumu", width = "32rem", height = "20rem", children } = $props();

  let bodyEl = $state(null);
  let overflowing = $state(false);

  $effect(() => {
    const el = bodyEl;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => {
      overflowing = el.scrollHeight > el.clientHeight + 1;
    };
    const observer = new ResizeObserver(check);
    observer.observe(el);
    check();
    return () => observer.disconnect();
  });
</script>

<div
  class="mockup-window"
  style:width={`min(${width}, 100%)`}
  style:height="auto"
  style:min-height={`min(${height}, 60vh)`}
>
  <div class="mockup-titlebar">
    <div class="traffic-lights">
      <span class="dot red"></span>
      <span class="dot yellow"></span>
      <span class="dot green"></span>
    </div>
    <span class="title">{title}</span>
    <div class="titlebar-spacer"></div>
  </div>
  <div class="mockup-body" class:overflowing bind:this={bodyEl}>
    {#if children}{@render children()}{/if}
  </div>
</div>

<style>
  .mockup-window {
    display: flex;
    flex-direction: column;
    background: var(--canvas-bg);
    border-radius: 0.5rem;
    overflow: hidden;
    box-shadow:
      0 1.25rem 3rem color-mix(in srgb, var(--ink) 12%, transparent),
      0 0.25rem 0.75rem color-mix(in srgb, var(--ink) 6%, transparent);
    border: 1px solid var(--horizon);
  }

  .mockup-titlebar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    height: 1.75rem;
    padding: 0 0.75rem;
    background: color-mix(in srgb, var(--ink) 4%, var(--canvas-bg));
    border-bottom: 1px solid var(--horizon);
  }

  .traffic-lights {
    display: flex;
    gap: 0.375rem;
  }

  .dot {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 50%;
    opacity: 0.55;
  }
  .dot.red { background: #ed6a5e; }
  .dot.yellow { background: #f5bf4f; }
  .dot.green { background: #62c554; }

  .title {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    opacity: 0.55;
    color: var(--ink);
    letter-spacing: 0.02em;
  }

  .titlebar-spacer {}

  .mockup-body {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  @media (pointer: coarse) and (max-width: 480px), (pointer: coarse) and (orientation: landscape) and (max-height: 480px) {
    .mockup-window {
      box-shadow: none;
      border: none;
      border-radius: 0;
    }
    .mockup-titlebar {
      display: none;
    }
    .mockup-body {
      overflow: hidden;
    }
    /* Fade only when content genuinely exceeds the body — a fitting
       vignette must not have its last line dimmed for no reason. */
    .mockup-body.overflowing {
      mask-image: linear-gradient(to bottom, black 85%, transparent 100%);
    }
  }
</style>
