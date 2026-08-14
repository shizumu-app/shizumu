<script>
  import { updateWhatShifted } from "../lib/api.js";

  /** @type {{ pageId: string, value: string | null, complete: boolean, readonly: boolean, hasParent: boolean, onClose: () => void }} */
  let { pageId, value = null, complete = false, readonly = false, hasParent = false, onClose = () => {} } = $props();

  let expanded = $state(false);
  let text = $state("");

  $effect(() => {
    text = value || "";
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

<div class="what-shifted" class:filled={savedHasText} class:expanded={expanded}>
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
      <!-- The label stays. Swapping it for a bare input made the strip
           vanish on tap: the thing you aimed at was gone and a caret was
           in its place, with nothing left saying what the field was for.
           Keeping it visible means tapping opens the field rather than
           replacing the strip, and it doubles as the placeholder. -->
      <span class="strip-label strip-label-editing">what settled</span>
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

  /* Raise the strip visually when expanded on phone — a card lifting off the
     canvas. Deliberately NO keyboard transform here.
     This strip is `position: relative`, i.e. in normal flow inside
     `.app-shell`, and the shell's height is `var(--app-height)` — the VISIBLE
     viewport, which already excludes the soft keyboard (keyboard-state.js
     keeps it current). The strip is therefore already sitting above the
     keyboard by construction. Translating it up by `--kb-inset` on top of
     that moved it a second full keyboard-height, landing it at the top of the
     screen over the header — reported as "what settled" appearing at the top
     and overlapping "today", and visible in the device screenshot.
     This is the double-counting rule in CLAUDE.md ("the shell reserves the
     inset once; a surface inside it that re-adds it is double-counting"),
     which memory hit before with the status-bar inset. A `position: fixed`
     surface (BottomSheet) is NOT inside the shell's box and does still need
     its own `bottom: var(--kb-inset)` — the distinction is flow vs fixed. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .what-shifted.expanded {
      background: var(--canvas-bg);
      z-index: 30;
      border-radius: var(--radius-md) var(--radius-md) 0 0;
      box-shadow: 0 -0.5rem 1.5rem var(--card-shadow);
    }
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
    display: flex;
    align-items: baseline;
  }

  .strip-input {
    flex: 1 1 auto;
    width: 20rem;
    max-width: 100%;
    min-width: 0;
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

  /* The expanded state replaces the "what settled" label with a bare input.
     Without a placeholder that is a caret alone — on a phone, against an
     empty canvas, with no indication of what is being typed into. Same
     words as the collapsed label so tapping does not change what it says. */
  .strip-label-editing {
    flex: 0 0 auto;
    margin-right: 0.5rem;
    opacity: 0.45;
  }

  .strip-input::placeholder {
    color: color-mix(in srgb, var(--ink) 35%, transparent);
    opacity: 1;
  }

  .strip-input:focus {
    border-bottom-color: var(--warm-accent);
  }
</style>
