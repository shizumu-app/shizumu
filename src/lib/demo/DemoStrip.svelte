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

  /** Called by bootstrap.js through the instance mount() returns. */
  export function setNotice(text) {
    notice = text;
  }
</script>

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
