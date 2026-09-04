<script>
  import { fade } from "svelte/transition";
  import { untrack, onMount, onDestroy } from "svelte";
  import { navPush, navClose } from "../lib/navstack.js";
  import { pinToNodes } from "../lib/pin-carry-forward.js";
  import { pinTitleAuthority } from "../lib/pin-title-authority.js";
  import {
    getPins, updatePinContent, updatePinScope, deletePin,
    getLineages, updatePinAutoInsert, reorderPins,
    loadPageContentForModal, savePageContentWithPinRefresh,
    getBacklinksForPin,
    attachmentList,
  } from "../lib/api.js";
  import { attachmentLocality } from "../lib/attachment-locality.js";
  import { buildMentionLabel } from "../lib/mention-label.js";
  import { pinFamily, pinDisplayTitle, pinSearchText, pinModalKind } from "../lib/pin-display.js";
  import SidebarShell from "../lib/ui/SidebarShell.svelte";
  import SidebarNavRow from "../lib/ui/SidebarNavRow.svelte";
  import SectionHeader from "../lib/ui/SectionHeader.svelte";
  import BottomSheet from "../lib/ui/BottomSheet.svelte";
  import { isPhoneViewport, watchPhoneViewport } from "../lib/responsive.js";
  import Empty from "../lib/ui/Empty.svelte";
  import Input from "../lib/ui/Input.svelte";
  import Chip from "../lib/ui/Chip.svelte";
  import Button from "../lib/ui/Button.svelte";
  import TriggerChip from "../lib/ui/TriggerChip.svelte";
  import PinRow from "./pins/PinRow.svelte";
  import PinArtifactModal from "./pins/PinArtifactModal.svelte";
  import PinNoteModal from "./pins/PinNoteModal.svelte";
  import {
    getPagePreviewFor,
    mountPreviewCard,
    destroyPreview,
    getActivePreviewOwner,
  } from "../lib/render/preview-card.js";

  /** @type {{ lineageId: string|null, lineageName: string, pageId: string, editorDoc: any, onClose: () => void, onPinRemoved: (content: string) => void, onPinInject: (nodes: any[]) => void, onPinLocate: (pinId: string) => void, onSamePagePinSave: (pinId: string, newNode: any) => void, onNavigateToSource: (pageId: string) => void }} */
  let { lineageId = null, lineageName = "", pageId, refreshToken = 0, editorDoc = null, openPinId = null, onPinOpened = () => {}, onClose, onPinRemoved = () => {}, onPinInject = () => {}, onPinLocate = () => {}, onSamePagePinSave = () => {}, onNavigateToSource = () => {} } = $props();

  // The panel is mounted/unmounted by the caller's {#if} (there's no
  // internal open prop to react to), so it registers on the navstack once
  // on mount and cleans up on unmount — same idea as BottomSheet, just
  // pinned to the component lifecycle instead of a reactive `open` prop.
  // Hardware back closes the panel via the same onClose the close/back
  // buttons and the overlay click already use. hideBar: true so the
  // MobileActionBar steps aside while the panel (and any pin modal nested
  // inside it) is open.
  let panelNavId = null;
  onMount(() => {
    panelNavId = navPush("shared-objects-panel", () => {
      panelNavId = null;
      onClose?.();
    }, { hideBar: true });
  });
  onDestroy(() => {
    if (panelNavId !== null) navClose(panelNavId);
  });

  // Pin lists split by scope so the sectioned feed can render them together.
  // Trail tab semantics (current + ancestors) remain; we fetch global in
  // parallel and concatenate. The derived `allPins` is the union; downstream
  // code that read the old `pins` variable now reads `allPins` (same shape).
  let pinsTrail = $state([]);
  let pinsGlobal = $state([]);
  let allPins = $derived([...pinsTrail, ...pinsGlobal]);

  /**
   * Patch one pin everywhere it lives (trail or global). Used after optimistic
   * mutations so the local view updates before the round-trip lands. If the
   * pin's scope changed (`update_pin_scope`), the caller is expected to call
   * `loadPins()` afterwards — the backend re-evaluates ancestry visibility.
   */
  function patchPin(id, mut) {
    pinsTrail = pinsTrail.map((p) => (p.id === id ? { ...p, ...mut } : p));
    pinsGlobal = pinsGlobal.map((p) => (p.id === id ? { ...p, ...mut } : p));
  }

  /** Drop a pin everywhere it lives. Used by removePin. */
  function dropPin(id) {
    pinsTrail = pinsTrail.filter((p) => p.id !== id);
    pinsGlobal = pinsGlobal.filter((p) => p.id !== id);
  }

  // Same-page live pin contents: walk the current editor's doc once, build
  // a map of pinId -> live node JSON. Pin rows whose source_page_id === pageId
  // render from this map; if their pinId is missing, fall back to cache.
  let livePinNodes = $derived.by(() => {
    if (!editorDoc) return new Map();
    const map = new Map();
    function walk(node) {
      if (node?.attrs?.pinId) map.set(node.attrs.pinId, node);
      if (Array.isArray(node?.content)) {
        for (const child of node.content) walk(child);
      }
    }
    walk(editorDoc);
    return map;
  });

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
    const liveTitle = (live.attrs?.blockTitle || "").trim();
    if (isBoard(p)) {
      return {
        ...p,
        content: JSON.stringify({ type: "doc", content: [live] }),
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
    const target = [...pinsTrail, ...pinsGlobal].find((p) => p.id === openPinId);
    if (!target) return;
    // pinModalKind, not isBoard: the modal fork asks about the CONTENT's
    // shape (a doc needs a doc renderer; only a real plain string belongs
    // in the note modal's textarea), while isBoard below is this panel's
    // bucketing/sorting question. They were the same list here and a
    // different one in Memory, which is how the same pin opened two
    // different modals depending on where it was clicked.
    modal = { type: pinModalKind(target), pinId: target.id };
    onPinOpened();
  });
  let allLineages = $state([]);
  let scopeMenuFor = $state(null); // pin id whose scope menu is open

  // Side-nav filter state (Task 2.3). Single-select category + scope; the
  // old multi-select chip set (`filters.types: Set`, `filters.recent`, etc.)
  // collapsed into these axes plus a single carry-forward-only toggle and
  // a free-text search.
  let query = $state("");
  let cat = $state(/** @type {"all"|"text"|"lists"|"structure"|"charts"|"code"|"files"} */ ("all"));
  let scope = $state(/** @type {"any"|"here"|"inherited"|"global"} */ ("any"));
  let carriesOnly = $state(false);
  let onPageOnly = $state(false);
  let drawerOpen = $state(false);

  // Phone branch: replace the sidebar drawer with a bottom-sheet filter.
  // The shell loses its sidebar entirely on phone; the user opens
  // filters via an explicit toolbar button.
  let isPhone = $state(isPhoneViewport());
  let filterSheetOpen = $state(false);
  $effect(() => {
    const unwatch = watchPhoneViewport((m) => { isPhone = m; });
    return unwatch;
  });

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
  function parentLineageOf(id) {
    const l = lineageById(id);
    return l ? lineageById(l.parent_id) : null;
  }
  // Walk parent_id up to root; root -> self order. Empty for global pins.
  function lineagePathFor(id) {
    if (!id) return [];
    const out = [];
    let cur = lineageById(id);
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.unshift({ id: cur.id, name: cur.name });
      cur = cur.parent_id ? lineageById(cur.parent_id) : null;
    }
    return out;
  }

  // Actions available on a pin based on its current scope + birth page's trail.
  function scopeActionsFor(pin) {
    const actions = [];
    const parent = parentLineageOf(pin.lineage_id);
    if (parent) {
      actions.push({ kind: "share-up", label: `share up to ${parent.name}`, target: parent.id });
    }
    if (pin.lineage_id) {
      actions.push({ kind: "make-global", label: "make global", target: null });
    }
    const birth = lineageById(pin.source_page_lineage_id);
    if (birth && birth.id !== pin.lineage_id) {
      actions.push({ kind: "restore", label: `restore to ${birth.name}`, target: birth.id });
    }
    return actions;
  }

  async function applyScopeAction(pin, action) {
    scopeMenuFor = null;
    // Optimistic local update; if the pin is no longer visible from here, drop it.
    const nextId = action.target;
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
      getLineages().then((list) => { allLineages = list || []; }).catch(() => {});
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
      const [trailRows, globalRows, attachments] = await Promise.all([
        lineageId ? getPins(lineageId) : Promise.resolve([]),
        getPins(null),
        // Isolated catch: pins must still render on a device where the
        // attachment surface is unavailable.
        attachmentList().catch(() => null),
      ]);
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
  const isNote = (o) => !isBoard(o);

  // Scope key for a pin in the current panel context. Used both for the
  // sidebar scope counts and for grouping the visible feed into sections.
  function scopeOf(p) {
    if (p.lineage_id == null) return "global";
    if (p.lineage_id === lineageId) return "here";
    return "inherited";
  }

  // Side-nav counts — computed against the unfiltered union so the user
  // always sees the full size of each axis, not the post-filter remainder.
  let textCount = $derived(allPins.filter((p) => pinFamily(p) === "text").length);
  let listsCount = $derived(allPins.filter((p) => pinFamily(p) === "lists").length);
  let structureCount = $derived(allPins.filter((p) => pinFamily(p) === "structure").length);
  let chartsCount = $derived(allPins.filter((p) => pinFamily(p) === "charts").length);
  let codeCount = $derived(allPins.filter((p) => pinFamily(p) === "code").length);
  let filesCount = $derived(allPins.filter((p) => pinFamily(p) === "files").length);
  let carriesCount = $derived(allPins.filter((p) => p.auto_insert).length);
  let onPageCount = $derived(allPins.filter((p) => p.source_page_id === pageId).length);
  let allCount = $derived(allPins.length);
  let hereCount = $derived(allPins.filter((p) => scopeOf(p) === "here").length);
  let inheritedCount = $derived(allPins.filter((p) => scopeOf(p) === "inherited").length);
  let globalCount = $derived(allPins.filter((p) => scopeOf(p) === "global").length);

  // Memoize pin content parsing. Keyed by pin id + updated_at so we
  // re-parse automatically when a pin row's updated_at advances on save.
  // Caveat: for same-page pins, effectivePin() synthesizes a fresh content
  // string from the live editor doc; between saves, that synthesized
  // content is not reflected here (we still return the last cached parse
  // for the pin's updated_at). The board-type / summary helpers are
  // tolerant of this lag because those signals only change on save.
  const parsedContentCache = new Map();
  function getParsedContent(pin) {
    if (!pin) return null;
    const key = `${pin.id}:${pin.updated_at || ""}`;
    if (parsedContentCache.has(key)) return parsedContentCache.get(key);
    let parsed = null;
    try { parsed = JSON.parse(pin.content); } catch { parsed = null; }
    parsedContentCache.set(key, parsed);
    return parsed;
  }

  function getPlainText(pin) {
    const parsed = getParsedContent(pin);
    if (parsed && parsed.type === "doc" && parsed.content) {
      function walk(node) {
        if (node.text) return node.text;
        if (node.content) return node.content.map(walk).join(" ");
        return "";
      }
      return parsed.content.map(walk).join(" ");
    }
    return (pin && pin.content) || "";
  }

  /**
   * Search predicate. Substring over everything the pin has words in.
   * Never status-based — `open / closed / orphaned` is an implementation
   * detail.
   *
   * The haystack comes from pin-display's pinSearchText rather than the
   * local getPlainText walk below: that one cannot see a block's title
   * (it is a node ATTRIBUTE, not a text node) and falls back to the raw
   * JSON string for anything it doesn't recognise, which made schema keys
   * like "paragraph" matchable. getPlainText stays for the carry-forward
   * row's label, where a title would only duplicate the line above it.
   */
  function pinMatches(p, q) {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return pinSearchText(p).toLowerCase().includes(needle);
  }

  let visiblePins = $derived.by(() => {
    let r = allPins;
    if (cat !== "all") r = r.filter((p) => pinFamily(p) === cat);
    if (scope !== "any") r = r.filter((p) => scopeOf(p) === scope);
    if (carriesOnly) r = r.filter((p) => p.auto_insert);
    if (onPageOnly) r = r.filter((p) => p.source_page_id === pageId);
    if (query.trim()) r = r.filter((p) => pinMatches(p, query));
    // Stable order: object_type bucket, then position.
    return [...r].sort((a, b) => {
      const t = (a.object_type || "").localeCompare(b.object_type || "");
      if (t !== 0) return t;
      return (a.position || 0) - (b.position || 0);
    });
  });

  /**
   * Group visible pins into ordered sections by scope:
   *   - "on this trail" (lineage_id === current)
   *   - "inherited" (any ancestor)
   *   - "global" (lineage_id === null)
   */
  let sections = $derived.by(() => {
    const groups = { here: [], inherited: [], global: [] };
    for (const p of visiblePins) {
      const s = scopeOf(p);
      if (groups[s]) groups[s].push(p);
    }
    const out = [];
    if (groups.here.length) out.push({ label: "on this trail", pins: groups.here });
    if (groups.inherited.length) out.push({ label: "inherited", pins: groups.inherited });
    if (groups.global.length) out.push({ label: "global", pins: groups.global });
    return out;
  });

  function hasActivePinFilters() {
    return cat !== "all" || scope !== "any" || carriesOnly || onPageOnly || query.trim().length > 0;
  }

  function clearFilters() {
    cat = "all";
    scope = "any";
    carriesOnly = false;
    onPageOnly = false;
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

  // Carry-forward pins for the current trail (strict ownership; not
  // inherited). Surfaces in the panel footer so the user can see what will
  // auto-insert into tomorrow's first page on this trail.
  let carryForwardPins = $derived(
    lineageId
      ? allPins.filter((p) =>
          p.lineage_id === lineageId && p.auto_insert && p.status !== "orphaned",
        )
      : [],
  );
  let carryForwardOpen = $state(false);

  // Lookup helper used by the single-modal render block to resolve the
  // current pin row by id, so the modal child sees an always-up-to-date
  // pin (after patchPin mutations).
  function pinById(id) {
    return allPins.find((p) => p.id === id) || null;
  }

  // Save handler for the text-pin (note) modal. Mirrors the original
  // finishEditNote semantics: optimistic local patch + persistence.
  async function saveNote(pinId, newContent, newTitle, contentChanged, titleChanged) {
    const pin = pinById(pinId);
    if (!pin) return;
    if (!contentChanged && !titleChanged) return;
    patchPin(pinId, {
      content: contentChanged ? newContent : pin.content,
      title: titleChanged ? newTitle : pin.title,
    });
    try { await updatePinContent(pinId, contentChanged ? newContent : pin.content, newTitle); } catch {}
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
      try { await updatePinContent(p.id, p.content, newTitle); } catch {}
      return;
    }

    // For same-page pins, dispatch the title change onto the live editor's
    // node so the canvas reflects it immediately. The editor's save path
    // refreshes the pin cache via the Rust hook.
    if (p.source_page_id === pageId) {
      // The same-page splice path expects a whole node; build it from the
      // live editor's current node by swapping in the new blockTitle attr.
      if (liveNode) {
        const next = { ...liveNode, attrs: { ...(liveNode.attrs || {}), blockTitle: newTitle } };
        onSamePagePinSave(p.id, next);
        return;
      }
    }

    // Cross-page rename: load source, splice the node with the new title
    // attribute, save. Same refresh_pin_caches hook runs as a side effect.
    try {
      const sourceContent = await loadPageContentForModal(p.source_page_id);
      const sourceDoc = JSON.parse(sourceContent || '{"type":"doc","content":[]}');
      const updated = walkAndSetTitle(sourceDoc, p.id, newTitle);
      await savePageContentWithPinRefresh(p.source_page_id, JSON.stringify(updated));
    } catch (err) {
      console.error("Inline rename failed for cross-page pin:", err);
    }
  }
  function walkAndSetTitle(node, pinId, title) {
    if (node?.attrs?.pinId === pinId) {
      return { ...node, attrs: { ...(node.attrs || {}), blockTitle: title } };
    }
    if (Array.isArray(node?.content)) {
      return { ...node, content: node.content.map((c) => walkAndSetTitle(c, pinId, title)) };
    }
    return node;
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
    if (pinModalKind(eff) === "artifact") {
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

  function spliceNodeByPinId(doc, pinId, newNode) {
    function walk(node) {
      if (node?.attrs?.pinId === pinId) return newNode;
      if (Array.isArray(node?.content)) {
        return { ...node, content: node.content.map(walk) };
      }
      return node;
    }
    return walk(doc);
  }

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

    try {
      if (art.source_page_id === pageId) {
        // Same-page: splice the new node into the MAIN editor's PM doc.
        // The editor's onUpdate fires, debouncedSave runs save_page_content,
        // and the Rust refresh_pin_caches hook updates this pin row's cache.
        onSamePagePinSave(art.id, newNode);
      } else {
        // Cross-page: load source page, splice, save via Tauri command.
        // Same refresh_pin_caches hook runs as a side effect of the save.
        const sourceContent = await loadPageContentForModal(art.source_page_id);
        const sourceDoc = JSON.parse(sourceContent || '{"type":"doc","content":[]}');
        const updated = spliceNodeByPinId(sourceDoc, art.id, newNode);
        await savePageContentWithPinRefresh(art.source_page_id, JSON.stringify(updated));
      }
    } catch (err) {
      console.error("Failed to save pin edit:", err);
    }

    // Write the row's title after the content splice, not before: the splice
    // triggers a page save whose refresh_pin_caches hook rewrites the
    // content cache, and this call carries the same content forward rather
    // than an older copy of it.
    if (titleToRow) {
      const carried = contentChanged
        ? JSON.stringify({ type: "doc", content: [newNode] })
        : art.content;
      try { await updatePinContent(art.id, carried, newTitle); } catch {}
    }

    // Optimistic local patch so the panel doesn't lag the modal close.
    // Wrap the spliced node back into a doc shape — that's the format the
    // pin row's content cache expects (parseContent on the read side will
    // unwrap if needed).
    const newDoc = { type: "doc", content: [newNode] };
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

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose} transition:fade={{ duration: 120 }}></div>

<!-- Filter rows snippet — defined at top level so both the SidebarShell
     sidebar (desktop) and the BottomSheet (phone, which lives outside
     .panel) can render it. Svelte 5 snippets are lexically scoped. -->
{#snippet filterRows()}
  <SidebarNavRow active={cat === "all"}       accent={cat === "all"}       count={allCount}       onClick={() => (cat = "all")}>all</SidebarNavRow>
  <SidebarNavRow active={cat === "text"}      accent={cat === "text"}      count={textCount}      onClick={() => (cat = cat === "text"      ? "all" : "text")}>text</SidebarNavRow>
  <SidebarNavRow active={cat === "lists"}     accent={cat === "lists"}     count={listsCount}     onClick={() => (cat = cat === "lists"     ? "all" : "lists")}>lists</SidebarNavRow>
  <SidebarNavRow active={cat === "structure"} accent={cat === "structure"} count={structureCount} onClick={() => (cat = cat === "structure" ? "all" : "structure")}>structure</SidebarNavRow>
  <SidebarNavRow active={cat === "charts"}    accent={cat === "charts"}    count={chartsCount}    onClick={() => (cat = cat === "charts"    ? "all" : "charts")}>charts</SidebarNavRow>
  <SidebarNavRow active={cat === "code"}      accent={cat === "code"}      count={codeCount}      onClick={() => (cat = cat === "code"      ? "all" : "code")}>code</SidebarNavRow>
  <SidebarNavRow active={cat === "files"}     accent={cat === "files"}     count={filesCount}     onClick={() => (cat = cat === "files"     ? "all" : "files")}>files</SidebarNavRow>

  <SectionHeader label="filters" />
  <SidebarNavRow active={carriesOnly} accent={carriesOnly} count={carriesCount} onClick={() => (carriesOnly = !carriesOnly)}>carries</SidebarNavRow>
  {#if lineageId == null}
    <SidebarNavRow active={onPageOnly} accent={onPageOnly} count={onPageCount} onClick={() => (onPageOnly = !onPageOnly)}>on page</SidebarNavRow>
  {/if}

  <SectionHeader label="scope" />
  <SidebarNavRow active={scope === "here"}      accent={scope === "here"}      count={hereCount}      onClick={() => (scope = scope === "here" ? "any" : "here")}>this trail</SidebarNavRow>
  <SidebarNavRow active={scope === "inherited"} accent={scope === "inherited"} count={inheritedCount} onClick={() => (scope = scope === "inherited" ? "any" : "inherited")}>inherited</SidebarNavRow>
  <SidebarNavRow active={scope === "global"}    accent={scope === "global"}    count={globalCount}    onClick={() => (scope = scope === "global" ? "any" : "global")}>global</SidebarNavRow>
{/snippet}

<div class="panel" transition:fade={{ duration: 120 }}>
  <button class="panel-close" onclick={onClose} aria-label="close">×</button>
  <button class="panel-back" onclick={onClose} aria-label="back">‹</button>

  <SidebarShell sidebarWidth="11rem" density="compact" sidebarMode="auto" bind:drawerOpen>
    {#if !isPhone}
      {#snippet sidebar()}
        {@render filterRows()}
      {/snippet}
    {/if}

    {#snippet toolbar()}
      {#if isPhone}
        <div class="phone-toolbar">
          <div class="phone-header">
            <h2 class="phone-title">pins</h2>
          </div>
          <div class="phone-search-row">
            <div class="toolbar-search"><Input variant="search" bind:value={query} placeholder="search pins…" /></div>
            <TriggerChip
              active={filterSheetOpen}
              onClick={() => (filterSheetOpen = true)}
              ariaLabel="open filters"
            >
              {#snippet leading()}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 5h18M6 12h12M10 19h4" />
                </svg>
              {/snippet}
              filter
            </TriggerChip>
          </div>
        </div>
      {:else}
        <div class="toolbar-search"><Input variant="search" bind:value={query} placeholder="search pins…" /></div>
      {/if}
    {/snippet}

    {#snippet footer()}
      {#if carryForwardPins.length > 0}
        <div class="cf-footer" class:open={carryForwardOpen}>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="cf-summary" onclick={() => (carryForwardOpen = !carryForwardOpen)}>
            <span class="cf-caret">{carryForwardOpen ? "▾" : "▸"}</span>
            <span class="cf-text">
              tomorrow's first lines · {carryForwardPins.length} {carryForwardPins.length === 1 ? "pin" : "pins"}
            </span>
          </div>
          {#if carryForwardOpen}
            <ul class="cf-list">
              {#each carryForwardPins as p (p.id)}
                <li class="cf-item">
                  <span class="cf-glyph">↻</span>
                  <span class="cf-title">{p.title || (isBoard(p) ? "untitled" : getPlainText(p).slice(0, 60))}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    {/snippet}

    {#if loading}
      <div class="empty-loading"><p class="empty-text label">loading…</p></div>
    {:else if visiblePins.length === 0}
      <Empty hasActiveFilters={hasActivePinFilters()}>
        {#snippet title()}nothing matches{/snippet}
        {#snippet body()}
          <!-- Deliberately no "hover" here. This copy shipped as "hover a
               line and tap ↗", which on a phone describes a gesture the
               device does not have — the panel is full-screen on touch, so
               it was read there more than anywhere. Naming the verb (pin)
               rather than the input device reads correctly on both. -->
          {allPins.length === 0
            ? (lineageId ? "what continues lives here. pin a line to keep it." : "what matters lives here. pin a line to keep it.")
            : "loosen a filter or clear them all."}
        {/snippet}
        {#snippet actions()}
          <Chip onClick={clearFilters}>clear all</Chip>
        {/snippet}
      </Empty>
    {:else}
      {#each sections as section (section.label)}
        <SectionHeader label={section.label} count={section.pins.length} />
        {@const limit = sectionLimit[section.label] ?? SECTION_PAGE_SIZE}
        <div class="pin-rows">
          {#each section.pins.slice(0, limit) as obj (obj.id)}
            {@const eff = effectivePin(obj)}
            {@const actions = scopeActionsFor(obj)}
            {@const samePage = obj.source_page_id === pageId}
            <PinRow
              pin={obj}
              eff={eff}
              isBoard={isBoard(obj)}
              lineagePath={lineagePathFor(obj.lineage_id)}
              localBlobs={localBlobs}
              samePage={samePage}
              sortMode={"position"}
              draggingId={draggingId}
              dragOverId={dragOverId}
              scopeActions={actions}
              scopeMenuOpen={scopeMenuFor === obj.id}
              onClick={() => handleRowClick(obj, eff)}
              onRename={async (title) => {
                inlineRenameText = title || "";
                await commitInlineRename(obj);
              }}
              onCarryForward={() => toggleAutoInsert(obj)}
              onInject={() => injectPinNow(eff)}
              onDelete={() => removePin(obj)}
              onScopeChange={() => {}}
              onScopeMenuToggle={() => { scopeMenuFor = scopeMenuFor === obj.id ? null : obj.id; }}
              onScopeAction={(act) => applyScopeAction(obj, act)}
              onDragStart={(e) => onRowDragStart(e, obj)}
              onDragOver={(e) => onRowDragOver(e, obj)}
              onDragLeave={onRowDragLeave}
              onDrop={(e) => onRowDrop(e, obj, section.pins)}
            />
          {/each}
          {#if section.pins.length > limit}
            <div class="show-more">
              <Button variant="subtle" onClick={() => loadMore(section.label)}>
                show {section.pins.length - limit} more
              </Button>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </SidebarShell>
</div>

<!-- Phone: filters live in a bottom sheet, not a drawer. Same filterRows
     content, opened from the toolbar's "filter" button. -->
{#if isPhone}
  <BottomSheet open={filterSheetOpen} onClose={() => (filterSheetOpen = false)} title="filter">
    {@render filterRows()}
  </BottomSheet>
{/if}

<!-- Single modal slot. `modal` is either null, an artifact-typed handle,
     or a note-typed handle. Setting `modal` to a new value always replaces
     any previous open modal, so there is no path that yields stacked
     overlays (the bug class the v0.4 UI audit flagged). -->
{#if modal?.type === "artifact"}
  {@const pin = pinById(modal.pinId)}
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
  /* Overlay */
  .overlay { position: fixed; inset: 0; z-index: 149; }

  /* Panel — right-anchored side panel; modal-scale shadow. The chrome
     inside (sidebar / toolbar / body / footer) is the SidebarShell from
     the v0.4 design system; the .panel wrapper just handles fixed
     positioning and the close affordance. */
  .panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: 36rem; max-width: 92vw;
    background: var(--canvas-bg);
    border-left: 1px solid var(--card-border);
    box-shadow: -0.375rem 0 1.5rem var(--card-shadow);
    z-index: 150; display: flex; flex-direction: column;
  }
  /* On tablet/phone the side panel becomes a full-screen sheet — the
     92vw cap left only ~50px of canvas peeking through on a 360px
     viewport, which felt worse than a clean full-width takeover. The
     existing close gesture (× button) stays as the dismiss path. */
  @media (max-width: 768px), (orientation: landscape) and (max-height: 480px) {
    .panel {
      width: 100%;
      max-width: 100%;
      border-left: none;
      box-shadow: none;
    }
  }

  .panel-close {
    position: absolute;
    top: 0.5rem; right: 0.625rem;
    z-index: 2;
    background: none; border: none; cursor: pointer;
    font-size: 1.125rem; color: var(--ink); opacity: 0.35;
    padding: 0.25rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .panel-close:hover { opacity: 0.75; }

  /* Phone: swap the top-right × for a top-left ‹ back arrow.
     Matches the universal-back-arrow pattern from Settings. */
  .panel-back {
    display: none;
    position: absolute;
    top: max(0.5rem, var(--safe-top));
    left: max(0.5rem, var(--safe-left));
    z-index: 2;
    width: 2.5rem; height: 2.5rem;
    background: none; border: none; cursor: pointer;
    font-family: "Lora", Georgia, serif;
    font-size: 1.5rem; line-height: 1;
    color: var(--ink); opacity: 0.75;
    border-radius: 0.375rem;
    align-items: center; justify-content: center;
    transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1), opacity 120ms cubic-bezier(0.2, 0, 0, 1);
  }
  .panel-back:hover { opacity: 1; background: color-mix(in srgb, var(--ink) 5%, transparent); }

  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .panel-close { display: none; }
    /* Phone: floating back-arrow sits absolute at top-left so the
       toolbar's title + search rows can share the SAME left edge
       (otherwise an in-toolbar back-arrow shoves the title 3rem to
       the right of the search row, misaligning the header). */
    .panel-back {
      display: inline-flex;
      top: calc(var(--safe-top) + 0.25rem);
    }
    /* Push the toolbar contents right to clear the floating back. */
    .phone-toolbar { padding-left: 2.5rem; }
  }

  /* Phone toolbar — two stacked rows inside the shell-toolbar slot:
     row 1 = back arrow + title, row 2 = search + filter. The wrapper
     spans the whole toolbar so the SidebarShell flex row holds it. */
  .phone-toolbar {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .phone-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.5rem;
  }
  .phone-title {
    margin: 0;
    font-family: "Lora", serif;
    font-size: 1.25rem;
    font-weight: 500;
    line-height: 1.3;
    color: var(--ink);
    opacity: 0.92;
  }
  .phone-search-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .phone-search-row .toolbar-search {
    flex: 1;
    min-width: 0;
  }

  /* Toolbar slot composition */
  .toolbar-search {
    flex: 1;
    min-width: 0;
  }

  /* Body: pin rows stack with no padding (SidebarShell .shell-body handles
     gutters). The pin-rows wrapper preserves the row-stack styling the
     PinRow component expects. */
  .pin-rows {
    display: flex;
    flex-direction: column;
  }

  /* Pagination affordance — sits below the last visible row in a section
     when the section has more than the render cap. */
  .show-more {
    display: flex;
    justify-content: center;
    padding: 0.25rem 0 0.5rem;
  }

  .empty-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
  }
  .empty-text {
    font-family: "Lora", serif; font-style: italic; font-size: 0.875rem;
    color: var(--ink); opacity: 0.35;
  }

  /* Density popover layout — two stacked rows of chips. */
  :global(.popover) .popover-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.25rem;
  }
  :global(.popover) .popover-row + .popover-row {
    border-top: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    margin-top: 0.25rem;
  }

  /* Carry-forward footer — disclosure of pins that auto-insert on tomorrow's
     first page of the current trail. Calm by default; reveals a list when
     the user expands the summary. */
  .cf-footer {
    /* SidebarShell .shell-footer already provides padding + top border. */
  }
  .cf-summary {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    cursor: pointer;
    user-select: none;
  }
  .cf-caret {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    color: var(--ink);
    opacity: 0.35;
    line-height: 1;
  }
  .cf-text {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    color: var(--ink);
    opacity: 0.35;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .cf-summary:hover .cf-text {
    opacity: 0.55;
  }
  .cf-list {
    list-style: none;
    margin: 0.375rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .cf-item {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
    padding: 0.125rem 0 0.125rem 1rem;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.75;
  }
  .cf-glyph {
    color: var(--warm-accent);
    opacity: 0.55;
    font-size: 0.625rem;
    flex-shrink: 0;
  }
  .cf-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Pin modal styles live in PinArtifactModal.svelte and PinNoteModal.svelte
     (extracted in Task 2.2). */
</style>
