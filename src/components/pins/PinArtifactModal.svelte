<!--
  PinArtifactModal — full pin editor for board/table/list/qa artifacts.
  Extracted from SharedObjectsPanel.svelte (Task 2.2 of v0.4 UI refresh).

  Owns the TipTap Editor lifecycle for the editing surface. Initialization
  happens onMount (against modalEditorEl); destroy happens onDestroy. Save
  behaviour (same-page splice vs. cross-page write) is delegated to the
  parent via onSave, so the persistence policy and refresh_pin_caches hook
  semantics stay in one place.

  Layout preserves the original head (scope chip + title input + carry-
  forward toggle + close), provenance row (with backlinks disclosure),
  TipTap editor body, and footer action bar. This component intentionally
  does not use the <Modal> primitive: that primitive's title/body/actions
  slots cannot host the scope chip + AI toggle alongside the title without
  losing functionality.
-->
<script>
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { navPush, navClose } from "../../lib/navstack.js";
  import { Editor } from "@tiptap/core";
  import { READONLY_EXTENSIONS } from "../../lib/render/shared-extensions.js";
  import { migrateListSchema } from "../../lib/extensions/migrate-list-schema.js";
  import { migrateRecipeSchema } from "../../lib/extensions/migrate-recipe-schema.js";
  import { migrateQASchema } from "../../lib/extensions/migrate-qa-schema.js";
  import { resolvePinDivergence, getPage, attachmentOpen } from "../../lib/api.js";
  import { attachmentMetaOf, isFilePin } from "../../lib/pin-display.js";
  import Chip from "../../lib/ui/Chip.svelte";
  import Button from "../../lib/ui/Button.svelte";

  function formatBytes(n) {
    if (!n || n < 0) return "0 B";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
    onSave: (newNode: any, newTitle: string|null, contentChanged: boolean, titleChanged: boolean) => void | Promise<void>,
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

  let title = $state(pin.title || "");
  let editorEl = $state(/** @type {HTMLDivElement | null} */ (null));
  let editor = $state(/** @type {Editor | null} */ (null));
  let isFile = $derived(isFilePin(pin));
  let fileMeta = $derived(isFile ? attachmentMetaOf(pin.content) : null);
  // Tracks whether the user actually typed in the modal editor since it
  // opened. Without this gate, every open+close round-tripped the content
  // through TipTap's serializer, which normalizes attrs and strips anything
  // the modal editor's reduced extension set doesn't recognize — silently
  // overwriting a pin with the editor's interpretation on no-op closes.
  let dirty = $state(false);
  let openBacklinks = $state(false);

  function parseContent(content) {
    // The Rust refresh_pin_caches hook stores bare-node JSON (e.g. a list or
    // blockquote node, not a doc wrapper). Older pins may already be doc-
    // shaped from the pre-rewrite sync code. Accept both: pass doc through,
    // and wrap a bare node in a synthetic doc so the modal Editor can load it.
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object") {
        if (parsed.type === "doc") return parsed;
        if (typeof parsed.type === "string") {
          return { type: "doc", content: [parsed] };
        }
      }
    } catch {}
    return content;
  }

  onMount(() => {
    // File pins skip the editor entirely — the body renders an
    // open-the-blob preview rather than a TipTap surface, since the
    // pinned attachment node has no text content to edit.
    if (isFile) return;
    // All pin opens mount the modal Editor on a working copy of the pin's
    // content. The save path branches on source_page_id (handled by parent
    // via onSave): same-page splices into the main editor's PM doc (triggers
    // Rust refresh_pin_caches via the editor's normal save); cross-page writes
    // to the source page's content_json via save_page_content_with_pin_refresh.
    if (!editorEl) return;
    // Migrate legacy taskList/bulletList/orderedList → unified `list` so
    // older pin content (saved before the marker-driven redesign) renders
    // correctly through UnifiedListExtensions. Also rewrite legacy
    // algorithmBlock to recipeBlock, and flat-paragraph qaBlocks to the
    // new qaPair-nested shape.
    const raw = parseContent(pin.content);
    const content = typeof raw === "object" ? migrateQASchema(migrateRecipeSchema(migrateListSchema(raw))) : raw;
    editor = new Editor({
      element: editorEl,
      // READONLY_EXTENSIONS is the canonical schema — the pin modal needs
      // every node the source editor can produce so a pin containing a
      // dayMarker / pageRef / localImage / qaBlock parses cleanly. The
      // editor itself is editable=true here; the name "readonly" refers
      // to the extension list being free of editing-only plugins like
      // slash menu / mention / block movement that don't belong inside
      // a focused pin-edit dialog.
      extensions: READONLY_EXTENSIONS,
      content,
      editable: true,
      onUpdate: () => { dirty = true; },
    });
  });

  onDestroy(() => {
    if (editor) {
      editor.destroy();
      editor = null;
    }
  });

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
    // File pins have no editor body and no editable surface inside the
    // modal — renaming happens via the row's inline rename. Close cleanly
    // without round-tripping through onSave (which would no-op anyway
    // because newNode would be null).
    if (isFile) {
      onClose();
      return;
    }
    if (!editor) {
      onClose();
      return;
    }

    const newTitle = title.trim() || null;
    const titleChanged = newTitle !== (pin.title || null);

    // Only re-serialize and write content if the user actually edited.
    // A no-op open+close otherwise round-trips through TipTap's serializer
    // and overwrites the stored pin with the editor's normalized form --
    // which silently drops unsupported nodes and corrupts the pin.
    let contentChanged = false;
    let newNode = null;
    if (dirty) {
      const modalDoc = editor.getJSON();
      const newContent = JSON.stringify(modalDoc);
      contentChanged = newContent !== pin.content;
      newNode = modalDoc?.content?.[0] || null;
    }

    if (!contentChanged && !titleChanged) {
      onClose();
      return;
    }

    if (contentChanged || titleChanged) {
      // Always serialize the modal's current PM state so we have a complete
      // node shape. If only the header title changed, the editor body is
      // untouched but we still need its structure as the splice base.
      const modalDoc = editor.getJSON();
      newNode = modalDoc?.content?.[0] || null;
      if (newNode) {
        // The header input is the canonical title surface for the modal.
        // Override blockTitle on the spliced node so the source's attr
        // matches what the user typed, regardless of whether the editor's
        // own title slot was also touched.
        if (titleChanged) {
          newNode.attrs = { ...(newNode.attrs || {}), blockTitle: newTitle };
        }
        await onSave(newNode, newTitle, contentChanged || titleChanged, titleChanged);
      }
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
    // Save current edits before navigating away.
    saveAndClose();
    onNavigateToSource(id);
  }

  function handleBacklinkClick(pageId) {
    saveAndClose();
    onNavigateToSource(pageId);
  }

  // Walk a ProseMirror doc and return the first node whose attrs.pinId
  // matches the given id. Returns null when no match exists. Used by
  // the divergence "update" path to extract the current source content
  // so resolvePinDivergence can replace the pin's stored copy with
  // exactly what's now in the source page.
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

  // For note pins, the stored content is plain text; for everything
  // else (board / table / list / qa), it's a doc-wrapped node JSON.
  // Match what refresh_pin_caches produces on the Rust side so an
  // "update" resolve writes the same shape a fresh pin would.
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
        // Artifact path: pin stores the full node JSON. Note pins are
        // handled by PinNoteModal, but guard for object_type all the
        // same so a mis-routed note still produces the right shape.
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

    {#if isFile}
      <div class="file-preview">
        <span class="file-icon-large">📎</span>
        <div class="file-info">
          <div class="filename">{fileMeta?.filename || "file"}</div>
          <div class="file-meta">{formatBytes(fileMeta?.size_bytes || 0)}{fileMeta?.mime_type ? ` · ${fileMeta.mime_type}` : ""}</div>
        </div>
        <Button variant="accent" onClick={() => fileMeta?.blob_hash && attachmentOpen(fileMeta.blob_hash)}>
          open file
        </Button>
      </div>
    {:else}
      <div class="modal-editor prose" bind:this={editorEl}></div>
    {/if}

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
  /* Modal — pin editor; modal-scale shadow. */
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
      /* --app-height (keyboard-state.js) is the VISIBLE viewport; 100dvh is
         the layout one and doesn't shrink for the soft keyboard — this
         modal edits a text field, so it hits the same occlusion bug as
         Modal.svelte's phone block (see that file's comment). */
      max-height: calc(var(--app-height, 100dvh) - 2rem);
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

  .divergence-banner {
    background: color-mix(in srgb, var(--margin-bg) 85%, #c44 15%);
    border-radius: 0.25rem;
    padding: 0.6rem 0.8rem;
    margin: 0.6rem 1.25rem 0;
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

  /* Modal editor body box. Node-shape CSS comes from src/styles/prose.css
     via class="modal-editor prose" on the wrapper. */
  .modal-editor { padding: 1.25rem 1.5rem 1.5rem; overflow-y: auto; flex: 1; }
  .modal-editor :global(.ProseMirror) { min-height: 10rem; }

  /* File-pin preview body — bare attachment nodes have nothing to edit,
     so the modal swaps the editor for a centered file info panel + open
     button. */
  .file-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2.5rem 1.5rem;
    flex: 1;
    overflow-y: auto;
  }
  .file-icon-large { font-size: 3rem; opacity: 0.55; }
  .file-info { font-family: inherit; text-align: center; }
  .filename {
    font-family: "Lora", serif;
    font-size: 1rem;
    color: var(--ink);
    margin-bottom: 0.25rem;
    word-break: break-all;
  }
  .file-meta {
    font-family: "DM Mono", monospace;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.55;
    letter-spacing: 0.02em;
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
</style>
