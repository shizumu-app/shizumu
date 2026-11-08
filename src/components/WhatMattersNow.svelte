<script>
  import { onMount, onDestroy } from "svelte";
  import { updateWhatMattersNow } from "../lib/api.js";
  import { focusPropChanged } from "../lib/focus-field-sync.js";

  /** @type {{ pageId: string, value: string | null, readonly: boolean, required: boolean, onValueChange: (text: string) => void, onInput: (text: string) => void, onEnter: () => void }} */
  let { pageId, value = null, readonly = false, required = false, onValueChange = () => {}, onInput: onInputCallback = () => {}, onEnter = () => {} } = $props();

  let text = $state("");
  let inputEl = $state(null);
  let lastSyncedValue = $state("");

  onMount(() => {
    if (required && !value && inputEl) {
      // Guard inside the rAF: the component can unmount between scheduling and
      // running (e.g. navigating away), leaving inputEl null → "reading 'focus'".
      requestAnimationFrame(() => inputEl?.focus());
    }
  });

  onDestroy(() => {
    // Flush: save on unmount
    if (text.trim() && text !== lastSyncedValue) {
      updateWhatMattersNow(pageId, text).catch(() => {});
    }
  });

  // What the field last took from its props. Not $state: it is bookkeeping
  // for the effect below, and reading it there must not re-run it.
  let seenProp = null;

  $effect(() => {
    // Only a genuine external change: another page, or a value that really
    // changed (the other device's edit). Not the same stale prop seen again
    // when the parent replaces its page object (src/lib/focus-field-sync.js).
    const v = value || "";
    const pid = pageId;
    if (!focusPropChanged(seenProp, pid, v)) return;
    seenProp = { pageId: pid, value: v };
    if (v !== text) text = v;
    lastSyncedValue = v;
  });

  function handleInput(e) {
    text = e.target.value;
    onInputCallback(text);
  }

  async function saveNow() {
    try {
      await updateWhatMattersNow(pageId, text);
      lastSyncedValue = text;
      onValueChange(text);
    } catch (err) {
      console.error("Failed to save what matters now:", err);
    }
  }

  function handleBlur() {
    // A blur is not an edit. Saving unconditionally here broadcast "" from
    // every device that ever autofocused an empty field, and on the other
    // device that "" carried a newer clock than the real title. Compare
    // against what was last synced, not against "": a deliberate clear of
    // a title that existed still goes through.
    if (text === lastSyncedValue) return;
    saveNow();
  }

  async function handleKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Release the input before handing off — without this, ProseMirror's
      // view.focus() can race the input's own keydown→keyup cycle and the
      // caret never lands in the editor.
      e.currentTarget.blur();
      // Wait for save to complete before handing off focus to the editor.
      await saveNow();
      onEnter();
    }
  }
</script>

<div class="what-matters" class:filled={text.length > 0}>
  {#if readonly}
    {#if text}
      <p class="what-matters-text">{text}</p>
    {/if}
  {:else}
    <input
      bind:this={inputEl}
      type="text"
      class="what-matters-input selectable"
      placeholder="what matters now"
      value={text}
      oninput={handleInput}
      onblur={handleBlur}
      onkeydown={handleKeydown}
      spellcheck="false"
    />
  {/if}
</div>

<style>
  /* WhatMattersNow lives inside the writing canvas — it uses the editor
     font scale, not the chrome scale, so dimensions match the prose it
     introduces. Padding/min-height in rem so they still scale with --ui-scale. */
  /* "what matters now" heads the page as its title — the focus the
     writing below answers to. It sits at the editor type scale but
     larger (title weight), so it frames the thinking rather than
     reading as another line of prose. */
  .what-matters {
    padding: 0.25rem 0 0.875rem;
    min-height: 2.5rem;
  }

  .what-matters-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-family: var(--canvas-font-family, "Lora", serif);
    font-style: italic;
    font-size: calc(var(--editor-font-size, 17px) * 1.12);
    line-height: 1.3;
    color: var(--ink);
    /* Room under the descenders for the focus rule (global.css). */
    padding: 0 0 0.3125rem;
    /* Long titles hard-clip a glyph at narrow viewports (e.g. 360px store
       screenshots) without this — ellipsis when unfocused; the native
       input scroll takes over while focused/editing. */
    text-overflow: ellipsis;
  }

  /* ink-soft at full strength, like the phone's TitleField: the field's
     0.6 fade times the placeholder's 0.3 left the prompt at about 18%,
     unreadable in every tone (2026-10-31, owner's screenshot). */
  .what-matters-input::placeholder {
    color: var(--ink-soft);
    opacity: 1;
    font-style: italic;
  }

  .filled .what-matters-input {
    color: var(--accent-text);
  }

  .what-matters-text {
    font-family: var(--canvas-font-family, "Lora", serif);
    font-style: italic;
    font-size: calc(var(--editor-font-size, 17px) * 1.12);
    line-height: 1.3;
    color: var(--accent-text);
    margin: 0;
    /* Read-only title (past pages / trail views): clip long titles cleanly
       instead of hard-cutting the final glyph. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
