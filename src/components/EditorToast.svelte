<script>
  import { fade } from "svelte/transition";
  /** @type {{ message: string | null }} */
  let { message } = $props();
</script>

{#if message}
  <div class="editor-toast" transition:fade={{ duration: 180 }}>{message}</div>
{/if}

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
    font-family: "Inter", sans-serif;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.95;
    pointer-events: none;
    user-select: none;
    max-width: 90vw;
  }
</style>
