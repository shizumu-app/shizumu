<script>
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { Editor } from "@tiptap/core";
  import { READONLY_EXTENSIONS } from "../lib/render/shared-extensions.js";
  import { getPage, createLineage, setFocusLineage } from "../lib/api.js";
  import { getLocalDateStr } from "../lib/utils.js";

  /** @type {{ date: string, pageNumber: number, onClose: () => void, onContinue: () => void }} */
  let { date, pageNumber, onClose, onContinue = () => {} } = $props();

  let page = $state(null);
  let lines = $state([]);
  let loading = $state(true);
  let contentEl = $state(null);
  let previewEditor = $state(null);
  let editorMounted = $state(false);

  // Continue-the-thread (N1). A past page is done; trying to write on it is the
  // collision. We surface a quiet bar only when the user actually attempts an
  // edit (a printable keystroke — readers don't press letter keys). For an
  // untrailed page the bar offers to adopt it in place as a continuous trail's
  // living doc; a page already on a (discrete) trail gets the copy line only.
  let editAttempted = $state(false);
  let showNameDialog = $state(false);
  let newTrailName = $state("");
  let adopting = $state(false);
  let adoptError = $state("");
  let isUntrailed = $derived(!!page && !page.lineage_id);

  function focusOnMount(node) { node.focus(); }

  // Adopt this page in place as the canonical doc of a new continuous trail.
  // No content copy — setFocusLineage just repoints lineage_id, preserving the
  // single-doc invariant; the page then reads as continuous (and therefore
  // editable), so we hand off to the editor.
  async function adopt() {
    const name = newTrailName.trim();
    if (!name || adopting || !page) return;
    adopting = true;
    adoptError = "";
    try {
      const lin = await createLineage(name, "continuous", null);
      await setFocusLineage(page.id, lin.id);
      onContinue();
    } catch (err) {
      console.error("continue-the-thread adoption failed:", err);
      adoptError = String(err) === "lineage_name_taken" ? "a trail by that name already exists" : "couldn't start the trail";
      adopting = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      if (showNameDialog) { showNameDialog = false; return; }
      onClose();
      return;
    }
    if (editAttempted || showNameDialog) return;
    const t = /** @type {HTMLElement} */ (e.target);
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    const editKey = e.key === "Enter" || e.key === "Backspace" || e.key === "Delete";
    if (printable || editKey) editAttempted = true;
  }

  onMount(async () => {
    try {
      const result = await getPage(date, pageNumber);
      if (result) {
        page = result.page;
        lines = result.lines;
      }
    } catch (err) {
      console.error("Failed to load page:", err);
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    if (previewEditor) { previewEditor.destroy(); previewEditor = null; }
  });

  // Mount TipTap after content div renders
  $effect(() => {
    if (page?.content_json && contentEl && !editorMounted) {
      editorMounted = true;
      let content;
      try { content = JSON.parse(page.content_json); } catch { content = page.content_json; }
      previewEditor = new Editor({
        element: contentEl,
        extensions: READONLY_EXTENSIONS,
        content,
        editable: false,
      });
    }
  });

  function formatDate(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" transition:fade={{ duration: 200 }} onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="page-view" onclick={(e) => e.stopPropagation()}>
    {#if loading}
      <p class="pv-status label">loading...</p>
    {:else if !page}
      <p class="pv-status label">page not found</p>
    {:else}
      <div class="pv-header">
        <span class="pv-date label">{formatDate(page.date)}</span>
        <button class="pv-continue" onclick={() => { onContinue(); }}>open in editor →</button>
        <button class="pv-close" onclick={onClose}>×</button>
      </div>

      {#if editAttempted}
        <div class="pv-collision" transition:fade={{ duration: 160 }}>
          {#if showNameDialog}
            <span class="pv-collision-text">name the thread this becomes.</span>
            <input
              class="pv-name-input"
              type="text"
              placeholder="name this trail"
              bind:value={newTrailName}
              oninput={() => { adoptError = ""; }}
              onkeydown={(e) => { if (e.key === "Enter") adopt(); }}
              use:focusOnMount
            />
            <button class="pv-collision-action" disabled={adopting || !newTrailName.trim()} onclick={adopt}>continue</button>
          {:else}
            <span class="pv-collision-text">this page is done. today is on the page.</span>
            {#if isUntrailed}
              <button class="pv-collision-action" onclick={() => { newTrailName = ""; showNameDialog = true; }}>this continues — trail it</button>
            {/if}
          {/if}
        </div>
        {#if showNameDialog}
          <p class="pv-collision-hint" class:error={adoptError}>
            {adoptError || "one living document. it grows as long as you choose."}
          </p>
        {/if}
      {/if}

      {#if page.what_matters_now}
        <p class="pv-matters">{page.what_matters_now}</p>
      {/if}

      {#if page.content_json}
        <div class="pv-content prose" bind:this={contentEl}></div>
      {:else if lines.length > 0}
        <div class="pv-lines">
          {#each lines as line}
            <p class="pv-line">{line.text}</p>
          {/each}
        </div>
      {:else}
        <p class="pv-status label">no content</p>
      {/if}

      {#if page.what_shifted}
        <div class="pv-shifted">
          <span class="pv-dot"></span>
          <span>{page.what_shifted}</span>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0;
    background: color-mix(in srgb, var(--margin-bg) 85%, transparent);
    display: flex; justify-content: center; align-items: flex-start;
    padding-top: 3rem; z-index: 100; overflow-y: auto;
  }

  .page-view {
    width: 100%; max-width: 40.625rem;
    background: var(--canvas-bg);
    border: 1px solid var(--card-border);
    padding: 2rem 2.5rem 2.5rem;
    border-radius: 0.75rem;
    box-shadow: 0 1.5rem 5rem var(--card-shadow-hover),
                0 0.25rem 1rem var(--card-shadow);
    min-height: 9.375rem; margin-bottom: 3rem;
  }

  /* Phone: centered card with side gutters instead of edge-to-edge. */
  @media (pointer: coarse) {
    .overlay {
      align-items: center;
      padding: max(var(--safe-top), 1rem) 1rem max(var(--safe-bottom), 1rem);
    }
    .page-view {
      width: calc(100% - 0px);
      max-width: 100%;
      padding: 1.25rem 1.25rem 1.5rem;
      margin-bottom: 0;
      max-height: calc(100dvh - 2rem);
      overflow-y: auto;
    }
  }

  .pv-status { opacity: 0.35; padding: 1rem 0; }

  .pv-header {
    display: flex; align-items: center; gap: 0.5rem;
    margin-bottom: 1.25rem;
  }
  .pv-date { opacity: 0.35; }
  .pv-continue {
    margin-left: auto;
    background: none; border: none; cursor: pointer;
    font-family: "Inter", sans-serif; font-size: 0.75rem;
    color: var(--warm-accent); opacity: 0.75;
    padding: 0.25rem 0.625rem; border-radius: 0.375rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .pv-continue:hover { opacity: 0.92; background: var(--warm-accent-soft); }
  .pv-close {
    background: none; border: none; cursor: pointer;
    font-size: 1.125rem; color: var(--ink); opacity: 0.35; padding: 0 0.25rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .pv-close:hover { opacity: 0.75; }

  /* Continue-the-thread collision bar — quiet, surfaced only on edit attempt. */
  .pv-collision {
    display: flex; align-items: center; gap: 0.625rem; flex-wrap: wrap;
    padding: 0.625rem 0.875rem;
    margin-bottom: 1rem;
    background: var(--warm-accent-soft);
    border: 1px solid color-mix(in srgb, var(--warm-accent) 22%, transparent);
    border-radius: 0.5rem;
  }
  .pv-collision-text {
    font-family: "Lora", serif; font-style: italic;
    font-size: 0.9375rem; color: var(--ink); opacity: 0.7;
  }
  .pv-collision-action {
    margin-left: auto;
    background: none; cursor: pointer;
    font-family: "Inter", sans-serif; font-size: 0.75rem;
    color: var(--warm-accent); opacity: 0.92;
    border: 1px solid color-mix(in srgb, var(--warm-accent) 35%, transparent);
    padding: 0.3125rem 0.75rem; border-radius: 0.5rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .pv-collision-action:hover:not(:disabled) { opacity: 1; background: color-mix(in srgb, var(--warm-accent) 14%, transparent); }
  .pv-collision-action:disabled { opacity: 0.35; cursor: default; }
  .pv-name-input {
    flex: 1; min-width: 8rem;
    background: var(--canvas-bg);
    border: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
    border-radius: 0.375rem;
    padding: 0.3125rem 0.5rem;
    font-family: "Lora", serif; font-size: 0.875rem; color: var(--ink);
    outline: none;
  }
  .pv-name-input:focus { border-color: color-mix(in srgb, var(--warm-accent) 40%, transparent); }
  .pv-collision-hint {
    margin: -0.5rem 0 1rem; padding: 0 0.875rem;
    font-family: "Lora", serif; font-style: italic;
    font-size: 0.6875rem; color: var(--ink); opacity: 0.4;
  }
  .pv-collision-hint.error { color: var(--warm-accent); opacity: 0.85; font-style: normal; }

  .pv-matters {
    font-family: "Lora", serif; font-style: italic;
    font-size: 1.0625rem; color: var(--warm-accent);
    margin-bottom: 1rem;
  }

  /* Node-shape CSS lives in src/styles/prose.css under `.prose`; the
     surface wrapper above adds class="pv-content prose" so it picks
     them up. Only pv-specific chrome (modal overlay padding, header
     row spacing, the "what shifted" dot) stays here. */

  .pv-lines { margin-bottom: 1rem; }
  .pv-line { font-family: "Lora", serif; font-size: 1.0625rem; line-height: 1.7; color: var(--ink); opacity: 0.92; }

  .pv-shifted {
    display: flex; align-items: center; gap: 0.5rem; padding-top: 1rem;
    font-family: "Lora", serif; font-style: italic; font-size: 0.875rem; color: var(--ink); opacity: 0.55;
  }
  .pv-dot { width: 0.3125rem; height: 0.3125rem; border-radius: 50%; background: var(--warm-accent); flex-shrink: 0; }
</style>
