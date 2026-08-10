<script>
  import { updateWhatShifted } from "../lib/api.js";
  import { isPhoneViewport } from "../lib/responsive.js";

  /** @type {{ pageId: string, value: string | null, complete: boolean, readonly: boolean, hasParent: boolean, onClose: () => void }} */
  let { pageId, value = null, complete = false, readonly = false, hasParent = false, onClose = () => {} } = $props();

  let expanded = $state(false);
  let text = $state("");
  let liftPx = $state(0);

  $effect(() => {
    text = value || "";
  });

  $effect(() => {
    if (!expanded || typeof window === "undefined" || !window.visualViewport) return;
    if (!isPhoneViewport()) return;
    const vv = window.visualViewport;
    const update = () => {
      const keyboardPx = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      liftPx = keyboardPx > 80 ? keyboardPx : 0;
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      liftPx = 0;
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  });

  let hasText = $derived(text.trim().length > 0);
  let savedHasText = $derived((value || "").trim().length > 0);

  function toggle() {
    if (readonly) return;
    expanded = !expanded;
  }

  async function submit() {
    const trimmed = text.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    try {
      await updateWhatShifted(pageId, next);
      expanded = false;
      onClose();
    } catch (err) {
      console.error("Failed to save what shifted:", err);
    }
  }

  // Leaving the field is a decision too. A phone has no Escape key and no
  // reason to press Enter on a line it decided not to write, so without
  // this the strip stayed an open input for the rest of the session —
  // a stray caret above the tab bar once the user tapped back into the
  // editor. Unchanged text just collapses; edited text saves on the way out.
  function handleBlur() {
    if (text.trim() === (value || "").trim()) {
      text = value || "";
      expanded = false;
      return;
    }
    submit();
  }

  function handleKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      text = value || "";
      expanded = false;
    }
  }
</script>

<div class="what-shifted" class:filled={savedHasText} class:lifted={liftPx > 0} style:transform={liftPx ? `translateY(-${liftPx}px)` : ""}>
  {#if !expanded}
    <button class="strip-toggle label" onclick={toggle}>
      {#if savedHasText}
        <span class="dot"></span>
        <span class="shifted-text">{text}</span>
      {:else}
        <span class="strip-label">what settled</span>
      {/if}
    </button>
  {:else if !readonly}
    <div class="strip-input-area">
      <input
        type="text"
        class="strip-input selectable"
        bind:value={text}
        onkeydown={handleKeydown}
        onblur={handleBlur}
        spellcheck="false"
        autofocus
      />
    </div>
  {/if}
</div>

<style>
  .what-shifted {
    position: relative;
    transition: transform var(--motion-fast);
  }

  .what-shifted.lifted {
    background: var(--canvas-bg);
    z-index: 30;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    box-shadow: 0 -0.5rem 1.5rem var(--card-shadow);
  }

  .strip-toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.375rem 0 0.625rem;
    line-height: 1.6;
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.8125rem;
    max-width: 22.5rem;
    text-align: left;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .strip-toggle:hover {
    opacity: 0.75;
  }

  .filled .strip-toggle {
    opacity: 0.55;
  }

  .dot {
    display: inline-block;
    width: 0.3125rem;
    height: 0.3125rem;
    border-radius: 50%;
    background-color: var(--warm-accent);
    flex-shrink: 0;
    margin-top: 0.5rem;
  }

  .shifted-text {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.8125rem;
    line-height: 1.6;
    white-space: normal;
    word-break: break-word;
    padding-bottom: 0.125rem;
  }

  .strip-label {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.8125rem;
    line-height: 1.8;
    display: inline-block;
    padding-bottom: 0.25rem;
  }

  .strip-input-area {
    padding: 0.25rem 0 0;
  }

  .strip-input {
    width: 20rem;
    max-width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    outline: none;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--ink);
    padding: 0.375rem 0 0.5rem;
    transition: border-color 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .strip-input:focus {
    border-bottom-color: var(--warm-accent);
  }
</style>
