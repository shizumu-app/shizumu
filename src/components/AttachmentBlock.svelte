<script>
  import { NodeViewWrapper } from "svelte-tiptap";
  import { attachmentOpen, attachmentSetSync, attachmentLocalSrc } from "../lib/api.js";

  /** @type {{ node: any, updateAttributes: (a: any) => void, deleteNode: () => void, selected: boolean }} */
  let { node, updateAttributes, deleteNode, selected } = $props();

  let busy = $state(false);
  let errorMsg = $state("");
  let resolvedSrc = $state(null);

  // A src that resolves but will not load — a stale path after a restore, a
  // file removed underneath us, a revoked blob URL — used to leave an <img>
  // of zero height while its branch still rendered the resize handle, the
  // collapse button and the sync/remove overlay. All three are absolutely
  // positioned inside the wrapper, so with nothing to overlay they landed on
  // whatever text followed: a control pill floating over the next paragraph,
  // with no image in sight. Falling back to the missing state renders the
  // one honest thing instead — the file is not on this device.
  let failedHash = null;

  // Remember WHICH hash failed, not just that one did. Clearing resolvedSrc
  // alone leaves the resolver free to fetch the same dead path again the next
  // time the node object churns — and svelte-tiptap hands a new one on every
  // editor update, so hovering produces a stream of them. That resolves,
  // renders, errors and clears in a loop, which is what a rapid flicker over
  // an image looks like. A failed hash stays failed for the session.
  function handleImageError() {
    failedHash = node.attrs.blob_hash || null;
    resolvedSrc = null;
  }

  const isImage = $derived(node.attrs.kind === "image");

  // Resolve the image's on-device path -> convertFileSrc URL whenever the
  // blob_hash changes. Not stored as a frozen attr (unlike the old
  // localImage node) so this always reflects the current app session's
  // asset URL scheme rather than whatever was true at insert time.
  // Plain let, deliberately not $state: it is a memo of what we already
  // fetched, and making it reactive would re-trigger the effect that sets it.
  let resolvedHash = null;

  $effect(() => {
    if (!isImage || !node.attrs.blob_hash) { resolvedSrc = null; resolvedHash = null; return; }
    const hash = node.attrs.blob_hash;
    // Never re-fetch a hash whose image already failed to load.
    if (hash === failedHash) { resolvedSrc = null; return; }
    // svelte-tiptap hands a NEW node object on every editor update, and
    // hovering a block produces a stream of them, so this effect re-ran
    // constantly — one IPC round-trip per mouse move, each one reassigning
    // the <img> src. The path for a given hash cannot change within a
    // session (content-addressed store, fixed app dir), so resolve once.
    if (hash === resolvedHash) return;
    resolvedHash = hash;
    let cancelled = false;
    (async () => {
      try {
        const path = await attachmentLocalSrc(hash);
        if (cancelled) return;
        if (!path) { resolvedSrc = null; return; }
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        if (cancelled) return;
        resolvedSrc = convertFileSrc(path);
      } catch {
        if (!cancelled) resolvedSrc = null;
      }
    })();
    return () => { cancelled = true; };
  });

  function formatSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  async function onOpen() {
    if (busy) return;
    busy = true;
    errorMsg = "";
    try {
      await attachmentOpen(node.attrs.blob_hash);
    } catch (e) {
      errorMsg = String(e);
    } finally {
      busy = false;
    }
  }

  async function onToggleSync(e) {
    e.stopPropagation();
    const next = !node.attrs.sync;
    try {
      await attachmentSetSync(node.attrs.blob_hash, next);
      updateAttributes({ sync: next });
    } catch (err) {
      errorMsg = String(err);
    }
  }

  function onDelete(e) {
    e.stopPropagation();
    deleteNode();
  }

  // The chip carries two gestures: click previews, double-click expands.
  // They fought each other — the first click opened the preview dialog,
  // which covers the chip, so the second click landed on the modal and the
  // dblclick never fired. A collapsed image could not be expanded at all.
  // Holding the preview for one double-click interval lets the second click
  // cancel it.
  const DOUBLE_CLICK_MS = 250;
  let previewTimer = null;

  function cancelPendingPreview() {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function onExpand(e) {
    e.preventDefault();
    e.stopPropagation();
    cancelPendingPreview();
    updateAttributes({ collapsed: false });
  }

  function onCollapse(e) {
    e.preventDefault();
    e.stopPropagation();
    updateAttributes({ collapsed: true });
  }

  // Ported from local-image.js: swallow mousedown so pressing the chip or
  // the collapse button doesn't move the caret into the node before the
  // click handler runs.
  function swallowMouseDown(e) {
    e.preventDefault();
  }

  function onChipClick(e) {
    e.preventDefault();
    e.stopPropagation();
    // Guard against a click landing in the brief window before
    // attachmentLocalSrc resolves — nothing to preview yet.
    if (!resolvedSrc) return;
    // Dispatch on the clicked element itself, not a wrapper reference:
    // NodeViewWrapper (svelte-tiptap) binds its DOM element internally
    // but never exposes it through bind:this, so a wrapper-level ref
    // isn't available here. The event bubbles regardless of which
    // descendant fires it, reaching the same TipTapEditor.svelte
    // listener that local-image.js's chip already relies on.
    // Hold briefly: if a second click follows, ondblclick cancels this and
    // expands instead. Without the delay the dialog opened over the chip and
    // swallowed the second click.
    const el = e.currentTarget;
    const src = resolvedSrc;
    cancelPendingPreview();
    previewTimer = setTimeout(() => {
      previewTimer = null;
      el.dispatchEvent(new CustomEvent("shizumu-image-preview", {
        detail: { src },
        bubbles: true,
      }));
    }, DOUBLE_CLICK_MS);
  }

  // Resize drag — ported from local-image.js's pointerdown handler.
  // Both the image AND its wrapper's width update together during the
  // drag, matching the original exactly — the wrapper's width binding
  // (style:width={node.attrs.width}) is reactive to the committed attr,
  // which only updates on pointerup, so it must also be mutated directly
  // here or it visibly lags a frame behind the image during the drag.
  function onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const handle = e.currentTarget;
    const imgEl = handle.previousElementSibling;
    const wrapEl = handle.parentElement;
    const startWidth = imgEl.offsetWidth;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const newWidth = Math.max(80, startWidth + (ev.clientX - startX));
      imgEl.style.width = newWidth + "px";
      wrapEl.style.width = newWidth + "px";
    };
    const onUp = () => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      const finalWidth = imgEl.style.width || null;
      if (finalWidth) updateAttributes({ width: finalWidth });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }
</script>

{#if isImage}
  <!-- Deliberately reuses local-image.js's class names: global.css already
       owns the whole image presentation (block/inline display modes, the
       max-heights, the collapsed-chip flow, the hover-revealed handle and
       collapse button). Sharing the classes is what keeps an
       attachment-backed image pixel-identical to a localImage one. -->
  <NodeViewWrapper
    as={node.attrs.display === "inline" ? "span" : "div"}
    class="local-image-wrap attachment-image"
    data-display={node.attrs.display || "block"}
    data-collapsed={node.attrs.collapsed ? "true" : "false"}
  >
    {#if node.attrs.collapsed}
      <span
        class="local-image-chip"
        role="button"
        tabindex="0"
        title="click to view · double-click to expand"
        onmousedown={swallowMouseDown}
        onclick={onChipClick}
        onkeydown={(e) => e.key === "Enter" && onChipClick(e)}
        ondblclick={onExpand}
      >{node.attrs.filename || "image"}</span>
      <!-- Collapsed used to be a one-way door on touch: the only route back
           was a double-click, which is undiscoverable on a phone and
           unreliable next to the single-click preview it shares a target
           with. The sync decision was unreachable too — the toggle lives on
           the expanded image, so collapsing a file hid the control that says
           whether it leaves the device. Both are buttons now. -->
      <span class="local-image-chip-actions">
        <button
          type="button"
          class="action"
          title="expand"
          onmousedown={swallowMouseDown}
          onclick={onExpand}
        >expand</button>
        <button
          type="button"
          class="action sync-toggle"
          title={node.attrs.sync ? "synced. click to keep local-only" : "local only. click to authorize syncing"}
          onmousedown={swallowMouseDown}
          onclick={onToggleSync}
        >{node.attrs.sync ? "synced" : "local"}</button>
      </span>
    {:else if resolvedSrc}
      <img
        src={resolvedSrc}
        alt={node.attrs.filename || ""}
        data-display={node.attrs.display || "block"}
        draggable="false"
        style:width={node.attrs.width || null}
        onerror={handleImageError}
      />
      <span
        class="local-image-resize-handle"
        role="button"
        tabindex="-1"
        aria-label="drag to resize image"
        title="drag to resize"
        onpointerdown={onResizeStart}
      ></span>
      <button
        type="button"
        class="local-image-collapse-btn"
        title="collapse to chip"
        onmousedown={swallowMouseDown}
        onclick={onCollapse}
      >–</button>
      <!-- The one thing an attachment image has that a localImage never
           did: the per-file sync toggle. -->
      <span class="attachment-image-actions">
        <button
          type="button"
          class="action sync-toggle"
          title={node.attrs.sync ? "synced. click to keep local-only" : "local only. click to authorize syncing"}
          onmousedown={swallowMouseDown}
          onclick={onToggleSync}
        >{node.attrs.sync ? "synced" : "local"}</button>
        <button
          type="button"
          class="action delete-btn"
          title="remove"
          onmousedown={swallowMouseDown}
          onclick={onDelete}
        >✕</button>
      </span>
    {:else}
      <span class="local-image-missing">image not on this device</span>
    {/if}
    {#if errorMsg}
      <span class="attachment-error">{errorMsg}</span>
    {/if}
  </NodeViewWrapper>
{:else}
  <NodeViewWrapper as="span" class="attachment-nodeview">
    <span
      class="attachment-block"
      class:selected
      class:is-synced={node.attrs.sync}
      role="button"
      tabindex="0"
      onclick={onOpen}
      onkeydown={(e) => e.key === "Enter" && onOpen()}
    >
      <span class="icon" aria-hidden="true">📎</span>
      <span class="filename">{node.attrs.filename || "untitled"}</span>
      <span class="size">{formatSize(node.attrs.size_bytes)}</span>
      <!-- Quiet, always-visible privacy indicator: muted = local to this
           device, warm = the user has authorized syncing it. -->
      <span
        class="state-dot"
        title={node.attrs.sync ? "synced to your other devices" : "local to this device"}
        aria-hidden="true"
      ></span>
      <!-- Actions stay hidden until hover/focus so the file reads as a clean
           inline row. -->
      <span class="actions">
        <button
          type="button"
          class="action sync-toggle"
          title={node.attrs.sync ? "synced. click to keep local-only" : "local only. click to authorize syncing"}
          onclick={onToggleSync}
        >{node.attrs.sync ? "synced" : "local"}</button>
        <button type="button" class="action delete-btn" title="remove" onclick={onDelete}>✕</button>
      </span>
    </span>
    {#if errorMsg}
      <span class="attachment-error">{errorMsg}</span>
    {/if}
  </NodeViewWrapper>
{/if}

<style>
  /* --- file chip ---
     A compact inline-style chip — like the collapsed inline-image chip,
     not a full-width boxed row. Shrinks to its content and sits left in
     the line, so a file reads as a quiet token in the prose. */
  .attachment-block {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    width: fit-content;
    max-width: 100%;
    margin: 0.125rem 0;
    padding: 0.1875rem 0.5rem;
    border-radius: 0.375rem;
    background: color-mix(in srgb, var(--warm-accent) 6%, transparent);
    cursor: pointer;
    user-select: none;
    vertical-align: middle;
  }
  .attachment-block:hover {
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }
  .attachment-block.selected {
    outline: 2px solid color-mix(in srgb, var(--ink) 30%, transparent);
  }
  .icon { font-size: 0.9rem; }
  .filename {
    font-family: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .size {
    font-size: 0.75rem;
    opacity: 0.5;
    flex-shrink: 0;
  }
  /* Persistent privacy indicator: muted = local, warm = synced. */
  .state-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    background: color-mix(in srgb, var(--ink) 28%, transparent);
  }
  .is-synced .state-dot {
    background: var(--warm-accent);
  }
  .actions {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 140ms ease;
  }
  .attachment-block:hover .actions,
  .attachment-block:focus-within .actions {
    opacity: 1;
  }
  .action {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0.125rem 0.3125rem;
    border-radius: 0.25rem;
    opacity: 0.7;
    font-family: "DM Mono", monospace;
    font-size: 0.6875rem;
    color: var(--ink);
  }
  .delete-btn { font-size: 0.75rem; }
  .action:hover {
    opacity: 1;
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
  }
  .attachment-error {
    color: color-mix(in srgb, var(--ink) 60%, #c44 40%);
    font-size: 0.75rem;
    margin-left: 0.375rem;
  }

  /* Touch devices have no hover: keep the actions visible and give them
     bigger hit targets. */
  /* Touch chrome, sized so a COLLAPSED attachment stays a quiet token in the
     prose rather than a card. It previously gave every action a 2.25rem box,
     which stacked into a chip several lines tall — the reported "minimised
     file and image blocks take too much space".
     The tap target does not shrink with the ink: padding still carries the
     touch area, and the row's own min-height holds the 44px floor, so this is
     a density change, not an accessibility regression. */
  @media (pointer: coarse) {
    .actions { opacity: 1; }
    .attachment-block { min-height: max(var(--touch-target), 44px); }
    .action {
      padding: 0.25rem 0.375rem;
      min-width: 0;
      min-height: 0;
      font-size: 0.75rem;
      opacity: 0.85;
    }
  }

  /* The image branch is styled entirely by global.css's .local-image-*
     rules — shared with localImage on purpose, so both render identically.
     Nothing image-specific belongs here: these scoped styles can't reach
     NodeViewWrapper's own element anyway. */
</style>
