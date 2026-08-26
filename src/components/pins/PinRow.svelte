<!--
  PinRow — single pin row in the SharedObjectsPanel list.
  Layout: [kind chip] [title in warm-accent + content snippet] [actions].
  The chip names the block type at a glance (text / tasks / numbered /
  list / outline / q&a / table / board), the title reads in italic
  warm-accent so it pops over the muted snippet line.

  Title and snippet both flow through pin-display helpers so a pin whose
  title got stored as raw JSON (legacy bug) never leaks JSON to the UI.
  Inline rename is preserved as-is; drag/drop handlers are still threaded
  through from the parent.
-->
<script>
  import Card from "../../lib/ui/Card.svelte";
  import PinRowActions from "./PinRowActions.svelte";
  import { pinKind, pinFamily, pinDisplayTitle, pinSnippet, isFilePin, isImagePin, attachmentMetaOf, imageMetaOf } from "../../lib/pin-display.js";
  import { pinFileLocality, blobLocality, fileRowDetail } from "../../lib/attachment-locality.js";
  import { attachmentOpen } from "../../lib/api.js";
  import { blobImageSrc } from "../../lib/render/blob-image-hydrate.js";

  function formatBytes(n) {
    if (!n || n < 0) return "0 B";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  /** @type {{
    pin: any,
    eff: any,
    isBoard: boolean,
    lineagePath?: Array<{ id: string, name: string }>,
    localBlobs?: Map<string, boolean> | null,

    focused?: boolean,
    samePage?: boolean,

    sortMode?: string,
    draggingId?: string | null,
    dragOverId?: string | null,

    scopeActions?: Array<{ kind: string, label: string, target: string|null }>,
    scopeMenuOpen?: boolean,
    showActions?: boolean,

    onClick?: () => void,
    onRename?: (newTitle: string) => void | Promise<void>,
    onCarryForward?: () => void,
    onInject?: () => void,
    onDelete?: () => void,
    onScopeChange?: (scope: any) => void,
    onScopeMenuToggle?: () => void,
    onScopeAction?: (action: any) => void,

    onDragStart?: (e: DragEvent) => void,
    onDragOver?: (e: DragEvent) => void,
    onDragLeave?: (e: DragEvent) => void,
    onDrop?: (e: DragEvent) => void,
  }} */
  let {
    pin,
    eff,
    isBoard,
    lineagePath = [],
    localBlobs = null,

    focused = false,
    samePage = false,

    sortMode = "position",
    draggingId = null,
    dragOverId = null,

    scopeActions = [],
    scopeMenuOpen = false,
    showActions = true,

    onClick,
    onRename,
    onCarryForward,
    onInject,
    onDelete,
    onScopeChange,
    onScopeMenuToggle,
    onScopeAction,

    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
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
    : pinSnippet(eff),
  );
  let hasRealTitle = $derived(!!(eff?.title && eff.title.trim() && displayTitle === eff.title.trim()));
  // Full chain so all-trails view reads the hierarchy ("a › b › c").
  // Specific-trail callers pass a 1-element path so the chip degrades
  // to just the leaf name without changes here.
  let trailBreadcrumb = $derived.by(() => {
    if (!lineagePath || lineagePath.length === 0) return null;
    return lineagePath.map((l) => l.name).join(" › ");
  });

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

  function handleTitleClick(e) {
    e.stopPropagation();
    startRename();
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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pin-row-wrap"
  class:is-board={isBoard}
  class:is-note={!isBoard}
  class:closed={pin.status === "closed"}
  class:orphaned={pin.status === "orphaned"}
  class:dragging={draggingId === pin.id}
  class:drag-over={dragOverId === pin.id}
  data-pin-id={pin.id}
  draggable={sortMode === "position" && !isRenaming}
  ondragstart={onDragStart}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  <Card focused={focused} onClick={handleRowClick} variant="boxed">
    <div class="row-grid">
      <span class="kind-chip" data-family={family ?? "none"}>{isFile ? "📎 file" : kindLabel}</span>
      {#if isImage}
        <div class="row-thumb" class:away={imageLocality === "away"}>
          {#if imageSrc}
            <img src={imageSrc} alt={imageMeta?.filename || "pinned image"} />
          {/if}
        </div>
      {/if}
      <div class="row-text">
        {#if isRenaming}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <input
            id={`pin-rename-${pin.id}`}
            class="row-title-input selectable"
            bind:value={renameValue}
            onkeydown={handleRenameKeydown}
            onblur={commitRename}
            onclick={(e) => e.stopPropagation()}
            spellcheck="false"
          />
        {:else if displayTitle}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="row-title"
            class:row-title-accent={hasRealTitle}
            onclick={handleTitleClick}
          >{displayTitle}</span>
        {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="row-title row-title-empty" onclick={handleTitleClick}>untitled</span>
        {/if}

        {#if snippet && snippet !== displayTitle}
          <span class="row-snippet">{snippet}</span>
        {/if}
        {#if trailBreadcrumb}
          <span class="row-trail" class:nested={lineagePath.length > 1}>{trailBreadcrumb}</span>
        {/if}
      </div>
      {#if showActions}
        <div class="row-actions-col">
          <PinRowActions
            pin={pin}
            autoInsert={pin.auto_insert}
            scopeActions={scopeActions}
            scopeMenuOpen={scopeMenuOpen}
            onRename={() => startRename()}
            onCarryForward={onCarryForward}
            onInject={onInject}
            onDelete={onDelete}
            onScopeChange={onScopeChange}
            onScopeMenuToggle={onScopeMenuToggle}
            onScopeAction={onScopeAction}
          />
        </div>
      {/if}
    </div>
  </Card>
</div>

<style>
  .pin-row-wrap {
    position: relative;
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1),
                opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .pin-row-wrap.closed { opacity: 0.35; }
  .pin-row-wrap.orphaned { opacity: 0.55; }
  .pin-row-wrap.dragging { opacity: 0.35; }
  .pin-row-wrap.drag-over { background: var(--warm-accent-soft); }

  .row-grid {
    display: grid;
    /* chip · [thumb] · text · actions. The thumb column is only emitted
       for an image pin, and `auto` collapses to nothing on every other
       row, so no row pays for a column it doesn't fill. */
    grid-template-columns: auto auto 1fr auto;
    column-gap: 0.625rem;
    align-items: start;
  }

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
  .row-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding-top: 0.0625rem;
  }
  .row-actions-col {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding-top: 0.0625rem;
  }

  .kind-chip {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    letter-spacing: 0.02em;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.125rem 0.375rem;
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    border-radius: 0.25rem;
    line-height: 1.2;
    white-space: nowrap;
    align-self: start;
    margin-top: 0.0625rem;
  }
  .kind-chip[data-family="lists"],
  .kind-chip[data-family="structure"] {
    color: var(--warm-accent);
    opacity: 0.65;
    border-color: color-mix(in srgb, var(--warm-accent) 22%, transparent);
  }
  .kind-chip[data-family="charts"] {
    color: var(--warm-accent);
    opacity: 0.75;
    border-color: color-mix(in srgb, var(--warm-accent) 30%, transparent);
  }
  .kind-chip[data-family="code"] {
    color: var(--ink);
    opacity: 0.7;
    border-color: color-mix(in srgb, var(--ink) 18%, transparent);
  }
  .kind-chip[data-family="files"] {
    color: var(--warm-accent);
    opacity: 0.85;
    border-color: color-mix(in srgb, var(--warm-accent) 25%, transparent);
  }
  /* family="text" and family="none" use the default styles above. */

  .row-title {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.9375rem;
    color: var(--ink);
    opacity: 0.92;
    cursor: text;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .row-title-accent {
    color: var(--warm-accent);
  }
  .row-title-empty {
    color: var(--warm-accent);
    opacity: 0.75;
    font-style: italic;
  }
  .row-title-input {
    width: 100%;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    outline: none;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.9375rem;
    color: var(--ink);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    transition: border-color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .row-title-input:focus {
    border-color: color-mix(in srgb, var(--warm-accent) 35%, transparent);
  }

  .row-snippet {
    font-family: "Lora", serif;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--ink);
    opacity: 0.55;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-trail {
    align-self: flex-start;
    margin-top: 0.1875rem;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.625rem;
    color: var(--warm-accent);
    opacity: 0.92;
    padding: 0.0625rem 0.4375rem;
    border-radius: 0.625rem;
    background: var(--warm-accent-soft);
    border: 1px solid color-mix(in srgb, var(--warm-accent) 25%, transparent);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
