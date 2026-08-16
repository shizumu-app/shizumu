<script>
  import { fade } from "svelte/transition";
  import { isPhoneViewport, isCoarsePointer } from "../lib/responsive.js";
  import { focusField } from "../lib/focus-field.js";

  /** @type {{ category: string, defaultTitle?: string, position?: {top: number, left: number}, onShare: (title: string) => void, onDismiss: () => void, prefix?: string, confirmLabel?: string }} */
  let { category, defaultTitle = "", position = { top: 0, left: 0 }, onShare, onDismiss, prefix = "pin as", confirmLabel = "pin" } = $props();

  let title = $state(defaultTitle);
  let inputEl = $state(null);

  // Estimated popup dimensions for clamping. Slightly conservative —
  // actual measurement post-mount would be more accurate but the rough
  // bounds keep the popup fully visible on every supported viewport.
  const POPUP_W_PX = 240;
  const POPUP_H_PX = 150;
  const VIEWPORT_PAD = 8;

  // On phones, ignore the cursor position entirely — center horizontally
  // and pin to ~20% from the top so the soft keyboard never covers the
  // input. On larger screens, clamp the supplied position so the popup
  // fits inside the viewport with an 8px gutter on every side.
  let clampedPosition = $derived.by(() => {
    if (typeof window === "undefined") return position;
    if (isPhoneViewport()) {
      return {
        top: Math.max(VIEWPORT_PAD, window.innerHeight * 0.2),
        left: Math.max(VIEWPORT_PAD, (window.innerWidth - POPUP_W_PX) / 2),
      };
    }
    const maxLeft = Math.max(VIEWPORT_PAD, window.innerWidth - POPUP_W_PX - VIEWPORT_PAD);
    const maxTop = Math.max(VIEWPORT_PAD, window.innerHeight - POPUP_H_PX - VIEWPORT_PAD);
    return {
      top: Math.min(Math.max(position.top, VIEWPORT_PAD), maxTop),
      left: Math.min(Math.max(position.left, VIEWPORT_PAD), maxLeft),
    };
  });

  // Desktop (fine pointer): steal focus back from the editor programmatically
  // — the slash-command flow calls editor.chain().focus() synchronously
  // before dispatching the title-prompt event, so the input needs to grab
  // focus after the editor's own focus settles. focusField's rAF handles that.
  //
  // Touch (coarse pointer): do NOT call focus() here at all. A mobile webview
  // only raises the soft keyboard for focus that traces to a direct user
  // gesture — programmatic .focus() on a freshly-mounted overlay is exactly
  // the class of call it refuses to honor (the same failure LineageSelector's
  // search/rename fields had, fixed there by tap-to-type: see isCoarsePointer
  // there). The input renders visibly and is already tappable; the user's own
  // tap on it raises the keyboard.
  $effect(() => {
    if (inputEl && !isCoarsePointer()) focusField(inputEl);
  });

  function handleKeydown(e) {
    if (e.key === "Enter") { e.preventDefault(); onShare(title.trim() || defaultTitle); }
    if (e.key === "Escape") { e.preventDefault(); onDismiss(); }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="popup-overlay" onclick={onDismiss}></div>

<div class="share-popup" style="top: {clampedPosition.top}px; left: {clampedPosition.left}px;" transition:fade={{ duration: 100 }}>
  <span class="popup-cat label">{prefix ? `${prefix} ${category}` : category}</span>
  <input
    bind:this={inputEl}
    type="text"
    class="popup-input selectable"
    bind:value={title}
    onkeydown={handleKeydown}
    placeholder={defaultTitle}
    spellcheck="false"
  />
  <button class="popup-btn" onclick={() => onShare(title.trim() || defaultTitle)}>{confirmLabel}</button>
</div>

<style>
  .popup-overlay {
    position: fixed; inset: 0; z-index: 99;
  }

  .share-popup {
    position: fixed;
    z-index: 100;
    background: var(--canvas-bg);
    border: 1px solid var(--card-border);
    border-radius: 0.5rem;
    box-shadow: 0 0.25rem 1rem var(--card-shadow);
    padding: 0.625rem 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 13.75rem;
  }

  .popup-cat {
    font-size: 0.625rem;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    opacity: 0.35;
  }

  .popup-input {
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.375rem;
    outline: none;
    font-family: "Lora", serif;
    font-size: 0.875rem;
    color: var(--ink);
    padding: 0.375rem 0.625rem;
    transition: border-color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .popup-input:focus {
    border-color: color-mix(in srgb, var(--ink) 12%, transparent);
  }

  .popup-input::placeholder {
    color: var(--ink); opacity: 0.25; font-style: italic;
  }

  .popup-btn {
    align-self: flex-end;
    background: var(--warm-accent);
    color: var(--canvas-bg);
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    font-family: "Inter", sans-serif;
    font-size: 0.75rem;
    padding: 0.3125rem 0.875rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .popup-btn:hover { opacity: 0.92; }
</style>
