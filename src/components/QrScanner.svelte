<!--
  QrScanner — camera-based QR decoder used by the pair join flow.

  Wraps @zxing/browser's BrowserMultiFormatReader. Asks the OS for the
  rear camera (facingMode: environment) and decodes continuously until
  a result lands, at which point the parent decides what to do via
  onResult. Errors during decoding are noisy (one per frame with no
  symbol), so only surface fatal stream-open failures via onError.
-->
<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { BrowserMultiFormatReader } from "@zxing/browser";

  /** @type {{ onResult: (text: string) => void, onError?: (msg: string) => void }} */
  let { onResult, onError = () => {} } = $props();

  /** @type {HTMLVideoElement | undefined} */
  let videoEl = $state();
  /** @type {InstanceType<typeof BrowserMultiFormatReader> | undefined} */
  let reader;
  /** @type {{ stop: () => void } | undefined} */
  let controls;
  let errorMsg = $state("");

  // Rationale gate: don't fire getUserMedia (and therefore the OS
  // permission prompt) until the user explicitly taps "start camera".
  // Gives them a moment to read why we want the camera and to know
  // what to allow.
  let started = $state(false);

  async function start() {
    started = true;
    await tick();
    reader = new BrowserMultiFormatReader();
    try {
      controls = await reader.decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoEl,
        (result, _err) => {
          if (result) onResult(result.getText());
        },
      );
    } catch (err) {
      errorMsg = String(err);
      onError(errorMsg);
    }
  }

  onDestroy(() => {
    try {
      controls?.stop();
    } catch {
      // Stream may already be torn down; harmless.
    }
  });
</script>

<div class="scanner">
  {#if !started}
    <div class="rationale">
      <p class="rationale-body">
        the camera reads a qr code from your other device only.
        nothing is stored or sent. your device will ask permission next.
      </p>
      <button type="button" class="rationale-cta" onclick={start}>start camera</button>
    </div>
  {:else}
    <video bind:this={videoEl} muted playsinline></video>
  {/if}
  {#if errorMsg}
    <div class="scanner-error">
      {#if errorMsg.includes("NotAllowedError") || errorMsg.includes("Permission")}
        camera access was denied. switch to the "type words" tab and enter the pair info manually.
      {:else if errorMsg.includes("NotFoundError") || errorMsg.includes("DevicesNotFound")}
        no camera found. use the "type words" tab instead.
      {:else}
        {errorMsg}
      {/if}
    </div>
  {/if}
</div>

<style>
  .scanner {
    width: 100%;
    max-width: 320px;
    margin: 0 auto;
  }
  video {
    width: 100%;
    height: auto;
    border-radius: 0.25rem;
    background: #000;
  }
  .scanner-error {
    margin-top: 0.5rem;
    padding: 0.5rem 0.7rem;
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--margin-bg) 90%, #c44 10%);
    color: color-mix(in srgb, var(--ink) 70%, #c44 30%);
    font-size: 0.8rem;
    line-height: 1.4;
  }
  /* Mobile: let the preview fill the available width so the phrase
     can be aimed at without squinting. 320px is desktop-comfortable
     but cramped on a phone in portrait. */
  @media (max-width: 768px), (orientation: landscape) and (max-height: 480px) {
    .scanner {
      max-width: 100%;
    }
  }

  .rationale {
    padding: 1rem;
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--ink) 3%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    align-items: stretch;
  }
  .rationale-body {
    margin: 0;
    font-family: "Lora", Georgia, serif;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink);
    opacity: 0.85;
  }
  .rationale-cta {
    appearance: none;
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
    border: 1px solid color-mix(in srgb, var(--warm-accent) 25%, transparent);
    border-radius: 0.375rem;
    padding: 0.625rem 0.875rem;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.9375rem;
    cursor: pointer;
    transition: background 120ms cubic-bezier(0.2, 0, 0, 1);
  }
  .rationale-cta:hover {
    background: color-mix(in srgb, var(--warm-accent) 18%, transparent);
  }
</style>
