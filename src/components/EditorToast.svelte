<script>
  import { fade } from "../lib/motion.js";
  /** @type {{ message: string | null }} */
  let { message } = $props();
</script>

<!-- The region is always mounted and only the band inside it comes and
     goes: a live region inserted already holding its message is announced
     unreliably (the shell Toast's finding; Vercel's guidelines, 2026-10-31). -->
<div class="editor-toast-live" role="status" aria-live="polite">
  {#if message}
    <div class="editor-toast" transition:fade={{ duration: 180 }}>{message}</div>
  {/if}
</div>

<style>
  .editor-toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    background: var(--surface);
    border: 1px solid var(--card-border);
    box-shadow: 0 0.5rem 1.5rem var(--card-shadow-hover);
    border-radius: var(--radius-md);
    padding: 0.5rem 0.875rem;
    font-family: var(--font-prose);
    font-size: 0.75rem;
    color: var(--ink);
    pointer-events: none;
    user-select: none;
    max-width: 90vw;
  }
</style>
