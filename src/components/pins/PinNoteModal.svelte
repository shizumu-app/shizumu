<!--
  PinNoteModal — text-pin editor (the simple textarea variant).
  Extracted from SharedObjectsPanel.svelte (Task 2.2 of v0.4 UI refresh).

  No TipTap here — a plain textarea bound to the pin's text content. The
  surrounding chrome (head row, provenance, backlinks, action bar) mirrors
  PinArtifactModal so the two modals feel identical to the user; the only
  difference is the body element.

  Like PinArtifactModal, this component intentionally does not use the
  <Modal> primitive: the scope chip + auto-insert toggle in the head row
  can't be expressed inside Modal's single-string title slot.
-->
<script>
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import Chip from "../../lib/ui/Chip.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import { resolvePinDivergence, getPage } from "../../lib/api.js";
  import { navPush, navClose } from "../../lib/navstack.js";

  // Walk a ProseMirror doc and return the first node whose attrs.pinId
  // matches the given id. The note pin's source could be any node
  // type — paragraph, list item, qa pair, etc. — so we just match on
  // the pinId attribute and serialize whatever we find.
  function findNodeWithPinId(node, pinId) {
    if (!node || typeof node !== "object") return null;
    if (node.attrs && node.attrs.pinId === pinId) return node;
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        const hit = findNodeWithPinId(child, pinId);
        if (hit) return hit;
      }
    }
    return null;
  }

  function extractTextFromNode(node) {
    const parts = [];
    const walk = (n) => {
      if (!n) return;
      if (typeof n.text === "string") parts.push(n.text);
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(node);
    return parts.join("");
  }

  async function handleResolveDivergence(action) {
    if (action === "update") {
      if (!pin.source_page_id) {
        alert("source no longer found — pin kept as-is");
        await resolvePinDivergence(pin.id, "keep");
        pin = { ...pin, diverged: false };
        return;
      }
      try {
        const page = await getPage(null, null, pin.source_page_id);
        const raw = page?.content_json;
        const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
        const found = doc ? findNodeWithPinId(doc, pin.id) : null;
        if (!found) {
          alert("source no longer found — pin kept as-is");
          await resolvePinDivergence(pin.id, "keep");
          pin = { ...pin, diverged: false };
          return;
        }
        // Note pins store concatenated text (extracted on render via
        // extractText). Keep that contract on update so the textarea
        // re-renders cleanly without an escaped-JSON detour.
        const newContent = pin.object_type === "note"
          ? extractTextFromNode(found)
          : JSON.stringify(found);
        await resolvePinDivergence(pin.id, "update", newContent);
      } catch (err) {
        console.error("resolve divergence (update) failed:", err);
        alert("source no longer found — pin kept as-is");
        await resolvePinDivergence(pin.id, "keep");
      }
    } else {
      await resolvePinDivergence(pin.id, "keep");
    }
    pin = { ...pin, diverged: false };
  }

  /** @type {{
    pin: any,
    samePage: boolean,
    scopeLabel: string,
    scopeVariant: "neutral" | "accent",
    sourceLabel: string,
    backlinks: Array<{ pageId: string, label: string }>,
    formatRelativeDate: (iso: string) => string,
    onClose: () => void,
    onSave: (text: string, newTitle: string|null, contentChanged: boolean, titleChanged: boolean) => void | Promise<void>,
    onDelete: () => void,
    onToggleAutoInsert: () => void,
    onInject: () => void,
    onNavigateToSource: (pageId: string) => void,
    canInject?: boolean,
  }} */
  let {
    pin,
    samePage,
    scopeLabel,
    scopeVariant,
    sourceLabel,
    backlinks = [],
    formatRelativeDate,
    onClose,
    onSave,
    onDelete,
    onToggleAutoInsert,
    onInject,
    onNavigateToSource,
    canInject = true,
    showAutoInsert = true,
  } = $props();

  // Notes can be stored either as plain text (legacy/manual creation)
  // or as a ProseMirror JSON node (when pinned from a block — same
  // pipeline as artifacts). Detect and extract text in the JSON case
  // so the user sees readable content instead of escaped JSON.
  function extractText(raw) {
    if (!raw) return "";
    const s = String(raw);
    if (!s.startsWith("{") && !s.startsWith("[")) return s;
    try {
      const node = JSON.parse(s);
      const parts = [];
      const walk = (n) => {
        if (!n) return;
        if (typeof n.text === "string") parts.push(n.text);
        if (Array.isArray(n.content)) n.content.forEach(walk);
      };
      walk(node);
      const text = parts.join("");
      return text || s;
    } catch {
      return s;
    }
  }

  let title = $state(pin.title || "");
  let text = $state(extractText(pin.content));
  let originalDisplayText = extractText(pin.content);
  let openBacklinks = $state(false);

  // Mounted/unmounted by the caller's single-modal-slot {#if} (SharedObjectsPanel
  // or Memory) — register once on mount. Hardware back invokes the same
  // saveAndClose the scrim click and × button already use, so a dirty edit
  // isn't silently discarded by an Android back press. hideBar: true keeps
  // the MobileActionBar out of the way while this full-screen editor is up.
  let modalNavId = null;
  onMount(() => {
    modalNavId = navPush("pin-modal", () => {
      modalNavId = null;
      saveAndClose();
    }, { hideBar: true });
  });
  onDestroy(() => {
    if (modalNavId !== null) navClose(modalNavId);
  });

  async function saveAndClose() {
    const t = text.trim();
    const newTitle = title.trim() || null;
    const contentChanged = t && t !== originalDisplayText;
    const titleChanged = newTitle !== (pin.title || null);
    if (contentChanged || titleChanged) {
      // Save the plain text — losing the source's pinId attr and node
      // structure is acceptable for note pins; the divergence flow
      // surfaces structural drift separately.
      await onSave(t || pin.content, newTitle, !!contentChanged, titleChanged);
    }
    onClose();
  }

  function handleDelete() {
    onDelete();
    onClose();
  }

  function handleOpenSource() {
    if (!pin.source_page_id) return;
    const id = pin.source_page_id;
    saveAndClose();
    onNavigateToSource(id);
  }

  function handleBacklinkClick(pageId) {
    saveAndClose();
    onNavigateToSource(pageId);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-bg" onclick={saveAndClose} transition:fade={{ duration: 120 }}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <!-- Header row: scope chip · title · auto-insert · close -->
    <div class="modal-head">
      <span class="modal-scope">
        <Chip label={scopeLabel} variant={scopeVariant} />
      </span>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-title-wrap" onclick={(e) => e.stopPropagation()}>
        <input
          class="modal-title-input selectable"
          type="text"
          bind:value={title}
          placeholder="the real blocker was scope, not time"
          spellcheck="false"
        />
      </div>
      {#if showAutoInsert}
        <button
          class="modal-ai-toggle"
          class:active={pin.auto_insert}
          onclick={onToggleAutoInsert}
          title={pin.auto_insert ? "carry-forward on" : "carry-forward off"}
          aria-label="carry-forward"
        >↻</button>
      {/if}
      <button class="modal-x" onclick={saveAndClose} aria-label="close">×</button>
    </div>

    <!-- Provenance row -->
    <div class="modal-provenance">
      {#if pin.status === "orphaned"}
        <span class="prov-orphan">source removed · cached on {formatRelativeDate(pin.updated_at)}</span>
      {:else}
        <span class="prov-from">from <span class="prov-trail">{sourceLabel}</span></span>
      {/if}
      <span class="prov-sep">·</span>
      <span class="prov-time">created {formatRelativeDate(pin.created_at)}</span>
      <span class="prov-sep">·</span>
      <span class="prov-time">edited {formatRelativeDate(pin.updated_at)}</span>
      {#if backlinks.length > 0}
        <span class="prov-sep">·</span>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="prov-backlinks" onclick={() => (openBacklinks = !openBacklinks)}>
          referenced from {backlinks.length}
          <span class="prov-caret">{openBacklinks ? "▾" : "▸"}</span>
        </span>
      {/if}
    </div>
    {#if openBacklinks && backlinks.length > 0}
      <ul class="backlinks-inline-list">
        {#each backlinks as bl (bl.pageId)}
          <li>
            <button class="backlink-row" onclick={() => handleBacklinkClick(bl.pageId)}>
              → {bl.label}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if pin.diverged}
      <div class="divergence-banner">
        <p class="divergence-label">source changed on another device</p>
        <div class="divergence-actions">
          <Button variant="ghost" onClick={() => handleResolveDivergence("keep")}>keep original</Button>
          <Button variant="accent" onClick={() => handleResolveDivergence("update")}>update pin</Button>
        </div>
      </div>
    {/if}

    <div class="note-modal-body">
      <textarea
        class="note-modal-text selectable"
        bind:value={text}
        spellcheck="false"
      ></textarea>
    </div>

    <!-- Action bar -->
    <div class="modal-actions">
      <div class="modal-actions-left">
        {#if !samePage && pin.source_page_id && pin.status !== "orphaned"}
          <Button variant="ghost" onClick={handleOpenSource}>→ open source</Button>
        {/if}
      </div>
      <div class="modal-actions-right">
        {#if canInject}
          <Button variant="subtle" onClick={onInject}>inject here</Button>
        {/if}
        <Button variant="ghost" onClick={handleDelete}>delete</Button>
      </div>
    </div>
  </div>
</div>

<style>
  .modal-bg {
    position: fixed; inset: 0; z-index: 200;
    background: color-mix(in srgb, var(--ink) 25%, transparent);
    display: flex; justify-content: center; align-items: center;
  }
  .modal {
    background: var(--canvas-bg);
    border: 1px solid var(--card-border);
    border-radius: 1rem;
    box-shadow: 0 1.5rem 5rem var(--card-shadow-hover),
                0 0.25rem 1rem var(--card-shadow);
    width: min(45rem, 92vw); max-height: min(40rem, 90vh);
    display: flex; flex-direction: column; overflow: hidden;
  }
  @media (pointer: coarse) {
    .modal-bg {
      padding: max(var(--safe-top), 1rem) 1rem max(var(--safe-bottom), 1rem);
    }
    .modal {
      width: 100%;
      max-width: 100%;
      max-height: calc(100dvh - 2rem);
      border-radius: 0.875rem;
    }
  }

  .modal-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1.125rem 1.25rem 0.5rem;
    flex-shrink: 0;
  }
  .modal-scope { flex-shrink: 0; }
  .modal-title-wrap { flex: 1; min-width: 0; }
  .modal-title-input {
    width: 100%; background: transparent; border: none; outline: none;
    font-family: "Lora", serif; font-style: italic; font-size: 1.0625rem;
    color: var(--ink); padding: 0; caret-color: var(--warm-accent);
  }
  .modal-title-input::placeholder {
    color: var(--ink); opacity: 0.25; font-style: italic;
  }

  .modal-ai-toggle {
    background: none;
    border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.55;
    width: 1.75rem;
    height: 1.75rem;
    line-height: 1;
    flex-shrink: 0;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                color 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1),
                border-color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .modal-ai-toggle:hover { opacity: 0.92; }
  .modal-ai-toggle.active {
    color: var(--warm-accent);
    border-color: color-mix(in srgb, var(--warm-accent) 30%, transparent);
    background: var(--warm-accent-soft);
    opacity: 0.92;
  }
  .modal-x {
    background: none; border: none; cursor: pointer;
    font-size: 1.125rem; color: var(--ink); opacity: 0.35;
    flex-shrink: 0;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .modal-x:hover { opacity: 0.75; }
  @media (pointer: coarse) {
    .modal-x {
      font-size: 1.25rem;
      padding: 0.625rem;
      min-width: 2.5rem;
      min-height: 2.5rem;
      opacity: 0.6;
    }
  }

  .modal-provenance {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0 1.25rem 0.875rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    flex-shrink: 0;
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.55;
  }
  .prov-trail {
    font-family: "Lora", serif;
    font-style: italic;
    color: var(--warm-accent);
    opacity: 0.92;
  }
  .prov-sep { opacity: 0.35; }
  .prov-time {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    letter-spacing: 0.02em;
    opacity: 0.92;
  }
  .prov-orphan { color: var(--warm-accent); opacity: 0.55; }

  .prov-backlinks {
    cursor: pointer;
    color: var(--warm-accent);
    opacity: 0.75;
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    display: inline-flex;
    align-items: baseline;
    gap: 0.25rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .prov-backlinks:hover { opacity: 0.92; }
  .prov-caret {
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
    opacity: 0.55;
  }
  .backlinks-inline-list {
    list-style: none;
    margin: 0 0 0.5rem;
    padding: 0 1.25rem 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .backlink-row {
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: "Lora", serif;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.1875rem 0;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .backlink-row:hover {
    opacity: 0.92;
    color: var(--warm-accent);
  }

  /* Note modal */
  .note-modal-body { padding: 1.25rem 1.5rem 1.5rem; flex: 1; overflow-y: auto; }
  .note-modal-text {
    width: 100%; min-height: 13.75rem; resize: vertical;
    background: transparent; border: none; outline: none;
    font-family: var(--canvas-font-family, "Lora", serif);
    font-size: var(--editor-font-size, 16px);
    line-height: var(--editor-line-height, 1.6);
    color: var(--ink); caret-color: var(--warm-accent);
  }

  .modal-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1.25rem 1rem;
    border-top: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    flex-shrink: 0;
  }
  .modal-actions-left,
  .modal-actions-right {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .divergence-banner {
    background: color-mix(in srgb, var(--margin-bg) 85%, #c44 15%);
    border-radius: 0.25rem;
    padding: 0.6rem 0.8rem;
    margin: 0 1.5rem 0.6rem;
  }
  .divergence-label {
    font-size: 0.8rem;
    margin: 0 0 0.4rem;
    opacity: 0.9;
  }
  .divergence-actions {
    display: flex;
    gap: 0.4rem;
  }
</style>
