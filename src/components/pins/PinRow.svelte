<!--
  PinRow — one pin, in the desktop pins panel and in memory's pins tab
  (spec 2026-11-01 §1-2, ruling 6). Layout: kind in a fixed column, then
  the title (the open control), the source line, the carry-forward line,
  a two-line snippet, and the worded actions from pin-row-actions.js.

  Title and snippet both flow through pin-display helpers so a pin whose
  title got stored as raw JSON (legacy bug) never leaks JSON to the UI.
  Inline rename is preserved as-is; drag/drop handlers are still threaded
  through from the parent.
-->
<script>
  import { pinKind, pinFamily, pinDisplayTitle, pinSnippet, isFilePin, isImagePin, attachmentMetaOf, imageMetaOf } from "../../lib/pin-display.js";
  import { pinFileLocality, blobLocality, fileRowDetail } from "../../lib/attachment-locality.js";
  import { attachmentOpen } from "../../lib/api.js";
  import { blobImageSrc } from "../../lib/render/blob-image-hydrate.js";
  import { pinRowActions } from "../../lib/pin-row-actions.js";

  function formatBytes(n) {
    if (!n || n < 0) return "0 B";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  /** @type {{
    pin: any,
    eff: any,
    isBoard?: boolean,
    localBlobs?: Map<string, boolean> | null,

    samePage?: boolean,

    sortMode?: string,
    draggingId?: string | null,
    dragOverId?: string | null,

    showActions?: boolean,

    onClick?: () => void,
    onRename?: (newTitle: string) => void | Promise<void>,
    onCarryForward?: () => void,
    onInject?: () => void,
    onDelete?: () => void,
    onScopeAction?: (action: any) => void,

    onDragStart?: (e: DragEvent) => void,
    onDragOver?: (e: DragEvent) => void,
    onDragLeave?: (e: DragEvent) => void,
    onDrop?: (e: DragEvent) => void,

    sourceLine?: string | null,
    lineages?: any[],
    canPutOnPage?: boolean,
    onMove?: (target: string|null) => void,
  }} */
  let {
    pin,
    eff,
    isBoard = false,
    localBlobs = null,

    samePage = false,

    sortMode = "position",
    draggingId = null,
    dragOverId = null,

    showActions = true,

    onClick,
    onRename,
    onCarryForward,
    onInject,
    onDelete,
    onScopeAction,

    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,

    sourceLine = null,
    lineages = [],
    canPutOnPage = true,
    onMove,
  } = $props();

  let rawKind = $derived(pinKind(eff));
  let kindLabel = $derived(rawKind === "board" ? "blocks" : rawKind);
  let family = $derived(pinFamily(eff));
  let isFile = $derived(isFilePin(eff));
  // A pinned image is an attachment like a file, but the row's job is
  // different: a file row hands the blob to the OS, an image row shows the
  // picture. Before this it did neither — every attachment pin was stamped
  // object_type "file" at creation, so an image rendered as a 📎 row with a
  // filename and a byte count and no way to see what had been kept.
  let isImage = $derived(isImagePin(eff));
  let imageMeta = $derived(isImage ? imageMetaOf(eff?.content) : null);
  let imageLocality = $derived(isImage ? blobLocality(imageMeta?.blob_hash, localBlobs) : null);
  let fileMeta = $derived(isFile ? attachmentMetaOf(eff?.content) : null);
  let displayTitle = $derived(
    isFile ? (eff?.title?.trim() || fileMeta?.filename || "file")
    : isImage ? (eff?.title?.trim() || imageMeta?.filename || "image")
    : pinDisplayTitle(eff),
  );

  // Resolve the blob to a viewable src. Same per-hash memo shape as
  // blob-image-hydrate.js uses for statically-rendered docs; a pin panel
  // can list the same image on several rows, and each would otherwise pay
  // its own round-trip to the Rust side.
  let imageSrc = $state(null);
  $effect(() => {
    const hash = imageMeta?.blob_hash;
    imageSrc = null;
    if (!hash) return;
    let live = true;
    blobImageSrc(hash).then((src) => { if (live) imageSrc = src; });
    return () => { live = false; };
  });
  // A pinned file whose blob this device no longer holds still renders (the
  // pin caches its content), but opening it can't work. Say so on the size
  // line, in the same muted register — the decision lives in
  // attachment-locality.js, this component only renders what it returns.
  let fileLocality = $derived(isFile ? pinFileLocality(eff, localBlobs) : null);
  let snippet = $derived(
    isFile ? fileRowDetail(formatBytes(fileMeta?.size_bytes || 0), fileLocality)
    : isImage ? fileRowDetail(formatBytes(imageMeta?.size_bytes || 0), imageLocality)
    // The row clamps to two lines in CSS, so it asks for enough text to
    // fill them.
    : pinSnippet(eff, { maxLen: 220 }),
  );

  // Inline rename — preserves the original focus/select/Esc/blur dance.
  let isRenaming = $state(false);
  let renameValue = $state("");

  function startRename() {
    isRenaming = true;
    renameValue = pin.title || "";
    requestAnimationFrame(() => {
      const el = document.getElementById(`pin-rename-${pin.id}`);
      if (el) { el.focus(); /** @type {HTMLInputElement} */ (el).select?.(); }
    });
  }
  function cancelRename() {
    isRenaming = false;
    renameValue = "";
  }
  function commitRename() {
    if (!isRenaming) return;
    const next = renameValue.trim();
    const current = (pin.title || "").trim();
    isRenaming = false;
    if (next === current) return;
    onRename?.(next || null);
  }
  function handleRenameKeydown(e) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
  }

  // File pins open the bundled blob on row click rather than the artifact
  // modal — opening the modal for a file pin would just show the bare
  // attachment node, which the modal can't render usefully.
  function handleRowClick() {
    // An image row opens the artifact modal (which renders the picture at
    // size) rather than handing the blob to the OS the way a file does —
    // the point of keeping an image is looking at it in place.
    if (isFile && fileMeta?.blob_hash) {
      attachmentOpen(fileMeta.blob_hash, fileMeta.filename).catch((err) => console.error(err));
      return;
    }
    onClick?.();
  }

  // ── panel layout: worded actions, ⋯ menu, unpin asks first ────────────
  let actions = $derived(pinRowActions(pin, { lineages, title: displayTitle, canPutOnPage, canRename: !!onRename }));
  let menuOpen = $state(false);
  let confirming = $state(/** @type {any} */ (null));
  let moreBtn = $state(/** @type {HTMLButtonElement|null} */ (null));
  let menuEl = $state(/** @type {HTMLElement|null} */ (null));
  let titleBtn = $state(/** @type {HTMLButtonElement|null} */ (null));
  let titleId = $derived(`pin-title-${pin.id}`);

  function openMenu() {
    menuOpen = !menuOpen;
    confirming = null;
    if (menuOpen) requestAnimationFrame(() => menuEl?.querySelector("button")?.focus());
  }
  function closeMenu({ refocus = true } = {}) {
    menuOpen = false;
    confirming = null;
    if (refocus) moreBtn?.focus();
  }
  function runPrimary(a) {
    if (a.id === "open") handleRowClick();
    else if (a.id === "putOnPage") onInject?.();
  }
  function runMore(a) {
    if (a.confirm) { confirming = a; requestAnimationFrame(() => menuEl?.querySelector(".confirm-no")?.focus()); return; }
    closeMenu({ refocus: a.id !== "rename" });
    if (a.id === "carry") onCarryForward?.();
    else if (a.id === "rename") startRename();
    else if (a.id === "move") onMove ? onMove(a.target) : onScopeAction?.({ target: a.target, label: a.label });
  }
  function confirmUnpin() {
    closeMenu({ refocus: false });
    onDelete?.();
  }
  function menuKeydown(e) {
    if (e.key === "Escape") {
      // Spent here: the panel's own Escape (back to the editor) must not
      // also run for the press that only closed this menu.
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...(menuEl?.querySelectorAll("button") || [])];
      const i = items.indexOf(/** @type {any} */ (document.activeElement));
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  }
  $effect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (menuEl?.contains(e.target) || moreBtn?.contains(e.target)) return;
      closeMenu({ refocus: false });
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<article
  class="pin-row-wrap panel-row"
  class:closed={pin.status === "closed"}
  class:orphaned={pin.status === "orphaned"}
  class:dragging={draggingId === pin.id}
  class:drag-over={dragOverId === pin.id}
  class:menu-open={menuOpen}
  data-pin-id={pin.id}
  aria-labelledby={titleId}
  draggable={sortMode === "position" && !isRenaming && !menuOpen}
  ondragstart={onDragStart}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  <span class="p-kind" data-family={family ?? "none"}>{isFile ? "file" : kindLabel}</span>
  <div class="p-body">
    <div class="p-head">
      {#if isImage}
        <div class="row-thumb small" class:away={imageLocality === "away"}>
          {#if imageSrc}<img src={imageSrc} alt="" />{/if}
        </div>
      {/if}
      {#if isRenaming}
        <input
          id={`pin-rename-${pin.id}`}
          class="row-title-input selectable"
          aria-label="pin title"
          bind:value={renameValue}
          onkeydown={handleRenameKeydown}
          onblur={commitRename}
          spellcheck="false"
        />
      {:else}
        <!-- The title is the open control: the row itself is not a button
             (a button holding buttons has no usable name). -->
        <button
          bind:this={titleBtn}
          id={titleId}
          type="button"
          class="row-title p-title"
          class:row-title-empty={!displayTitle}
          onclick={handleRowClick}
        >{displayTitle || "untitled"}</button>
      {/if}
    </div>
    {#if sourceLine}
      <span class="p-from">{sourceLine}</span>
    {/if}
    {#if pin.auto_insert}
      <span class="p-carry"><span aria-hidden="true">↻</span> carries forward to new pages</span>
    {/if}
    {#if snippet && snippet !== displayTitle}
      <span class="p-snippet">{snippet}</span>
    {/if}
    {#if showActions}
      <div class="p-acts">
        {#each actions.primary as a (a.id)}
          <button type="button" class="p-act" aria-label={a.ariaLabel} onclick={() => runPrimary(a)}>{a.label}</button>
        {/each}
        <button
          bind:this={moreBtn}
          type="button"
          class="p-act p-more"
          aria-label={`more for ${displayTitle || "this pin"}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onclick={openMenu}
        >⋯</button>
      </div>
      {#if menuOpen}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="p-menu" role="menu" tabindex="-1" aria-label={`actions for ${displayTitle || "this pin"}`} bind:this={menuEl} onkeydown={menuKeydown}>
          {#if confirming}
            <p class="p-confirm">{confirming.confirm.prompt}</p>
            <div class="p-confirm-row">
              <button type="button" role="menuitem" class="p-act confirm-no" onclick={() => closeMenu()}>{confirming.confirm.no}</button>
              <button type="button" role="menuitem" class="p-act confirm-yes" onclick={confirmUnpin}>{confirming.confirm.yes}</button>
            </div>
          {:else}
            {#each actions.more as a, i (a.id + i)}
              {#if i > 0 && a.group !== actions.more[i - 1].group}<hr class="p-sep" />{/if}
              <button type="button" role="menuitem" class="p-item" class:danger={a.id === "unpin"} onclick={() => runMore(a)}>{a.label}</button>
            {/each}
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</article>

<style>
  /* ── the row (spec 2026-11-01 §1) ────────────────────────────────────
     Kind in a fixed column so titles share one left edge whatever the
     label's width; the card is the page's own tone a step off the panel. */
  .panel-row {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr);
    column-gap: 0.625rem;
    padding: 0.625rem 0.75rem;
    margin-bottom: 0.5rem;
    border-radius: 0.625rem;
    background: var(--surface);
    border: 1px solid var(--card-border);
  }
  .p-kind {
    font-family: "DM Mono", monospace;
    font-size: 0.6875rem;
    color: var(--ink-soft);
    padding-top: 0.1875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .p-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    position: relative;
  }
  .p-head { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  .row-thumb.small { width: 1.75rem; height: 1.75rem; }
  .p-title {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    text-align: left;
    cursor: pointer;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.9375rem;
    line-height: 1.35;
    color: var(--accent-text);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: 0.25rem;
  }
  .p-title:hover { text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 1px; }
  .p-from, .p-carry {
    font-family: "DM Mono", monospace;
    font-size: 0.6875rem;
    line-height: 1.4;
  }
  .p-from { color: var(--ink-soft); }
  .p-carry { color: var(--accent-text); }
  .p-snippet {
    font-family: "Lora", serif;
    font-size: 0.84375rem;
    line-height: 1.45;
    color: var(--ink-soft);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }
  .p-acts {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.375rem;
  }
  .p-act {
    font-family: "DM Mono", monospace;
    font-size: 0.75rem;
    line-height: 1.2;
    border: 1px solid var(--card-border);
    background: var(--canvas-bg);
    color: var(--ink-soft);
    border-radius: 0.375rem;
    padding: 0.1875rem 0.5rem;
    cursor: pointer;
    transition: color var(--motion-fast, 140ms), border-color var(--motion-fast, 140ms);
  }
  .p-act:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 22%, transparent); }
  .p-more {
    margin-left: auto;
    border-color: transparent;
    background: none;
    font-size: 1rem;
    line-height: 1;
    padding: 0.125rem 0.375rem;
  }
  .p-more[aria-expanded="true"] { color: var(--ink); background: var(--hover-tint); }
  .p-menu {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 5;
    margin-top: 0.25rem;
    min-width: 12.5rem;
    max-width: 18rem;
    padding: 0.25rem;
    background: var(--surface-raised);
    border: 1px solid var(--elev-border);
    border-radius: 0.5rem;
    box-shadow: var(--elev-2);
    display: flex;
    flex-direction: column;
  }
  .p-item {
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    padding: 0.375rem 0.5rem;
    border-radius: 0.3125rem;
    font-family: "DM Mono", monospace;
    font-size: 0.75rem;
    color: var(--ink);
  }
  .p-item:hover, .p-item:focus-visible { background: var(--hover-tint); }
  .p-item.danger { color: var(--accent-text); }
  .p-sep { border: none; border-top: 1px solid var(--elev-border); margin: 0.25rem 0.25rem; }
  .p-confirm {
    margin: 0.25rem 0.5rem 0.5rem;
    font-family: "Lora", serif;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--ink);
  }
  .p-confirm-row { display: flex; justify-content: flex-end; gap: 0.375rem; padding: 0 0.25rem 0.25rem; }
  .confirm-yes { color: var(--accent-text); border-color: color-mix(in srgb, var(--warm-accent) 35%, transparent); }
  .panel-row.dragging { opacity: 0.35; }
  .panel-row.drag-over { background: var(--warm-accent-soft); }
  .panel-row.closed, .panel-row.orphaned { color: var(--ink-soft); }
  .panel-row.menu-open { position: relative; z-index: 4; }

  .pin-row-wrap {
    position: relative;
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1),
                opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .pin-row-wrap.closed {
    color: var(--ink-soft);
  }
  .pin-row-wrap.orphaned {
    color: var(--ink-soft);
  }
  .pin-row-wrap.dragging { opacity: 0.35; }
  .pin-row-wrap.drag-over { background: var(--warm-accent-soft); }

  /* Pinned-image thumbnail. Fixed box so a column of image pins keeps one
     left edge regardless of aspect ratio; `contain` rather than `cover` so
     a tall or wide picture is shown whole rather than cropped to a square
     that hides what was kept. */
  .row-thumb {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-sm, 0.25rem);
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    overflow: hidden;
    flex-shrink: 0;
  }
  .row-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  /* Bytes gone from this device (gc sweep, or never synced here). The row
     still renders — the pin caches its content — but there is no picture
     to show, and the snippet line already says so in words. */
  .row-thumb.away {
    border-style: dashed;
    opacity: 0.5;
  }

  .row-title-empty {
    color: var(--accent-text);
    font-style: italic;
  }
  /* Renamed in place, like every title field: no box, the title stays
     where it was, and focus is the accent caret and short accent rule
     (global.css). A tinted, bordered box with the focus ring around it
     was two outlines on one line (owner, 2026-10-31). */
  .row-title-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.9375rem;
    color: var(--ink);
    padding: 0 0 0.25rem;
    border-radius: 0;
  }

</style>
