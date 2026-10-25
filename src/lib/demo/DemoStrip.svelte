<!--
  The browser demo's own chrome. Not part of the product: it mounts into its
  own container on <body>, never inside #app, so no layout, gesture or scroll
  assumption inside App changes because the demo is running.
-->
<script>
  import Modal from "../ui/Modal.svelte";
  import { DEMO_COPY } from "./copy.js";

  /** @type {{ onStartOver: () => void }} */
  let { onStartOver } = $props();

  let notice = $state(null);
  let confirming = $state(false);
  let introSeen = $state(false);

  // The strip's height while it is a band at the top of the phone shell,
  // written on <html> as --demo-band-h so ShellRoot pads its frame by it
  // (global.css). Measured, not summed by hand: the intro and the notice
  // wrap to a different number of lines at every width. On the desktop the
  // wrapper is display: contents, has no box and measures 0, which is the
  // token's own default.
  //
  // Its own ResizeObserver, guarded, rather than bind:offsetHeight: the
  // binding constructs one unconditionally, and a browser (or jsdom) without
  // it would throw out of the mount and take the whole demo with it. Without
  // one nothing is reserved and the strip overlaps the header again, which
  // is a smaller failure than no demo; every browser the shell targets has
  // ResizeObserver, so in practice that is jsdom.
  let stripEl = $state(null);
  $effect(() => {
    if (!stripEl) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--demo-band-h", `${stripEl.offsetHeight}px`);
    write();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(write) : null;
    observer?.observe(stripEl);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--demo-band-h");
    };
  });

  /** Called by bootstrap.js through the instance mount() returns. */
  export function setNotice(text) {
    notice = text;
  }
</script>

<div class="demo-strip" bind:this={stripEl}>
{#if !introSeen}
  <div class="demo-card" role="status">
    <p>{DEMO_COPY.intro}</p>
    <button type="button" onclick={() => (introSeen = true)}>{DEMO_COPY.ok}</button>
  </div>
{:else if notice}
  <div class="demo-card" role="status">
    <p>{notice}</p>
    <a href="/#download">{DEMO_COPY.install}</a>
    <button type="button" onclick={() => (notice = null)}>{DEMO_COPY.close}</button>
  </div>
{/if}

<div class="demo-pill">
  <span>{DEMO_COPY.label}</span>
  <button type="button" onclick={() => (confirming = true)}>{DEMO_COPY.startOver}</button>
  <a href="/#download">{DEMO_COPY.install}</a>
</div>
</div>

<Modal open={confirming} title={DEMO_COPY.startOver} hideBar={false} onClose={() => (confirming = false)}>
  <p>{DEMO_COPY.startOverConfirm}</p>
  {#snippet actions()}
    <button type="button" onclick={() => (confirming = false)}>{DEMO_COPY.cancel}</button>
    <button type="button" onclick={onStartOver}>
      {DEMO_COPY.startOver}
    </button>
  {/snippet}
</Modal>

<style>
  .demo-pill,
  .demo-card {
    position: fixed;
    right: calc(var(--safe-right, 0px) + 16px);
    bottom: calc(var(--safe-bottom, 0px) + 16px);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--surface, #fff);
    border: 1px solid var(--horizon, rgba(0, 0, 0, 0.12));
    box-shadow: 0 2px 12px var(--card-shadow, rgba(0, 0, 0, 0.08));
    /* Matches the app's own convention for interface labels (CLAUDE.md:
       "DM Mono (interface labels)") — there is no --font-mono token in
       global.css to reach for, only [data-font-family="dm-mono"] switching
       --canvas-font-family (the BODY font), so this names the family the
       same way the rest of the app's chrome does. */
    font-family: "DM Mono", monospace;
    font-size: 12px;
    color: var(--ink-soft, #555);
  }

  .demo-card {
    bottom: calc(var(--safe-bottom, 0px) + 68px);
    max-width: min(420px, calc(100vw - 32px));
    border-radius: var(--radius-lg, 12px);
    font-family: var(--canvas-font-family, "Lora", serif);
    font-size: 14px;
    line-height: 1.45;
  }

  /* On the desktop the wrapper is not a box at all: the pill and the card
     stay fixed at bottom-right exactly as they were. */
  .demo-strip { display: contents; }

  /* On the phone shell the bottom of the screen is the shell's: its tab bar
     (whose last tab, "settings", the bottom-right pill sat on) and the
     editing strip above the keyboard. The top is no freer, since the page
     header carries find and pins at its right edge. So the strip becomes a
     band of its own across the top, under the status area, and the shell
     steps down by its measured height (--demo-band-h, written above) rather
     than having the strip float over a control. The marker is .shell-root
     rather than a width query: the shell also boots on coarse tablets, and
     a narrow desktop window still gets the desktop tree, whose bottom-right
     is free. --safe-*, never env(): the insets are defined once in
     global.css (CLAUDE.md, testing rules). --vv-offset-top is ShellRoot's
     own: when a keyboard pans the visible band, the band moves with it. */
  :global(body:has(.shell-root)) .demo-strip {
    position: fixed;
    top: calc(var(--vv-offset-top, 0px) + var(--safe-top, 0px));
    left: 0;
    right: 0;
    z-index: 60;
    display: flex;
    /* The card comes first in the markup (the desktop stacks it above the
       pill); in the band the pill's row leads and the card follows. */
    flex-direction: column-reverse;
    gap: 6px;
    padding: 4px calc(var(--safe-right, 0px) + 16px) 4px calc(var(--safe-left, 0px) + 16px);
    background: var(--canvas-bg, #f5f0e8);
    border-bottom: 1px solid var(--horizon, rgba(0, 0, 0, 0.12));
  }

  :global(body:has(.shell-root)) .demo-pill,
  :global(body:has(.shell-root)) .demo-card {
    position: static;
    box-shadow: none;
  }

  :global(body:has(.shell-root)) .demo-pill {
    justify-content: flex-end;
    gap: 4px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    font-size: 11px;
  }

  /* Each label gets a little room of its own: at 11px the bare text is a
     very small thing to land a thumb on. */
  :global(body:has(.shell-root)) .demo-pill > * {
    padding: 6px 6px;
  }

  :global(body:has(.shell-root)) .demo-card {
    max-width: none;
    margin-bottom: 4px;
  }

  p { margin: 0; }

  button,
  a {
    background: none;
    border: 0;
    padding: 0;
    color: var(--warm-accent, #c44d28);
    font: inherit;
    cursor: pointer;
    text-decoration: none;
    white-space: nowrap;
  }
</style>
