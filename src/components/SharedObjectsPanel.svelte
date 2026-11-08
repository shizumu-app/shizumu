<script>
  import { holdsPin } from "../lib/pin-node.js";
  import { fade } from "../lib/motion.js";
  import { untrack, onDestroy } from "svelte";
  import { navPush, navClose } from "../lib/navstack.js";
  import { pinToNodes } from "../lib/pin-carry-forward.js";
  import { pinTitleAuthority } from "../lib/pin-title-authority.js";
  import {
    getPins, updatePinContent, updatePinScope, deletePin,
    getLineages, updatePinAutoInsert, reorderPins,
    loadPageContentForModal, savePageContentWithPinRefresh,
    getBacklinksForPin, getPinForReference,
    attachmentList,
  } from "../lib/api.js";
  import { attachmentLocality } from "../lib/attachment-locality.js";
  import { buildMentionLabel } from "../lib/mention-label.js";
  import { pinFamily, pinDisplayTitle, pinSearchText } from "../lib/pin-display.js";
  import { pinModalFor, pinForModal, writePinEdit, textIntoNode } from "../lib/pin-edit-route.js";
  import Popover from "../lib/ui/Popover.svelte";
  import Input from "../lib/ui/Input.svelte";
  import Button from "../lib/ui/Button.svelte";
  import {
    defaultPanelFilter, panelChips, toggleChip, setKind, filterPanelPins, sortPanelPins,
    scopeRows, panelSections, pinSourceLine, panelTitle, searchPlaceholder,
    clearPanelFilters, mergePinRows, canReorder, KINDS, SCOPE_ALL, SORT_DEFAULT, SORT_NEWEST,
  } from "../lib/pin-panel-filter.js";
  import { pinsEmptyState } from "../lib/pin-panel-empty.js";
  import PinRow from "./pins/PinRow.svelte";
  import PinArtifactModal from "./pins/PinArtifactModal.svelte";
  import PinNoteModal from "./pins/PinNoteModal.svelte";
  import {
    getPagePreviewFor,
    mountPreviewCard,
    destroyPreview,
    getActivePreviewOwner,
  } from "../lib/render/preview-card.js";

  /** @type {{ lineageId: string|null, lineageName: string, pageId: string, editorDoc: any, onClose: () => void, onPinRemoved: (content: string) => void, onPinInject: (nodes: any[]) => void, onPinLocate: (pinId: string) => void, onSamePagePinSave: (pinId: string, newNode: any) => boolean|undefined, onBeforePageWrite: (pageId: string) => Promise<void>|void, onPageWritten: (pageId: string) => void, onNavigateToSource: (pageId: string) => void }} */
  let { lineageId = null, lineageName = "", pageId, refreshToken = 0, editorDoc = null, openPinId = null, docked = false, canPutOnPage = true, canChooseTrail = true, onChooseTrail = () => {}, onReturnToEditor = () => {}, onPinOpened = () => {}, onClose, onPinRemoved = () => {}, onPinInject = () => {}, onPinLocate = () => {}, onSamePagePinSave = () => false, onBeforePageWrite = () => {}, onPageWritten = () => {}, onNavigateToSource = () => {} } = $props();

  // The panel is mounted/unmounted by the caller's {#if} (there's no
  // internal open prop to react to), so it registers on the navstack once
  // on mount and cleans up on unmount — same idea as BottomSheet, just
  // pinned to the component lifecycle instead of a reactive `open` prop.
  // Hardware back closes the panel via the same onClose the close/back
  // buttons and the overlay click already use. hideBar: true so the
  // MobileActionBar steps aside while the panel (and any pin modal nested
  // inside it) is open.
  //
  // DOCKED (spec 2026-11-01, ruling 4): a panel beside a live page is not a
  // layer over it, so it joins the stack only while focus is inside it —
  // otherwise back, the edge swipe and the header's overlay checks would
  // all treat the page as covered while the writer is typing in it.
  let panelNavId = null;
  let focusInside = $state(false);
  function pushNav() {
    if (panelNavId !== null) return;
    panelNavId = navPush("shared-objects-panel", () => {
      panelNavId = null;
      onClose?.();
    }, { hideBar: true });
  }
  function dropNav() {
    if (panelNavId === null) return;
    const id = panelNavId;
    panelNavId = null;
    navClose(id);
  }
  $effect(() => {
    if (!docked || focusInside) untrack(pushNav);
    else untrack(dropNav);
  });
  onDestroy(dropNav);

  let panelEl = $state(/** @type {HTMLElement|null} */ (null));
  function handleFocusIn() { focusInside = true; }
  function handleFocusOut(e) {
    const next = /** @type {Node|null} */ (e.relatedTarget);
    if (next && panelEl?.contains(next)) return;
    focusInside = false;
  }

  // Escape inside the panel. Docked, it hands the caret back to the page
  // and leaves the panel open beside it; as an overlay, it closes the panel,
  // which is what a layer does. An Escape something inside already spent
  // (the search box clearing its text, a row's ⋯ menu closing) is not one.
  function handlePanelKeydown(e) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    if (docked) onReturnToEditor?.();
    else onClose?.();
  }

  // Pin lists split by scope so the sectioned feed can render them together.
  // Trail tab semantics (current + ancestors) remain; we fetch global in
  // parallel and concatenate. The derived `allPins` is the union; downstream
  // code that read the old `pins` variable now reads `allPins` (same shape).
  let pinsTrail = $state([]);
  let pinsGlobal = $state([]);
  let allPins = $derived([...pinsTrail, ...pinsGlobal]);
  // Every trail's pins, for the `all trails` scope and its count. get_pins
  // walks ancestors upward, so the fetch asks each trail and mergePinRows
  // keeps each pin once (the same fan-out memory does).
  let pinsAllTrails = $state([]);
  let everyPin = $derived(mergePinRows([pinsTrail, pinsAllTrails, pinsGlobal]));

  /**
   * Patch one pin everywhere it lives (trail or global). Used after optimistic
   * mutations so the local view updates before the round-trip lands. If the
   * pin's scope changed (`update_pin_scope`), the caller is expected to call
   * `loadPins()` afterwards — the backend re-evaluates ancestry visibility.
   */
  function patchPin(id, mut) {
    pinsAllTrails = pinsAllTrails.map((p) => (p.id === id ? { ...p, ...mut } : p));
    pinsTrail = pinsTrail.map((p) => (p.id === id ? { ...p, ...mut } : p));
    pinsGlobal = pinsGlobal.map((p) => (p.id === id ? { ...p, ...mut } : p));
    pinsReached = pinsReached.map((p) => (p.id === id ? { ...p, ...mut } : p));
  }

  /** Drop a pin everywhere it lives. Used by removePin. */
  function dropPin(id) {
    pinsAllTrails = pinsAllTrails.filter((p) => p.id !== id);
    pinsTrail = pinsTrail.filter((p) => p.id !== id);
    pinsGlobal = pinsGlobal.filter((p) => p.id !== id);
    pinsReached = pinsReached.filter((p) => p.id !== id);
  }

  // A pin opened through an @-mention from outside this page's trail chain:
  // the panel's sections never list it, so the open effect below could not
  // find it and opened nothing (mentions-backlinks.mjs). It is loaded from
  // its own trail and held here, apart from the sections and their counts.
  let pinsReached = $state([]);
  let reachingFor = null;

  async function reachPin(id) {
    if (reachingFor === id) return;
    reachingFor = id;
    try {
      const ref = await getPinForReference(id);
      const rows = ref ? await getPins(ref.lineage_id ?? null) : [];
      const row = rows.find((p) => p.id === id);
      if (row) pinsReached = [row];
      // Gone (deleted since the mention was written): stop asking.
      else onPinOpened();
    } catch {
      onPinOpened();
    }
  }

  // Same-page live pin contents: walk the current editor's doc once, build
  // a map of pinId -> live node JSON. Pin rows whose source_page_id === pageId
  // render from this map; if their pinId is missing, fall back to cache.
  //
  // A PIN OVER SEVERAL BLOCKS is held as a doc of all of them, in order —
  // findPinNode's shape and the stored row's. This used to keep one node
  // per pinId (the last one walked), so the modal opened on that block and
  // its save replaced the whole run with it, deleting the others from the
  // page (found by the J12 journey's review, 2026-10-28).
  let livePinNodes = $derived.by(() => {
    if (!editorDoc) return new Map();
    const runs = new Map();
    function walk(node) {
      // A mention of a pin is not its live content (src/lib/pin-node.js),
      // and a stamped block's insides are part of it, not a second block.
      if (holdsPin(node)) {
        const run = runs.get(node.attrs.pinId) || [];
        run.push(node);
        runs.set(node.attrs.pinId, run);
        return;
      }
      if (Array.isArray(node?.content)) {
        for (const child of node.content) walk(child);
      }
    }
    walk(editorDoc);
    const map = new Map();
    for (const [id, run] of runs) map.set(id, run.length === 1 ? run[0] : { type: "doc", content: run });
    return map;
  });

  /** A pin's content as a doc: a single node wrapped, a run already one. */
  const asPinDoc = (node) => (node?.type === "doc" ? node : { type: "doc", content: [node] });

  // Each rendered pin merges live state on top of the DB row.
  // Boards/artifacts need the live node as a serialized doc so modals can
  // render the structured content. Notes are plain text, so we extract the
  // live text instead of handing JSON to the textarea-backed note modal.
  function liveNoteText(node) {
    let out = "";
    function walk(n) {
      if (!n) return;
      if (typeof n.text === "string") out += n.text;
      if (Array.isArray(n.content)) {
        for (let i = 0; i < n.content.length; i++) {
          walk(n.content[i]);
          if (i < n.content.length - 1) out += "\n";
        }
      }
    }
    walk(node);
    return out;
  }

  function effectivePin(p) {
    // Key on whether this page's live doc actually holds the pin's node, NOT
    // on the DB row's source_page_id. An injected pin's node is in this doc
    // immediately, but its source_page_id only transfers to this page after a
    // save runs refresh_pin_caches — so gating on source_page_id showed the
    // stale cache and never reflected edits the user just made. livePinNodes
    // only contains pinIds present in THIS doc, so a pin owned elsewhere is
    // absent and correctly falls through to its cache.
    const live = livePinNodes.get(p.id);
    if (!live) return p;  // not in this doc — cross-page or truly absent; cache
    const head = live.type === "doc" ? live.content?.[0] : live;
    const liveTitle = (head?.attrs?.blockTitle || "").trim();
    if (isBoard(p)) {
      return {
        ...p,
        content: JSON.stringify(asPinDoc(live)),
        title: liveTitle.length > 0 ? liveTitle : p.title,
      };
    }
    return {
      ...p,
      content: liveNoteText(live),
      title: liveTitle.length > 0 ? liveTitle : p.title,
    };
  }

  let loading = $state(true);
  // Single modal slot. Replaces the parallel expandedId / expandedNote pair
  // (one drove the artifact modal, the other drove the note modal); having
  // two pieces of state meant either could be set at the same time, which
  // produced the stacked-overlay bug flagged in the v0.4 UI audit.
  //   null | { type: "artifact" | "note", pinId: string }
  let modal = $state(/** @type {{ type: "artifact"|"note", pinId: string } | null} */ (null));

  // When the parent passes openPinId (e.g., a @pin reference was clicked
  // in the editor), auto-open that pin's modal once pins finish loading.
  // The parent clears its handle via onPinOpened so we don't re-open on
  // every render.
  $effect(() => {
    if (!openPinId || loading) return;
    const target = [...pinsTrail, ...pinsGlobal, ...pinsReached].find((p) => p.id === openPinId);
    if (!target) {
      reachPin(openPinId);
      return;
    }
    // pinModalKind, not isBoard: the modal fork asks about the CONTENT's
    // shape (a doc needs a doc renderer; only a real plain string belongs
    // in the note modal's textarea), while isBoard below is this panel's
    // bucketing/sorting question. They were the same list here and a
    // different one in Memory, which is how the same pin opened two
    // different modals depending on where it was clicked.
    // pinModalFor: a pin whose node is in this editor always opens the
    // artifact modal, whose save reaches the node (pin-edit-route.js).
    modal = { type: pinModalFor(target, livePinNodes.get(target.id)), pinId: target.id };
    onPinOpened();
  });
  let allLineages = $state([]);

  // Side-nav filter state (Task 2.3). Single-select category + scope; the
  // old multi-select chip set (`filters.types: Set`, `filters.recent`, etc.)
  // collapsed into these axes plus a single carry-forward-only toggle and
  // a free-text search.
  //
  // Since 0.8.2 they are one row of chips under the search, decided in
  // pin-panel-filter.js. The sidebar that held them was too narrow to show
  // on desktop and nothing opened its drawer, so only search was reachable.
  let query = $state("");
  let chipState = $state(defaultPanelFilter());
  let filter = $derived({ ...chipState, query });
  let kindMenuOpen = $state(false);
  let kindChipEl = $state(/** @type {HTMLElement|null} */ (null));
  let sortMenuOpen = $state(false);
  let sortBtnEl = $state(/** @type {HTMLElement|null} */ (null));

  // Inline rename buffer. The PinRow component owns the in-row input UI
  // and reports a final title via onRename; this string just bridges the
  // callback into commitInlineRename, which still owns the optimistic
  // patch + same-page / cross-page save fork.
  let inlineRenameText = $state("");

  // Lineage tree helpers — all use allLineages loaded at mount.
  function lineageById(id) {
    if (!id) return null;
    return allLineages.find((l) => l.id === id) || null;
  }
  // Move a pin to another trail (the row's ⋯ → move …; the choices come
  // from pinMoveActions in pin-row-actions.js).
  async function movePin(pin, target) {
    // Optimistic local update; if the pin is no longer visible from here, drop it.
    const nextId = target;
    patchPin(pin.id, { lineage_id: nextId });
    try {
      await updatePinScope(pin.id, nextId);
    } catch {}
    // Reload so inheritance/visibility is recomputed by the backend.
    await loadPins();
  }

  $effect(() => {
    // Track lineageId AND refreshToken. Without refreshToken the panel loaded
    // its pins once per mount, so a pin created while the panel was open never
    // appeared until it was remounted (the user restarted the app to see it).
    // The parent bumps refreshToken on creation to force a reload.
    lineageId;
    refreshToken;
    untrack(() => {
      loadPins();
    });
  });

  /**
   * Fetch trail-visible pins (current + ancestors, via the existing CTE) and
   * global pins in parallel, so the sectioned feed has everything to group.
   */
  // hash -> has_local for every attachment row this device knows about, so a
  // file pin can say whether its bytes are here before the user clicks it.
  // null until the list lands (and after a failed load): "no claim yet",
  // which pinFileLocality renders as the plain size line.
  let localBlobs = $state(null);

  async function loadPins() {
    loading = true;
    try {
      const lineages = await getLineages().catch(() => []);
      allLineages = lineages || [];
      const others = allLineages.map((l) => l.id).filter((id) => id !== lineageId);
      const [trailRows, globalRows, attachments, ...otherRows] = await Promise.all([
        lineageId ? getPins(lineageId) : Promise.resolve([]),
        getPins(null),
        // Isolated catch: pins must still render on a device where the
        // attachment surface is unavailable.
        attachmentList().catch(() => null),
        // Every other trail, for `all trails`. One failing trail costs that
        // trail's pins in that scope, not the panel.
        ...others.map((id) => getPins(id).catch(() => [])),
      ]);
      pinsAllTrails = mergePinRows(otherRows);
      localBlobs = attachments ? attachmentLocality(attachments) : null;
      // The trail query's CTE already includes global pins indirectly (a pin
      // with lineage_id NULL won't match `IN (chain)` because chain never
      // contains NULL — so the two sets are disjoint as desired).
      pinsTrail = trailRows || [];
      pinsGlobal = globalRows || [];
    } catch {
      pinsTrail = [];
      pinsGlobal = [];
    } finally {
      loading = false;
    }
  }

  const isBoard = (o) => ["artifact", "board", "table", "file"].includes(o.object_type);

  // Scope key for a pin in the current panel context. Used both for the
  // sidebar scope counts and for grouping the visible feed into sections.
  function scopeOf(p) {
    if (p.lineage_id == null) return "global";
    if (p.lineage_id === lineageId) return "here";
    return "inherited";
  }

  // The chip row, the rows it shows and their headings: pin-panel-filter.js.
  let chips = $derived(panelChips({ trailPins: allPins, allPins: everyPin, pageId, lineageId, filter }));
  let kindCounts = $derived.by(() => {
    const inScope = scopeRows({ trailPins: allPins, allPins: everyPin }, filter.scope);
    const out = Object.fromEntries(KINDS.map((k) => [k, 0]));
    for (const p of inScope) { const f = pinFamily(p); if (f in out) out[f] += 1; }
    return out;
  });
  function pressChip(chip, e) {
    if (chip.menu) { kindChipEl = e?.currentTarget ?? null; kindMenuOpen = !kindMenuOpen; return; }
    chipState = toggleChip(chipState, chip.id);
  }

  let scopeCount = $derived(scopeRows({ trailPins: allPins, allPins: everyPin }, filter.scope).length);
  let visiblePins = $derived(
    sortPanelPins(
      filterPanelPins(scopeRows({ trailPins: allPins, allPins: everyPin }, filter.scope), filter, { pageId }),
      filter.sort,
    ),
  );
  let sections = $derived(panelSections(visiblePins, { filter, lineageId, lineages: allLineages }));
  let emptyState = $derived(pinsEmptyState({
    loading, lineageId, scopeCount, visibleCount: visiblePins.length, allScope: filter.scope === SCOPE_ALL,
  }));
  let reorderable = $derived(canReorder(filter));
  let title = $derived(panelTitle(lineageId, allLineages));

  function clearFilters() {
    chipState = clearPanelFilters(chipState);
    query = "";
  }

  // Backlinks for the currently-open pin modal. Re-fetched whenever the
  // modal opens (modal.pinId changes). The list of pages that reference
  // this pin via @-mention.
  let pinBacklinks = $state([]);

  async function loadPinBacklinks(pinId) {
    if (!pinId) { pinBacklinks = []; return; }
    try {
      const [rows, lineages] = await Promise.all([
        getBacklinksForPin(pinId),
        Promise.resolve(allLineages.length ? allLineages : getLineages()),
      ]);
      const resolvedLineages = Array.isArray(lineages) ? lineages : await lineages;
      pinBacklinks = (rows || []).map((r) => ({
        pageId: r.page_id,
        label: buildMentionLabel({ page: r, lineages: resolvedLineages }),
      }));
    } catch {
      pinBacklinks = [];
    }
  }

  // Trigger backlink fetch on modal open.
  $effect(() => {
    const targetId = modal?.pinId || null;
    if (targetId) {
      loadPinBacklinks(targetId);
    } else {
      pinBacklinks = [];
    }
  });

  // Lookup helper used by the single-modal render block to resolve the
  // current pin row by id, so the modal child sees an always-up-to-date
  // pin (after patchPin mutations).
  function pinById(id) {
    return everyPin.find((p) => p.id === id) || pinsReached.find((p) => p.id === id) || null;
  }

  // Save handler for the text-pin (note) modal. The note modal opens only
  // for a pin whose node is not in this editor (pinModalFor), so its text
  // goes to the node in the stored page when a page still holds it, and to
  // the row only when none does (pin-edit-route.js) — a row-only edit is
  // overwritten by that page's next save. Same path as memory's.
  async function saveNote(pinId, newContent, newTitle, contentChanged, titleChanged) {
    const pin = pinById(pinId);
    if (!pin) return;
    if (!contentChanged && !titleChanged) return;
    const nextContent = contentChanged ? newContent : pin.content;
    const nextTitle = titleChanged ? newTitle : pin.title;
    let landed = null;
    if (contentChanged) {
      let written = null;
      landed = await writePinEdit({
        pin, liveNode: null, nodeFor: (n) => (written = textIntoNode(n, newContent)),
        rowContent: nextContent, rowTitle: nextTitle, deps: pinEditDeps(),
      });
      // A note's title is the row's; a "source" landing wrote only the node.
      if (landed === "source" && titleChanged) {
        try { await updatePinContent(pinId, JSON.stringify(written), nextTitle); } catch (err) { console.error("pin title:", err); }
      }
    } else {
      try { await updatePinContent(pinId, pin.content, nextTitle); landed = "row"; } catch (err) { console.error("pin title:", err); }
    }
    if (!landed) {
      editNotice = "that edit did not save. the pin still holds what it held before.";
      return;
    }
    editNotice = "";
    patchPin(pinId, { content: nextContent, title: nextTitle });
  }

  async function toggleAutoInsert(obj) {
    const next = !obj.auto_insert;
    patchPin(obj.id, { auto_insert: next });
    try { await updatePinAutoInsert(obj.id, next); } catch {}
  }

  // Drop a pin's content into the current page. pinToNodes strips pinId, so
  // the injected copies are independent of the source pin row (that's the
  // designed behaviour — see appendNodesToDoc), and it places the pin's
  // title, which lives on the row rather than necessarily on the content
  // node. Shared with the carry-forward sweep: this used to be a second,
  // divergent implementation that assumed a note's content was plain text,
  // so a JSON-shaped note pasted its own serialization in as visible
  // characters and never carried its title at all.
  // Receives the EFFECTIVE pin (effectivePin), not the raw row. The panel
  // renders from `eff` — live content with the title already in blockTitle —
  // while the raw row's cache can hold a null title and a node with no
  // blockTitle. Injecting the raw row is what put the title outside the
  // block: withTitle saw an empty title and stamped nothing, or a non-board
  // cache and added a bold line. `eff` is what the user is looking at.
  function injectPinNow(pin) {
    // Inject with the title the row shows. The authoritative title is the
    // pin's title column; when that is blank the panel derives one from the
    // content (pinDisplayTitle), and inject must use the SAME value so the
    // injected block is not silently titleless. withTitle keeps a block's own
    // slot title over this when it has one, so a real blockTitle is never
    // clobbered by a derived fallback.
    const titled = { ...pin, title: (pin.title || "").trim() || pinDisplayTitle(pin) };
    // keepPinIds: the injected block is the pin, not a copy of it. Editing it
    // updates the pin, and the page it lands on becomes the pin's owner.
    const nodes = pinToNodes(titled, { keepPinIds: true });
    if (nodes.length === 0) return;
    onPinInject(nodes);
  }

  async function removePin(obj) {
    try { await deletePin(obj.id); dropPin(obj.id); onPinRemoved(obj.content); } catch {}
  }

  // ── inline title rename (in panel rows) ─────────────────────────────────
  // PinRow owns the in-row input + key handling. The parent only needs the
  // commit step: take the buffer the row reported, do the optimistic patch,
  // and route the persistent save (same-page splice vs cross-page write).
  async function commitInlineRename(p) {
    const newTitle = inlineRenameText.trim() || null;
    const current = p.title || null;
    if (newTitle === current) return;

    patchPin(p.id, { title: newTitle });

    // Pins whose node has no title slot (a paragraph, a heading, the
    // paragraph holding a file chip) keep their title on the ROW. Splicing
    // a blockTitle into such a node is a no-op the schema swallows, which
    // is what made a renamed note pin revert on the next save (issue #1).
    const liveNode = livePinNodes.get(p.id);
    if (pinTitleAuthority(p, liveNode) === "row") {
      try {
        await updatePinContent(p.id, p.content, newTitle);
        editNotice = "";
      } catch (err) {
        console.error("pin rename: the row write failed:", err);
        patchPin(p.id, { title: current });
        editNotice = "that rename did not save. the pin keeps its old name.";
      }
      return;
    }

    // A board's title is its node's blockTitle: written where the node is,
    // the open editor, else the stored page, else (no page holds it) the
    // row (pin-edit-route.js). Nothing taking it is said in the panel.
    const landed = await writePinEdit({
      pin: p,
      liveNode,
      nodeFor: (n) => ({ ...n, attrs: { ...(n.attrs || {}), blockTitle: newTitle } }),
      rowContent: p.content,
      rowTitle: newTitle,
      deps: pinEditDeps(),
    });
    if (!landed) {
      patchPin(p.id, { title: current });
      editNotice = "that rename did not save. the pin keeps its old name.";
    } else {
      editNotice = "";
    }
  }
  // ── source-page hover preview (E.3) ─────────────────────────────────────
  // Hovering a pin row's title for ~300ms mounts the same preview card
  // pageRef tokens use, but pointed at the pin's source page (not the pin's
  // own cached content). Answers "where did this come from?" without
  // commitment — no need to open the modal.
  let pinHoverTimer = null;
  let pinHoverLeave = null;
  const PIN_HOVER_DELAY = 300;
  const PIN_HOVER_LEAVE_GRACE = 80;
  function startPinHover(anchorEl, pin) {
    if (!pin?.source_page_id || pin.source_page_id === pageId) return;
    if (pinHoverLeave) { clearTimeout(pinHoverLeave); pinHoverLeave = null; }
    if (pinHoverTimer) { clearTimeout(pinHoverTimer); pinHoverTimer = null; }
    pinHoverTimer = setTimeout(async () => {
      try {
        const entry = await getPagePreviewFor(pin.source_page_id);
        if (!entry) return;
        if (!anchorEl.matches(":hover") && getActivePreviewOwner() !== anchorEl) return;
        mountPreviewCard(anchorEl, anchorEl, entry, () => {
          onNavigateToSource(pin.source_page_id);
        });
      } catch {}
    }, PIN_HOVER_DELAY);
  }
  function endPinHover(anchorEl) {
    if (pinHoverTimer) { clearTimeout(pinHoverTimer); pinHoverTimer = null; }
    if (pinHoverLeave) { clearTimeout(pinHoverLeave); pinHoverLeave = null; }
    pinHoverLeave = setTimeout(() => {
      if (getActivePreviewOwner() === anchorEl) {
        const cardEl = document.querySelector(".page-ref-preview");
        if (!cardEl || !cardEl.matches(":hover")) destroyPreview();
      }
    }, PIN_HOVER_LEAVE_GRACE);
  }

  // Long-press parity for touch — touch devices don't fire mouseenter,
  // so a 600ms hold on a row title surfaces the same source-page
  // preview a mouse user gets on hover. The pointer chain:
  //   pointerdown → start 600ms timer
  //   pointerup / cancel / leave → clear timer (gesture too short)
  //   timer fires → mount preview, mark longPressFired
  //   subsequent click (synthesized by browser) → suppressed if
  //                                               longPressFired is set
  // The suppress flag is cleared on the suppressed click itself (and on
  // a Card-level row click via handleRowClick), never on a stray
  // pointerdown. Clearing on pointerdown leaked: a fast follow-up tap
  // could no-op the flag before the suppressed click fired, letting the
  // long-press click slip through to openPin.
  let longPressTimer = null;
  let longPressAnchor = null;
  let longPressFired = false;
  const LONG_PRESS_MS = 600;

  function startLongPress(e, pin) {
    if (e.pointerType !== "touch") return;
    longPressAnchor = e.currentTarget;
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      startPinHover(longPressAnchor, pin);
    }, LONG_PRESS_MS);
  }
  function cancelLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }
  function maybeSuppressClick(e) {
    if (longPressFired) {
      e.preventDefault();
      e.stopPropagation();
      longPressFired = false;
      // The preview itself is still mounted; tapping outside dismisses
      // via the preview-card's own outside-click handler.
      return true;
    }
    return false;
  }

  // Row-level click guard. The Card click handler (open modal) does NOT
  // go through maybeSuppressClick because Card doesn't accept a custom
  // click filter. We interpose this function: if a long-press fired,
  // we swallow the click and clear the flag here — on the click that
  // was meant to be suppressed, not on some later pointerdown.
  function handleRowClick(obj, eff) {
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    if (pinModalFor(eff, livePinNodes.get(obj.id)) === "artifact") {
      openArtifactModal(eff);
    } else {
      openNoteModal(eff);
    }
  }

  // ── drag-to-reorder (within a section) ───────────────────────────────────
  // HTML5 native drag-and-drop. dragOverId is the row currently under the
  // cursor; on drop, the dragged pin is inserted before that row in the same
  // section's ordering, then `reorder_pins` writes the new positions.
  let draggingId = $state(null);
  let dragOverId = $state(null);

  function onRowDragStart(e, p) {
    draggingId = p.id;
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", p.id);
    } catch {}
  }
  function onRowDragOver(e, p) {
    if (!draggingId || draggingId === p.id) return;
    e.preventDefault();
    dragOverId = p.id;
  }
  function onRowDragLeave() { dragOverId = null; }
  async function onRowDrop(e, target, sectionPins) {
    e.preventDefault();
    if (!draggingId || draggingId === target.id) { draggingId = null; dragOverId = null; return; }
    const dragged = sectionPins.find((x) => x.id === draggingId);
    if (!dragged) { draggingId = null; dragOverId = null; return; }
    // Reorder the section's id list locally before persisting.
    const order = sectionPins.map((x) => x.id);
    const fromIdx = order.indexOf(draggingId);
    const toIdx = order.indexOf(target.id);
    if (fromIdx < 0 || toIdx < 0) { draggingId = null; dragOverId = null; return; }
    order.splice(fromIdx, 1);
    order.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, draggingId);
    // Optimistic: patch positions locally so the visual order updates now.
    order.forEach((id, i) => patchPin(id, { position: i + 1 }));
    draggingId = null;
    dragOverId = null;
    try { await reorderPins(order); } catch (err) { console.error("reorder failed:", err); }
  }

  /**
   * Format a stored ISO timestamp as a calm relative date string:
   *   today / yesterday / <day name> (within last 7d) / <D mon> / <D mon YYYY>.
   * Returns empty string for missing input. Used by the modal provenance row
   * and elsewhere we surface created/edited stamps.
   */
  function formatRelativeDate(iso) {
    if (!iso) return "";
    let d;
    try { d = new Date(iso); } catch { return ""; }
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((todayStart - target) / 86400000);
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    if (diffDays > 1 && diffDays < 7) {
      const dayNames = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
      return dayNames[d.getDay()];
    }
    if (d.getFullYear() === now.getFullYear()) {
      return `${d.getDate()} ${months[d.getMonth()]}`;
    }
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  /** Resolve a pin's source-page trail label as `trail:focus` (for provenance). */
  function sourcePageLabel(pin) {
    if (!pin?.source_page_lineage_id) return "untrailed";
    const lin = lineageById(pin.source_page_lineage_id);
    return lin ? lin.name : "(unknown trail)";
  }

  // Open one of the two modal types. Single state, no parallel slots:
  // setting `modal` to a new object replaces any previous open modal, so
  // there is no path that produces stacked overlays.
  function openArtifactModal(art) {
    modal = { type: "artifact", pinId: art.id };
    onPinLocate(art.id);
  }
  function openNoteModal(obj) {
    modal = { type: "note", pinId: obj.id };
    if (obj.object_type !== "note") onPinLocate(obj.id);
  }

  // What writePinEdit (pin-edit-route.js) writes through, here. The editor
  // step is the open page's splice; before the stored page is written, an
  // open editor on it settles its pending save (onBeforePageWrite), and
  // after, it re-reads the page (onPageWritten).
  function pinEditDeps() {
    return {
      spliceInEditor: (id, node) => onSamePagePinSave(id, node),
      beforeSourceWrite: (id) => onBeforePageWrite(id),
      loadPage: loadPageContentForModal,
      savePage: savePageContentWithPinRefresh,
      updateRow: updatePinContent,
      onPageWritten,
    };
  }

  // Shown in the panel when an edit or rename reached nowhere.
  let editNotice = $state("");

  // Save handler for the artifact modal. The child has already produced
  // the spliced node (with the canonical blockTitle attr); we just decide
  // where the write lands: same-page splice through the live editor, or
  // cross-page write via save_page_content_with_pin_refresh. The Rust
  // refresh_pin_caches hook runs as a side effect of the save in either
  // path, keeping pin row caches in sync.
  async function saveArtifact(pinId, newNode, newTitle, contentChanged, titleChanged) {
    const art = pinById(pinId);
    if (!art || !newNode) return;
    if (!contentChanged && !titleChanged) return;

    // A title change on a pin whose node has no title slot must go to the
    // row — the modal stamped `blockTitle` onto the node it handed back, and
    // for a file pin (a paragraph holding an inline attachment chip) the
    // schema drops it. The panel's isBoard() groups files WITH the boards,
    // so this cannot be routed on object_type; it has to be the node.
    // Issue #1.
    const titleToRow =
      titleChanged &&
      pinTitleAuthority(art, livePinNodes.get(art.id)) === "row";

    const landed = await writePinEdit({
      pin: art,
      liveNode: livePinNodes.get(art.id) || null,
      nodeFor: () => newNode,
      rowContent: JSON.stringify(asPinDoc(newNode)),
      rowTitle: titleChanged ? newTitle : art.title,
      deps: pinEditDeps(),
    });
    if (!landed) {
      // Nothing took the edit. Say so, and leave the row showing what is
      // stored rather than an edit that exists nowhere.
      editNotice = "that edit did not save. the pin still holds what it held before.";
      return;
    }
    editNotice = "";

    // Write the row's title after the content splice, not before: the splice
    // triggers a page save whose refresh_pin_caches hook rewrites the
    // content cache, and this call carries the same content forward rather
    // than an older copy of it. A "row" landing already wrote both.
    if (titleToRow && landed !== "row") {
      const carried = contentChanged
        ? JSON.stringify(asPinDoc(newNode))
        : art.content;
      try { await updatePinContent(art.id, carried, newTitle); } catch {}
    }

    // Optimistic local patch so the panel doesn't lag the modal close.
    // Wrap the spliced node back into a doc shape — that's the format the
    // pin row's content cache expects (parseContent on the read side will
    // unwrap if needed).
    const newDoc = asPinDoc(newNode);
    patchPin(art.id, {
      content: contentChanged ? JSON.stringify(newDoc) : art.content,
      title: titleChanged ? newTitle : art.title,
    });
  }

  // Per-section render cap. Sections render the first 50 rows; users
  // expand in 50-row chunks via the "show N more" affordance. Avoids
  // rendering thousands of PinRow components when a global pin set
  // grows past comfortable list size.
  const SECTION_PAGE_SIZE = 50;
  let sectionLimit = $state(/** @type {Record<string, number>} */ ({}));
  function loadMore(label) {
    const cur = sectionLimit[label] ?? SECTION_PAGE_SIZE;
    sectionLimit = { ...sectionLimit, [label]: cur + SECTION_PAGE_SIZE };
  }
</script>

{#if !docked}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onclick={onClose} transition:fade={{ duration: 120 }}></div>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  class="panel"
  class:docked
  aria-label={title}
  bind:this={panelEl}
  onfocusin={handleFocusIn}
  onfocusout={handleFocusOut}
  onkeydown={handlePanelKeydown}
  transition:fade={{ duration: 120 }}
>
  <header class="panel-head">
    <div class="head-row">
      <button class="panel-back" type="button" onclick={onClose} aria-label="close pins">‹</button>
      <h2 class="panel-title">{title}</h2>
      <button class="panel-close" type="button" onclick={onClose} aria-label="close pins">×</button>
    </div>
    <div class="panel-search">
      <Input variant="search" bind:value={query} placeholder={searchPlaceholder(filter, lineageId)} ariaLabel="search pins" />
    </div>
    <div class="chips" role="group" aria-label="filter pins">
      {#each chips as chip (chip.id)}
        <button
          type="button"
          class="f-chip"
          class:on={chip.active}
          aria-pressed={chip.menu ? undefined : chip.active}
          aria-haspopup={chip.menu ? "menu" : undefined}
          aria-expanded={chip.menu ? kindMenuOpen : undefined}
          onclick={(e) => pressChip(chip, e)}
        >{chip.label}{#if chip.count != null}<span class="f-n">{chip.count}</span>{/if}</button>
      {/each}
    </div>
  </header>

  <div class="panel-body">
    {#if editNotice}
      <p class="edit-notice label" role="status">{editNotice}</p>
    {/if}
    {#if loading}
      <div class="empty-loading"><p class="empty-text label">loading…</p></div>
    {:else if emptyState}
      <div class="empty" role="status">
        <p class="empty-title">{emptyState.title}</p>
        {#if emptyState.body}<p class="empty-body">{emptyState.body}</p>{/if}
        {#if emptyState.action === "clearFilters"}
          <Button variant="subtle" onClick={clearFilters}>clear filters</Button>
        {:else if emptyState.action === "chooseTrail" && canChooseTrail}
          <Button variant="subtle" onClick={onChooseTrail}>choose a trail</Button>
        {/if}
      </div>
    {:else}
      {#each sections as section, si (section.key)}
        {@const limit = sectionLimit[section.key] ?? SECTION_PAGE_SIZE}
        <div class="sec-line">
          <h3 class="sec-label">{section.label} · {section.pins.length}</h3>
          {#if si === 0}
            <button
              type="button"
              class="sort-btn"
              bind:this={sortBtnEl}
              aria-haspopup="menu"
              aria-expanded={sortMenuOpen}
              aria-label={`order: ${filter.sort === SORT_NEWEST ? "newest" : "your order"}`}
              onclick={() => (sortMenuOpen = !sortMenuOpen)}
            >{filter.sort === SORT_NEWEST ? "newest" : "your order"} ▾</button>
          {/if}
        </div>
        <div class="pin-rows">
          {#each section.pins.slice(0, limit) as obj (obj.id)}
            {@const eff = effectivePin(obj)}
            <PinRow
              pin={obj}
              eff={eff}
              isBoard={isBoard(obj)}
              lineages={allLineages}
              sourceLine={pinSourceLine(obj, { filter, lineageId, lineages: allLineages })}
              localBlobs={localBlobs}
              samePage={obj.source_page_id === pageId}
              canPutOnPage={canPutOnPage}
              sortMode={reorderable ? "position" : "newest"}
              draggingId={draggingId}
              dragOverId={dragOverId}
              onClick={() => handleRowClick(obj, eff)}
              onRename={async (t) => {
                inlineRenameText = t || "";
                await commitInlineRename(obj);
              }}
              onCarryForward={() => toggleAutoInsert(obj)}
              onInject={() => injectPinNow(eff)}
              onDelete={() => removePin(obj)}
              onMove={(target) => movePin(obj, target)}
              onDragStart={(e) => onRowDragStart(e, obj)}
              onDragOver={(e) => onRowDragOver(e, obj)}
              onDragLeave={onRowDragLeave}
              onDrop={(e) => onRowDrop(e, obj, section.pins)}
            />
          {/each}
          {#if section.pins.length > limit}
            <div class="show-more">
              <Button variant="subtle" onClick={() => loadMore(section.key)}>
                show {section.pins.length - limit} more
              </Button>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</aside>

<Popover anchor={kindChipEl} open={kindMenuOpen} role="menu" title="kind" placement="bottom-end" onClose={() => (kindMenuOpen = false)}>
  <div class="menu-list">
    {#each KINDS as k (k)}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={filter.kind === k}
        class="menu-item"
        class:on={filter.kind === k}
        onclick={() => { chipState = setKind(chipState, k); kindMenuOpen = false; }}
      ><span>{k}</span><span class="f-n">{kindCounts[k]}</span></button>
    {/each}
    {#if filter.kind}
      <button type="button" role="menuitem" class="menu-item" onclick={() => { chipState = setKind(chipState, null); kindMenuOpen = false; }}>any kind</button>
    {/if}
  </div>
</Popover>

<Popover anchor={sortBtnEl} open={sortMenuOpen} role="menu" title="order" placement="bottom-end" onClose={() => (sortMenuOpen = false)}>
  <div class="menu-list">
    <button type="button" role="menuitemradio" aria-checked={filter.sort === SORT_DEFAULT} class="menu-item" class:on={filter.sort === SORT_DEFAULT}
      onclick={() => { chipState = { ...chipState, sort: SORT_DEFAULT }; sortMenuOpen = false; }}>your order</button>
    <button type="button" role="menuitemradio" aria-checked={filter.sort === SORT_NEWEST} class="menu-item" class:on={filter.sort === SORT_NEWEST}
      onclick={() => { chipState = { ...chipState, sort: SORT_NEWEST }; sortMenuOpen = false; }}>newest</button>
  </div>
</Popover>

<!-- Single modal slot. `modal` is either null, an artifact-typed handle,
     or a note-typed handle. Setting `modal` to a new value always replaces
     any previous open modal, so there is no path that yields stacked
     overlays (the bug class the v0.4 UI audit flagged). -->
{#if modal?.type === "artifact"}
  {@const pin = pinForModal(pinById(modal.pinId), livePinNodes.get(modal.pinId))}
  {#if pin}
    <PinArtifactModal
      pin={pin}
      samePage={pin.source_page_id === pageId}
      scopeLabel={pin.lineage_id ? (lineageById(pin.lineage_id)?.name || "trail") : "global"}
      scopeVariant={pin.lineage_id ? "neutral" : "accent"}
      sourceLabel={sourcePageLabel(pin)}
      backlinks={pinBacklinks}
      formatRelativeDate={formatRelativeDate}
      onClose={() => (modal = null)}
      onSave={(newNode, newTitle, contentChanged, titleChanged) => saveArtifact(pin.id, newNode, newTitle, contentChanged, titleChanged)}
      onDelete={() => { removePin(pin); modal = null; }}
      onToggleAutoInsert={() => toggleAutoInsert(pin)}
      onInject={() => injectPinNow(effectivePin(pin))}
      onNavigateToSource={onNavigateToSource}
    />
  {/if}
{:else if modal?.type === "note"}
  {@const pin = pinById(modal.pinId)}
  {#if pin}
    <PinNoteModal
      pin={pin}
      samePage={pin.source_page_id === pageId}
      scopeLabel={pin.lineage_id ? (lineageById(pin.lineage_id)?.name || "trail") : "global"}
      scopeVariant={pin.lineage_id ? "neutral" : "accent"}
      sourceLabel={sourcePageLabel(pin)}
      backlinks={pinBacklinks}
      formatRelativeDate={formatRelativeDate}
      onClose={() => (modal = null)}
      onSave={(newContent, newTitle, contentChanged, titleChanged) => saveNote(pin.id, newContent, newTitle, contentChanged, titleChanged)}
      onDelete={() => { removePin(pin); modal = null; }}
      onToggleAutoInsert={() => toggleAutoInsert(pin)}
      onInject={() => injectPinNow(effectivePin(pin))}
      onNavigateToSource={onNavigateToSource}
    />
  {/if}
{/if}

<style>
  /* The page dims behind the panel only when the panel is a layer over it
     (narrow windows). Docked beside the page there is no scrim: the page
     stays live (spec 2026-11-01 §1). */
  .overlay { position: fixed; inset: 0; z-index: 149; background: var(--scrim-soft); }

  .edit-notice { margin: 0 0 8px; color: var(--ink-soft); }

  /* Right-anchored. As an overlay it floats with the modal shadow; docked
     it is part of the desk, a hairline at its edge and no shadow, the
     same width the page makes room for (pins-dock.js DOCK_PANEL_WIDTH). */
  .panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: 380px; max-width: 92vw;
    background: var(--surface-raised);
    border-left: 1px solid var(--elev-border);
    box-shadow: var(--elev-2);
    z-index: 150;
    display: flex; flex-direction: column;
    min-height: 0;
  }
  .panel.docked { box-shadow: none; z-index: 40; }
  @media (max-width: 768px), (orientation: landscape) and (max-height: 480px) {
    .panel { width: 100%; max-width: 100%; border-left: none; box-shadow: none; }
  }

  .panel-head {
    flex-shrink: 0;
    padding: 0.875rem 1rem 0.625rem;
    border-bottom: 1px solid var(--elev-border);
  }
  .head-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.625rem; }
  .panel-title {
    margin: 0 auto 0 0;
    min-width: 0;
    font-family: "DM Mono", monospace;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel-close, .panel-back {
    background: none; border: none; cursor: pointer;
    color: var(--ink-soft);
    border-radius: var(--radius-sm, 0.25rem);
    transition: color var(--motion-fast), background-color var(--motion-fast);
  }
  .panel-close { font-size: 1.125rem; line-height: 1; padding: 0.25rem 0.5rem; }
  .panel-close:hover, .panel-back:hover { color: var(--ink); background: var(--hover-tint); }
  .panel-back {
    display: none;
    width: 2.5rem; height: 2.5rem;
    margin-left: -0.5rem;
    font-family: "Lora", Georgia, serif;
    font-size: 1.5rem; line-height: 1;
    align-items: center; justify-content: center;
  }
  /* Phone: the universal back arrow at the left instead of the ×. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .panel-head { padding-top: calc(var(--safe-top) + 0.5rem); }
    .panel-close { display: none; }
    .panel-back { display: inline-flex; }
    .panel-title { font-family: "Lora", serif; font-size: 1.25rem; font-weight: 500; }
  }

  .panel-search { margin-bottom: 0.625rem; }

  /* One row of chips. Wraps on the desktop's 380px; never a hidden
     sidebar again. */
  .chips { display: flex; flex-wrap: wrap; gap: 0.375rem; }
  .f-chip {
    font-family: "DM Mono", monospace;
    font-size: 0.75rem;
    line-height: 1.2;
    border: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
    border-radius: 999px;
    padding: 0.25rem 0.625rem;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    white-space: nowrap;
    transition: background-color var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
  }
  .f-chip:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 24%, transparent); }
  .f-chip.on {
    background: color-mix(in srgb, var(--warm-accent) 14%, transparent);
    border-color: transparent;
    color: var(--accent-text);
  }
  .f-n { margin-left: 0.3125rem; color: var(--ink-soft); }
  .f-chip.on .f-n { color: inherit; opacity: 0.8; }

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    /* Bottom room so the last row scrolls clear of the shortcuts "?"
       that sits fixed in the window's corner. */
    padding: 0.75rem 1rem 3.5rem;
    overscroll-behavior: contain;
  }

  .sec-line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin: 0.375rem 0 0.5rem;
  }
  .sec-line:not(:first-of-type) { margin-top: 0.875rem; }
  .sec-label {
    margin: 0;
    font-family: "DM Mono", monospace;
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sort-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    font-family: "DM Mono", monospace;
    font-size: 0.75rem;
    color: var(--ink-soft);
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
  }
  .sort-btn:hover, .sort-btn[aria-expanded="true"] { color: var(--ink); background: var(--hover-tint); }

  .menu-list { display: flex; flex-direction: column; min-width: 10rem; padding: 0.25rem; }
  .menu-item {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
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
  .menu-item:hover, .menu-item:focus-visible { background: var(--hover-tint); }
  .menu-item.on { color: var(--accent-text); }

  .pin-rows { display: flex; flex-direction: column; }

  .show-more { display: flex; justify-content: center; padding: 0.25rem 0 0.5rem; }

  .empty-loading { display: flex; align-items: center; justify-content: center; padding: 2rem 1rem; }
  .empty-text { font-family: "Lora", serif; font-style: italic; font-size: 0.875rem; color: var(--ink-soft); }

  .empty {
    padding: 2rem 0.75rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
  }
  .empty-title { margin: 0; font-family: "Lora", serif; font-size: 0.9375rem; color: var(--ink); }
  .empty-body { margin: 0 0 0.5rem; font-family: "Lora", serif; font-size: 0.875rem; line-height: 1.5; color: var(--ink-soft); }

  /* Pin modal styles live in PinArtifactModal.svelte and PinNoteModal.svelte. */
</style>
