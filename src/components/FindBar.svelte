<!--
  FindBar — in-page find and replace (B.5).

  Two modes:
    mode="find"    — single input, navigation only
    mode="replace" — adds a replace input + buttons

  The FindReplace extension owns state (query, matches, activeIdx); this
  component is a thin controller: types → calls setFindQuery; Enter →
  nextFindMatch; Shift-Enter → prevFindMatch; replace + replace-all
  dispatch the corresponding commands.

  Match count comes back via the `shizumu:find-state` window event so this
  component doesn't have to poll editor state.
-->
<script>
  import { onMount, onDestroy } from "svelte";
  import { findCountLabel } from "../lib/editor/find-count-label.js";
  import Button from "../lib/ui/Button.svelte";

  /** @type {{
    editor: any,
    open: boolean,
    mode?: "find" | "replace",
    onClose: () => void,
  }} */
  let { editor, open, mode = "find", onClose } = $props();

  let query = $state("");
  let replacement = $state("");
  let total = $state(0);
  let activeIdx = $state(-1);
  let findInputEl = $state(null);

  // Sync from the plugin's state via the broadcast event.
  function handleFindState(e) {
    if (!e.detail) return;
    total = e.detail.total ?? 0;
    activeIdx = e.detail.activeIdx ?? -1;
    if (e.detail.query !== undefined && e.detail.query !== query) {
      // Don't echo our own input back into our own state; only update if
      // the plugin diverged (e.g., replace-all cleared matches).
      if (!query) query = e.detail.query;
    }
  }

  onMount(() => {
    window.addEventListener("shizumu:find-state", handleFindState);
  });
  onDestroy(() => {
    window.removeEventListener("shizumu:find-state", handleFindState);
    // Clear plugin state on unmount so highlights disappear.
    try {
      editor?.commands.setFindQuery("");
    } catch {}
  });

  // Auto-focus the input when the bar opens.
  $effect(() => {
    if (open && findInputEl) {
      // Pre-populate from active selection if non-empty + on first open.
      if (!query && editor) {
        const sel = editor.state.selection;
        if (!sel.empty) {
          const text = editor.state.doc.textBetween(sel.from, sel.to, " ").trim();
          if (text && text.length < 60) {
            query = text;
            editor.commands.setFindQuery(query);
          }
        }
      }
      requestAnimationFrame(() => findInputEl?.focus());
    }
  });

  function handleQueryInput(e) {
    query = e.target.value;
    editor?.commands.setFindQuery(query);
  }

  function next() {
    if (total === 0) return;
    editor?.commands.nextFindMatch();
  }
  function prev() {
    if (total === 0) return;
    editor?.commands.prevFindMatch();
  }

  function replace() {
    if (total === 0 || activeIdx < 0) return;
    editor?.commands.replaceCurrentMatch(replacement);
    // After replace, advance to the next match so successive replaces
    // walk through occurrences.
    requestAnimationFrame(() => editor?.commands.nextFindMatch());
  }
  function replaceAll() {
    if (total === 0) return;
    editor?.commands.replaceAllMatches(replacement);
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
      return;
    }
  }
</script>

{#if open}
  <div class="find-bar" role="search">
    <input
      bind:this={findInputEl}
      class="find-input selectable"
      type="text"
      placeholder="find"
      bind:value={query}
      oninput={handleQueryInput}
      onkeydown={handleKeydown}
      spellcheck="false"
    />
    <!-- findCountLabel, not four branches here: this bar owns no match
         state, so inline branches could only be exercised by mounting the
         whole component, and the "0 of 3" defect they carried sat unseen
         because of it. See that module's header. -->
    <span class="find-count" aria-live="polite">{findCountLabel(query, total, activeIdx)}</span>
    <button class="find-btn" onclick={prev} aria-label="previous match" title="previous (shift+enter)">↑</button>
    <button class="find-btn" onclick={next} aria-label="next match" title="next (enter)">↓</button>

    {#if mode === "replace"}
      <span class="find-sep">·</span>
      <input
        class="find-input selectable"
        type="text"
        placeholder="replace"
        bind:value={replacement}
        spellcheck="false"
      />
      <Button variant="subtle" onClick={replace}>replace</Button>
      <Button variant="subtle" onClick={replaceAll}>replace all</Button>
    {/if}

    <button class="find-close" onclick={onClose} aria-label="close find">×</button>
  </div>
{/if}

<style>
  /* Phone: hide. The find shortcut is Cmd/Ctrl+F (keyboard-only); on
     touch devices Memory's full-text search covers the same need. */
  @media (pointer: coarse) {
    .find-bar {
      display: none !important;
    }
  }

  .find-bar {
    position: sticky;
    top: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.875rem;
    background: var(--surface);
    border: 1px solid var(--card-border);
    box-shadow: 0 0.5rem 1.5rem var(--card-shadow-hover);
    border-radius: var(--radius-md);
    margin: 0 0 0.5rem;
  }
  .find-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
    outline: none;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.875rem;
    color: var(--ink);
    padding: 0.125rem 0;
    transition: border-color var(--motion-fast);
  }
  .find-input:focus {
    border-bottom-color: var(--warm-accent);
  }
  .find-input::placeholder {
    color: var(--ink);
    opacity: 0.25;
  }
  .find-count {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    color: var(--ink);
    opacity: 0.55;
    letter-spacing: 0.02em;
    white-space: nowrap;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: var(--radius-sm);
    padding: 0.125rem 0.375rem;
  }
  .find-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.7;
    padding: 0.1875rem 0.375rem;
    border-radius: 0.25rem;
    transition: opacity var(--motion-fast), background var(--motion-fast);
  }
  .find-btn:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }
  .find-btn:active {
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }
  .find-btn:focus-visible,
  .find-close:focus-visible {
    outline: 2px solid var(--warm-accent);
    outline-offset: 2px;
  }
  .find-close {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    color: var(--ink);
    opacity: 0.35;
    padding: 0.125rem 0.25rem;
    line-height: 1;
    transition: opacity var(--motion-fast), background var(--motion-fast);
  }
  .find-close:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }
  .find-close:active {
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }
  .find-sep {
    color: var(--ink);
    opacity: 0.25;
  }
</style>
