<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { fade } from "svelte/transition";
  import ThreadCard from "./ThreadCard.svelte";
  import ThreadPageView from "./ThreadPageView.svelte";
  import TrailMap from "./TrailMap.svelte";
  import { getTrailPageCounts, getThread, searchPages, getGroundData, getLineages, getSetting, setSetting, getPins, updatePinContent, deletePin, getPageForMention } from "../lib/api.js";
  import { buildTreeList } from "../lib/trail-utils.js";
  import {
    emptyFilters,
    pageMatches,
    activeFilterCount,
    groupByDate,
    applyScopeFilter,
    descendantLineageIds,
    relativeLineagePath,
  } from "../lib/memory-filters.js";

  import SidebarShell from "../lib/ui/SidebarShell.svelte";
  import SidebarNavRow from "../lib/ui/SidebarNavRow.svelte";
  import Input from "../lib/ui/Input.svelte";
  import TriggerChip from "../lib/ui/TriggerChip.svelte";
  import SegmentedControl from "../lib/ui/SegmentedControl.svelte";
  import Popover from "../lib/ui/Popover.svelte";
  import SectionHeader from "../lib/ui/SectionHeader.svelte";
  import Empty from "../lib/ui/Empty.svelte";
  import Button from "../lib/ui/Button.svelte";
  import { isPhoneViewport, watchPhoneViewport } from "../lib/responsive.js";
  import MemoryFiltersPanel from "./memory/MemoryFiltersPanel.svelte";
  import PinRow from "./pins/PinRow.svelte";
  import PinArtifactModal from "./pins/PinArtifactModal.svelte";
  import PinNoteModal from "./pins/PinNoteModal.svelte";
  import { applyDateFilter } from "../lib/memory-filters.js";
  import { getLocalDateStr } from "../lib/utils.js";

  /** @type {{ onNavigatePage: () => void, onContinueFocus: (focus: any) => void }} */
  let { onNavigatePage, onContinueFocus = () => {} } = $props();

  // sentinel value used in the sidebar to mean "filter to untrailed pages"
  const UNTRAILED = "__untrailed__";

  // data
  let pages = $state([]);
  let lineages = $state([]);
  let groundData = $state(null);
  let loading = $state(true);

  // search
  let searchQuery = $state("");
  let searchResults = $state(null);
  let matchingIds = $state(null);
  let searchDebounce = $state(null);
  let searchEl = $state(null);

  // filters + sort
  let filters = $state(emptyFilters());
  let sort = $state(/** @type {"date" | "updated_at"} */ ("date"));

  // persisted prefs
  let view = $state(/** @type {"timeline" | "trailmap"} */ ("timeline"));
  let trailmapRangeDays = $state(30);
  let prefsLoaded = $state(false);

  // v0.5 mode switch — pages | trail map | pins. Replaces the binary
  // timeline/trailmap toggle (kept on `view` for now; `mode` is the
  // authoritative branch for the content area).
  let mode = $state(/** @type {"pages" | "trailmap" | "pins"} */ ("trailmap"));

  // shell + popovers — the consolidated filters chip is the only trigger
  // surfaced on this view; trails / date / view all live inside the panel.
  let drawerOpen = $state(false);
  let filtersPopoverOpen = $state(false);
  let filtersChipEl = $state(null);

  // Seed synchronously so the first render is already the right form factor.
  // Starting at false made the first paint the desktop layout (permanent
  // sidebar) until the effect ran, which could stick when entering Memory.
  let isPhone = $state(isPhoneViewport());
  $effect(() => {
    const unwatch = watchPhoneViewport((m) => { isPhone = m; });
    return unwatch;
  });

  // v0.5 date filter (replaces the old filters.date chip group).
  let dateFilter = $state(/** @type {{ kind: string, date?: string, from?: string, to?: string } | null} */ ({ kind: "thisMonth" }));
  let todayStr = $state(getLocalDateStr());

  // "on page" filter — Phase-A consolidated filters panel slot. Wiring to a
  // real on-page predicate lands in a later phase; for now this is an
  // inert toggle that only surfaces when no trail is scoped, so the panel
  // section renders cleanly without affecting query results.
  let onPageOnly = $state(false);
  let onPageCount = $state(undefined);

  // keyboard nav
  let focusedIdx = $state(-1);

  // page-view overlay
  let viewingPage = $state(null);

  // pins (Phase C.2) — loaded as the union of trail-visible + global pins,
  // mirroring SharedObjectsPanel's load shape. We re-fetch when the
  // sidebar's active lineage changes so the inheritance CTE re-runs.
  let pinsTrail = $state(/** @type {any[]} */ ([]));
  let pinsGlobal = $state(/** @type {any[]} */ ([]));
  let pins = $derived([...pinsTrail, ...pinsGlobal]);

  // single modal slot — matches the shape SharedObjectsPanel uses, so the
  // two surfaces can't race each other into stacked overlays.
  let pinModalState = $state(/** @type {{ type: "artifact"|"note", pinId: string } | null} */ (null));

  onMount(() => {
    Promise.all([reloadThread(), loadLineages(), loadTrailPageCounts(), loadGroundData(), loadPrefs()]);
  });
  onDestroy(() => { if (searchDebounce) clearTimeout(searchDebounce); });

  async function loadPrefs() {
    try {
      const [v, r] = await Promise.all([
        getSetting("memory_view"),
        getSetting("trailmap_range_days"),
      ]);
      if (v === "timeline" || v === "trailmap") view = v;
      const parsed = r ? parseInt(r, 10) : NaN;
      if (Number.isFinite(parsed) && (parsed > 0 || parsed === -1)) trailmapRangeDays = parsed;
    } catch {}
    prefsLoaded = true;
  }

  function persistView(v) { view = v; setSetting("memory_view", v).catch(() => {}); }
  function persistTrailmapRange(days) {
    trailmapRangeDays = days;
    setSetting("trailmap_range_days", String(days)).catch(() => {});
  }

  async function reloadThread() {
    loading = true;
    try { pages = await getThread(100, 0, sort); } catch {} finally { loading = false; }
  }
  async function loadLineages() { try { lineages = await getLineages(); } catch {} }
  async function loadGroundData() { try { groundData = await getGroundData(); } catch {} }

  $effect(() => {
    // re-fetch when sort flips
    const _ = sort;
    reloadThread();
  });

  // Reload pins when the sidebar's active lineage changes. The trail query's
  // CTE already includes ancestors (current + parents); global is fetched
  // separately. Both sets are disjoint (global has lineage_id NULL, which
  // never matches `IN (chain)`), so the union is safe.
  //
  // For the all-trails / untrailed scopes, we fan out across every lineage so
  // the pins list isn't artificially narrowed to globals. We dedupe by pin id
  // because the per-lineage CTE walks ancestors and the same pin can surface
  // from multiple trails.
  async function loadPins(lineageId, allLineages) {
    try {
      if (lineageId && lineageId !== UNTRAILED) {
        // Selected-trail mode: fan out across {self + descendants} so a
        // parent trail (e.g. "shizumu") surfaces every pin from its
        // subtree. getPins(id) walks ancestors UPWARD only — without
        // this fan-out, picking a parent shows only the parent's own
        // pins, and chip counts on descendant trails go missing in the
        // trail-map view.
        const scope = descendantLineageIds(lineageId, allLineages || []);
        const targets = scope instanceof Set ? [...scope] : [lineageId];
        const [globalRows, ...lineageRowsList] = await Promise.all([
          getPins(null),
          ...targets.map((id) => getPins(id)),
        ]);
        const seen = new Set();
        const merged = [];
        for (const row of lineageRowsList.flat()) {
          if (!row || seen.has(row.id)) continue;
          seen.add(row.id);
          merged.push(row);
        }
        pinsTrail = merged;
        pinsGlobal = globalRows || [];
        return;
      }
      // all-trails / untrailed: fetch globals + every lineage's pins, dedup.
      const lineageIds = (allLineages || []).map((l) => l.id);
      const [globalRows, ...lineageRowsList] = await Promise.all([
        getPins(null),
        ...lineageIds.map((id) => getPins(id)),
      ]);
      const seen = new Set();
      const merged = [];
      for (const row of lineageRowsList.flat()) {
        if (!row || seen.has(row.id)) continue;
        seen.add(row.id);
        merged.push(row);
      }
      pinsTrail = merged;
      pinsGlobal = globalRows || [];
    } catch {
      pinsTrail = [];
      pinsGlobal = [];
    }
  }
  $effect(() => {
    // Resolve the trail filter the same way SidebarShell uses it: a single
    // selected trail → scope to that trail (+ ancestors), otherwise we fan
    // out across every lineage so all-trails really means all.
    const sole = effectiveLineageId && effectiveLineageId !== UNTRAILED
      ? effectiveLineageId
      : null;
    // Read lineages here so Svelte's reactivity tracker registers it as
    // a dependency. Without this, the effect runs once on mount with
    // lineages === [] (still loading from getLineages()) and never
    // re-fires when lineages later populates, leaving "all trails"
    // showing only the 1 global pin.
    const tracked = lineages;
    loadPins(sole, tracked);
  });

  // search
  function handleSearchInput(v) {
    searchQuery = v;
    if (searchDebounce) clearTimeout(searchDebounce);
    if (!v.trim()) { searchResults = null; matchingIds = null; return; }
    searchDebounce = setTimeout(async () => {
      try {
        const r = await searchPages(v.trim());
        searchResults = r;
        matchingIds = new Set(r.map(x => x.id));
      } catch {}
    }, 200);
  }
  function clearSearch() {
    searchQuery = "";
    searchResults = null;
    matchingIds = null;
  }
  // Search filters the list (no dim treatment), so a dimmed helper is no
  // longer needed; kept here as a no-op for any future callsite parity.
  function _matchedBySearch(id) { return matchingIds ? matchingIds.has(id) : true; }
  void _matchedBySearch;

  // lineage lookups
  let lineageMap = $derived(new Map(lineages.map(l => [l.id, l])));
  function getLineageName(id) { const l = id ? lineageMap.get(id) : null; return l ? l.name : null; }
  function getLineageMode(id) { const l = id ? lineageMap.get(id) : null; return l ? l.mode : null; }
  function getLineagePath(id) {
    if (!id) return [];
    const out = [];
    let cur = lineageMap.get(id);
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.unshift({ id: cur.id, name: cur.name });
      cur = cur.parent_id ? lineageMap.get(cur.parent_id) : null;
    }
    return out;
  }

  // Per-trail page counts, counted in SQL over every page.
  //
  // These used to be tallied from `pages` — but that list is capped
  // (getThread(100, ..)), so a trail whose pages fell outside the hundred
  // most recent showed a number smaller than the truth. The sidebar figure
  // quietly meant "pages on this trail, among the last hundred", which is
  // not a number anyone can use.
  let trailPageCounts = $state(new Map());
  async function loadTrailPageCounts() {
    try {
      trailPageCounts = new Map(await getTrailPageCounts());
    } catch {
      // Leave the previous counts rather than flashing every trail to 0.
    }
  }

  // tree-ordered lineage list with depth, used for the sidebar
  let lineageTree = $derived(buildTreeList(lineages).map(l => ({
    id: l.id,
    name: l.name,
    mode: l.mode,
    parent_id: l.parent_id,
    depth: l._depth ?? 0,
    pageCount: trailPageCounts.get(l.id) ?? 0,
    hasChildren: lineages.some((x) => x.parent_id === l.id),
  })));

  // Sidebar expand/collapse — session-scoped. Defaults to all expanded so
  // first-time users see the whole tree; collapsing folds children away
  // and shows a chevron on the parent for re-expand. Persistence across
  // app restart is not yet wired (intentional minimal scope).
  let collapsedTrails = $state(new Set());
  function toggleTrailCollapse(id) {
    const next = new Set(collapsedTrails);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedTrails = next;
  }
  // A trail is visible when none of its ancestors are collapsed.
  function trailVisible(trail) {
    let cur = trail.parent_id ? lineages.find((l) => l.id === trail.parent_id) : null;
    while (cur) {
      if (collapsedTrails.has(cur.id)) return false;
      cur = cur.parent_id ? lineages.find((l) => l.id === cur.parent_id) : null;
    }
    return true;
  }
  let visibleLineageTree = $derived(lineageTree.filter(trailVisible));

  // sidebar selection state: single value or sentinel
  // - null: "all trails" (no trail filter)
  // - "__untrailed__": only untrailed pages
  // - lineage id: filter to that one trail
  // `effectiveLineageId` reconciles the multi-select Set shape of filters.trails
  // with the single-select scope expected by applyScopeFilter, getPins, and
  // ThreadCard.showTrailName. It is the one place we resolve the sidebar's
  // active trail into a scalar scope.
  let effectiveLineageId = $derived(
    filters.untrailedOnly
      ? UNTRAILED
      : (filters.trails.size === 1 ? [...filters.trails][0] : null)
  );
  let activeLineageId = $derived(effectiveLineageId);
  // Alias for the consolidated filters panel: it expects a `lineageId`
  // sentinel (null = no trail scope) to decide whether the "on page" chip
  // should be offered.
  let lineageId = $derived(activeLineageId);

  // Scope expanded to include descendant trails — selecting a parent in
  // the sidebar surfaces every page/pin from nested subtrails too. Falls
  // through unchanged for null ("all trails") and "__untrailed__".
  let effectiveScope = $derived(
    descendantLineageIds(effectiveLineageId, lineages)
  );

  function setLineage(id) {
    if (id == null) {
      filters = { ...filters, trails: new Set(), untrailedOnly: false };
    } else if (id === UNTRAILED) {
      filters = { ...filters, trails: new Set(), untrailedOnly: true };
    } else {
      filters = { ...filters, trails: new Set([id]), untrailedOnly: false };
    }
    drawerOpen = false;
  }

  // popover filter ops
  function togglePinned() { filters = { ...filters, pinned: !filters.pinned }; }

  function clearAllFilters() {
    filters = emptyFilters();
    dateFilter = null;
    searchQuery = "";
    searchResults = null;
    matchingIds = null;
  }

  function hasActiveFilters() {
    const dateActive = dateFilter && dateFilter.kind !== "all";
    return searchQuery.trim() !== "" || activeFilterCount(filters) > 0 || !!dateActive;
  }

  // filtered + grouped view.
  //
  // Scope first (applyScopeFilter), then the remaining pageMatches predicates
  // (mode, pinned, backlinks, legacy date), then the date popover. Trail
  // filtering is owned by applyScopeFilter — we clear filters.trails and
  // filters.untrailedOnly before delegating to pageMatches so that helper's
  // trail branch becomes a no-op and there is exactly one path that decides
  // what trail a row belongs to. Search is handled separately: matchingIds
  // (from the FTS5 backend) is intersected with the scoped list so the search
  // result count narrows when the user picks a trail in the sidebar.
  let nonScopeFilters = $derived({
    ...filters,
    trails: new Set(),
    untrailedOnly: false,
  });
  let filteredPages = $derived.by(() => {
    let r = applyScopeFilter(pages, effectiveScope);
    r = r.filter((p) => pageMatches(p, nonScopeFilters, getLineageMode));
    r = applyDateFilter(r, dateFilter, todayStr);
    // Search filters the list, no dim treatment. When the FTS query is
    // active, only matching pages are kept; non-matches disappear from
    // the timeline / trail map entirely.
    if (matchingIds && searchQuery.trim()) {
      r = r.filter((p) => matchingIds.has(p.id));
    }
    return r;
  });
  // Alias used by the mode-switched render branches (Phase C and beyond).
  let visiblePages = $derived(filteredPages);
  let activeFilters = $derived(activeFilterCount(filters));
  let visibleCount = $derived(filteredPages.length);
  // Search filters the list now, so the "matching" count equals the visible
  // count whenever a query is active.
  let scopedMatchCount = $derived(
    matchingIds && searchQuery.trim() ? filteredPages.length : 0
  );

  // ── pins-mode helpers ──────────────────────────────────────────────────
  // Treat artifact/board/table as boards; everything else is a note.
  // Mirrors SharedObjectsPanel's classifier so the modal fork agrees.
  const isPinBoard = (p) => ["artifact", "board", "table"].includes(p?.object_type);

  function pinPlainText(pin) {
    // Notes carry plain string content; boards carry a TipTap doc JSON
    // blob, so for search we fall back to the raw content string and let
    // substring matching see whatever text is in there.
    if (!pin) return "";
    if (!isPinBoard(pin)) return typeof pin.content === "string" ? pin.content : "";
    try {
      const parsed = JSON.parse(pin.content || "null");
      if (parsed && parsed.type === "doc" && Array.isArray(parsed.content)) {
        function walk(node) {
          if (node?.text) return node.text;
          if (Array.isArray(node?.content)) return node.content.map(walk).join(" ");
          return "";
        }
        return parsed.content.map(walk).join(" ");
      }
    } catch {}
    return typeof pin.content === "string" ? pin.content : "";
  }

  function pinMatches(pin, q) {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const hay = (pinPlainText(pin) + " " + (pin?.title || "")).toLowerCase();
    return hay.includes(needle);
  }

  // Pins surface obeys the same sidebar trail filter + search box + date
  // filter as the page list. Date filter operates on `source_page_date`
  // (when the pin was born) so the chip stays semantically "when". Trail
  // scope is applied via applyScopeFilter for parity with pages — pins are
  // already loaded via getPins(lineageId), but post-load filtering keeps the
  // path consistent when the sidebar selection flips.
  let visiblePins = $derived.by(() => {
    let r = applyScopeFilter(pins, effectiveScope);
    // Stamp a `date` for applyDateFilter to key on, then strip after.
    const stamped = r.map((pin) => ({
      ...pin,
      date: pin.source_page_date || (pin.created_at ? pin.created_at.slice(0, 10) : ""),
    }));
    let filtered = applyDateFilter(stamped, dateFilter, todayStr);
    if (searchQuery.trim()) filtered = filtered.filter((pin) => pinMatches(pin, searchQuery));
    return filtered;
  });

  // Subtrails of the currently-selected lineage, packed for TrailMap's
  // single-trail variant. Each entry is { lineage, pages, pins }: the child
  // lineage row plus its own pages and pins (matched by lineage_id, the
  // pin's current scope rather than its birth trail, so reassigned pins
  // follow the trail they were moved to). Returns [] when the sidebar is
  // "all trails" / "untrailed" — branching is single-trail-only; the global
  // variant flattens nested trails into path-named rows (Phase E).
  let subtrailsForSelected = $derived.by(() => {
    if (effectiveLineageId == null || effectiveLineageId === UNTRAILED) return [];
    const children = lineages.filter((l) => l.parent_id === effectiveLineageId);
    return children
      .map((l) => ({
        lineage: l,
        pages: pages.filter((p) => p.lineage_id === l.id),
        pins: pins.filter((pin) => pin.lineage_id === l.id),
      }))
      .filter((s) => s.pages.length > 0);
  });

  function pinById(id) {
    return pins.find((p) => p.id === id) || null;
  }

  function openPin(pin) {
    pinModalState = {
      type: isPinBoard(pin) ? "artifact" : "note",
      pinId: pin.id,
    };
  }

  // Local patch to mirror SharedObjectsPanel's optimistic flow without
  // tying us to its lineage_id-sorted buckets. We just rewrite the pin
  // in-place in whichever array it lives.
  function patchPin(id, mut) {
    pinsTrail = pinsTrail.map((p) => (p.id === id ? { ...p, ...mut } : p));
    pinsGlobal = pinsGlobal.map((p) => (p.id === id ? { ...p, ...mut } : p));
  }
  function dropPin(id) {
    pinsTrail = pinsTrail.filter((p) => p.id !== id);
    pinsGlobal = pinsGlobal.filter((p) => p.id !== id);
  }

  // Memory is a read/jump surface, not an editor host. We can still let the
  // modal save: same-page splicing isn't available (no live editor here),
  // so we always take the cross-page write path. The Rust refresh_pin_caches
  // hook updates row caches on save; we also patch locally so the panel
  // doesn't lag the modal close.
  async function savePinArtifact(pinId, newNode, newTitle, contentChanged, titleChanged) {
    const pin = pinById(pinId);
    if (!pin || !newNode) return;
    if (!contentChanged && !titleChanged) return;
    const newDoc = { type: "doc", content: [newNode] };
    const nextContent = contentChanged ? JSON.stringify(newDoc) : pin.content;
    try {
      await updatePinContent(pin.id, nextContent, titleChanged ? newTitle : pin.title);
    } catch (err) {
      console.error("Failed to save pin (artifact) from memory:", err);
    }
    patchPin(pin.id, {
      content: nextContent,
      title: titleChanged ? newTitle : pin.title,
    });
  }
  async function savePinNote(pinId, newContent, newTitle, contentChanged, titleChanged) {
    const pin = pinById(pinId);
    if (!pin) return;
    if (!contentChanged && !titleChanged) return;
    const nextContent = contentChanged ? newContent : pin.content;
    const nextTitle = titleChanged ? newTitle : pin.title;
    try {
      await updatePinContent(pin.id, nextContent, nextTitle);
    } catch (err) {
      console.error("Failed to save pin (note) from memory:", err);
    }
    patchPin(pin.id, { content: nextContent, title: nextTitle });
  }
  async function deletePinAndClose(pinId) {
    try { await deletePin(pinId); } catch (err) { console.error("Failed to delete pin:", err); }
    dropPin(pinId);
    pinModalState = null;
  }

  // Jump from a pin to the page it was pinned from. The source page may not be
  // in the loaded thread (different trail, outside the active date/scope
  // filters), so we resolve from the loaded lists first and fall back to a
  // direct lookup. ThreadPageView opens it read-only — same surface as a
  // normal thread tap.
  async function goToPinSource(pageId) {
    if (!pageId) return;
    pinModalState = null;
    let p = flatList.find((x) => x.id === pageId) || pages.find((x) => x.id === pageId);
    if (!p) {
      try { p = await getPageForMention(pageId); } catch (err) { console.error("Failed to resolve pin source page:", err); }
    }
    if (p) viewingPage = { date: p.date, pageNumber: p.page_number, pageId };
  }

  // Per-day activity counts for the calendar grid.
  let activityByDate = $derived.by(() => {
    const map = {};
    for (const p of pages) {
      if (!map[p.date]) map[p.date] = { pages: 0, pins: 0 };
      map[p.date].pages++;
      if ((p.pin_count ?? 0) > 0) map[p.date].pins++;
    }
    return map;
  });

  let groups = $derived.by(() => {
    if (sort === "updated_at") {
      return filteredPages.length > 0
        ? [{ label: "recently edited", pages: filteredPages }]
        : [];
    }
    return groupByDate(filteredPages);
  });

  // flat list for keyboard nav
  let flatList = $derived(groups.flatMap(g => g.pages));

  async function moveFocus(delta) {
    if (flatList.length === 0) return;
    const next = Math.max(0, Math.min(flatList.length - 1, focusedIdx + delta));
    focusedIdx = next;
    await tick();
    const id = flatList[next]?.id;
    if (id) document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      if (pinModalState) { pinModalState = null; return; }
      if (viewingPage) { viewingPage = null; return; }
      if (filtersPopoverOpen) { filtersPopoverOpen = false; return; }
      if (drawerOpen) { drawerOpen = false; return; }
      onNavigatePage();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "ArrowDown") { e.preventDefault(); onNavigatePage(); return; }

    // Only intercept j/k/arrows when the search field isn't focused.
    if (searchEl?.contains(document.activeElement)) return;
    // 1/2/3 switch modes — guarded the same way (no input focus).
    const tag = document.activeElement?.tagName;
    const inputFocused =
      tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
    if (!inputFocused) {
      if (e.key === "1") { e.preventDefault(); mode = "pages"; return; }
      if (e.key === "2") { e.preventDefault(); mode = "trailmap"; return; }
      if (e.key === "3") { e.preventDefault(); mode = "pins"; return; }
    }
    if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
    else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
    else if (e.key === "Enter" && focusedIdx >= 0) {
      const p = flatList[focusedIdx];
      if (p) viewingPage = { date: p.date, pageNumber: p.page_number, pageId: p.id };
    }
  }

  // ── filter summary (used by empty-state bodies) ───────────────────────────
  function fmtFilterSummary(f) {
    const parts = [];
    if (f.pinned) parts.push("pinned");
    return parts.length ? parts.join(", ") : "filters";
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Trails sidebar. Defined as a top-level snippet and passed to SidebarShell
     as an EXPLICIT prop — a `{#snippet}` wrapped in `{#if}` becomes a *local*
     snippet in Svelte 5 and is NOT passed to the component (which silently
     dropped the whole sidebar). Conditional prop = no sidebar on phone. -->
{#snippet trailsSidebar()}
  <SectionHeader label="trails" count={lineageTree.length} />
        <SidebarNavRow active={activeLineageId === null} accent={activeLineageId === null} onClick={() => setLineage(null)}>all trails</SidebarNavRow>
        {#each visibleLineageTree as trail (trail.id)}
          <SidebarNavRow
            active={activeLineageId === trail.id}
            accent={activeLineageId === trail.id}
            count={trail.pageCount}
            indent={trail.depth * 1.125}
            tag={trail.mode === "continuous" ? "continuous" : "discrete"}
            onClick={() => setLineage(trail.id)}
          >
            {#if trail.hasChildren}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="trail-chevron" onclick={(e) => { e.stopPropagation(); toggleTrailCollapse(trail.id); }}>{collapsedTrails.has(trail.id) ? "▸" : "▾"}</span>
            {:else if trail.depth > 0}
              <span class="trail-chevron-spacer" aria-hidden="true"></span>
            {/if}
            {trail.name}
          </SidebarNavRow>
        {/each}
        <SectionHeader label="untrailed" />
        <SidebarNavRow active={activeLineageId === UNTRAILED} accent={activeLineageId === UNTRAILED} onClick={() => setLineage(UNTRAILED)}>untrailed</SidebarNavRow>
{/snippet}

<div class="memory">
  <SidebarShell sidebarMode={isPhone ? "drawer" : "permanent"} sidebar={isPhone ? undefined : trailsSidebar} bind:drawerOpen>

    {#snippet toolbar()}
      <div bind:this={searchEl} class="search-slot">
        <Input
          value={searchQuery}
          variant="search"
          placeholder="search your writing…"
          ariaLabel="search"
          onInput={handleSearchInput}
          onClear={clearSearch}
        />
      </div>
      <div class="seg">
        <SegmentedControl
          ariaLabel="memory mode"
          options={[
            { value: "pages", label: "pages" },
            { value: "trailmap", label: "trail map" },
            { value: "pins", label: "pins" },
          ]}
          value={mode}
          onChange={(v) => (mode = v)}
        />
      </div>
      <span bind:this={filtersChipEl}>
        <TriggerChip
          label="filters"
          count={activeFilters > 0 ? activeFilters : undefined}
          active={filtersPopoverOpen}
          onClick={() => (filtersPopoverOpen = !filtersPopoverOpen)}
          ariaLabel="open filters"
        >
          {#snippet trailing()}
            <span class="caret" aria-hidden="true">▾</span>
          {/snippet}
        </TriggerChip>
      </span>
      <span class="count-label">
        {#if !loading}
          {visibleCount} {visibleCount === 1 ? "page" : "pages"}
          {#if searchResults}· {scopedMatchCount} matching{/if}
        {/if}
      </span>
    {/snippet}

    {#if loading}
      <p class="loading-line">loading…</p>
    {:else if mode === "pages"}
      {#if visibleCount === 0}
        {#if hasActiveFilters()}
          <Empty hasActiveFilters>
            {#snippet title()}nothing matches{/snippet}
            {#snippet body()}{fmtFilterSummary(filters)}{/snippet}
            {#snippet actions()}
              <Button variant="subtle" onClick={clearAllFilters}>clear all</Button>
            {/snippet}
          </Empty>
        {:else}
          <Empty>
            {#snippet title()}no writing yet{/snippet}
            {#snippet body()}your pages appear here.{/snippet}
          </Empty>
        {/if}
      {:else}
        {#each groups as g (g.label)}
          <SectionHeader label={g.label} count={g.pages.length} />
          <div class="cards">
            {#each g.pages as p (p.id)}
              {@const idx = flatList.indexOf(p)}
              <div id={`card-${p.id}`}>
                <ThreadCard
                  summary={p}
                  focused={idx === focusedIdx}
                  lineageName={getLineageName(p.lineage_id)}
                  lineageMode={getLineageMode(p.lineage_id)}
                  lineagePath={relativeLineagePath(getLineagePath(p.lineage_id), effectiveLineageId === UNTRAILED ? null : effectiveLineageId, lineages)}
                  showTrailName={true}
                  searchQuery={searchQuery}
                  onclick={() => { focusedIdx = idx; viewingPage = { date: p.date, pageNumber: p.page_number, pageId: p.id }; }}
                />
              </div>
            {/each}
          </div>
        {/each}

        {#if groundData && groundData.first_write_date && activeFilters === 0 && !searchResults}
          <p class="ground-stat">
            {groundData.total_pages} {groundData.total_pages === 1 ? "page" : "pages"} since {groundData.first_write_date}
          </p>
        {/if}
      {/if}
    {:else if mode === "trailmap"}
      <!-- Phase E: lifeline (single + global variants). Chip / popover
           clicks bubble up via onSwitchMode + onSwitchSidebar so TrailMap
           never touches Memory state directly. -->
      <TrailMap
        pages={visiblePages}
        pins={visiblePins}
        {lineages}
        subtrails={subtrailsForSelected}
        lineageId={effectiveLineageId === UNTRAILED ? null : effectiveLineageId}
        dateFilter={dateFilter}
        todayStr={todayStr}
        onSelectPage={(p) => (viewingPage = { date: p.date, pageNumber: p.page_number, pageId: p.id })}
        onOpenSpecificPin={(pin) => openPin(pin)}
        onSwitchMode={(m, opts) => {
          mode = /** @type {any} */ (m);
          if (opts?.dateFilter) dateFilter = opts.dateFilter;
          if (opts?.lineageId !== undefined) setLineage(opts.lineageId);
        }}
        onSwitchSidebar={(lid) => setLineage(lid)}
      />
    {:else if mode === "pins"}
      {#if visiblePins.length === 0}
        {#if hasActiveFilters()}
          <Empty hasActiveFilters>
            {#snippet title()}nothing matches{/snippet}
            {#snippet body()}{fmtFilterSummary(filters)}{/snippet}
            {#snippet actions()}
              <Button variant="subtle" onClick={clearAllFilters}>clear all</Button>
            {/snippet}
          </Empty>
        {:else}
          <Empty>
            {#snippet title()}no pins yet{/snippet}
            {#snippet body()}what matters lives here. pin a line from the page to see it.{/snippet}
          </Empty>
        {/if}
      {:else}
        <div class="pin-rows">
          {#each visiblePins as pin (pin.id)}
            <PinRow
              pin={pin}
              eff={pin}
              isBoard={isPinBoard(pin)}
              lineagePath={relativeLineagePath(getLineagePath(pin.lineage_id), effectiveLineageId === UNTRAILED ? null : effectiveLineageId, lineages)}
              density="standard"
              samePage={false}
              showActions={false}
              onClick={() => openPin(pin)}
            />
          {/each}
        </div>
      {/if}
    {/if}
  </SidebarShell>

  {#if !isPhone}
    <!-- svelte-ignore unused_export_let -->
    <div class="back-row hide-on-touch">
      <Button variant="subtle" onClick={onNavigatePage}>↓ back to the page</Button>
    </div>
  {/if}
</div>

<Popover anchor={filtersChipEl} open={filtersPopoverOpen} onClose={() => (filtersPopoverOpen = false)} title="filters">
  <div class="popover-body filters-popover">
    <MemoryFiltersPanel
      {lineageTree} {activeLineageId} {setLineage} {visibleLineageTree}
      {collapsedTrails} {toggleTrailCollapse}
      {dateFilter} {todayStr} {activityByDate}
      onDateChange={(f) => { dateFilter = f; }}
      {sort} onSortChange={(s) => (sort = s)}
      pinned={filters.pinned} {togglePinned}
      showOnPage={onPageOnly} onPageToggle={lineageId == null ? () => (onPageOnly = !onPageOnly) : undefined}
      onPageCount={onPageCount}
      {activeFilters} clearAll={clearAllFilters}
      untrailedSentinel={UNTRAILED}
      showTrailNav={isPhone}
    />
  </div>
</Popover>

{#if viewingPage}
  <ThreadPageView
    date={viewingPage.date}
    pageNumber={viewingPage.pageNumber}
    onClose={() => (viewingPage = null)}
    onContinue={() => {
      const vp = { date: viewingPage.date, page_number: viewingPage.pageNumber, page_id: viewingPage.pageId };
      viewingPage = null;
      onContinueFocus(vp);
    }}
  />
{/if}

<!-- Pin modals. Same shape as SharedObjectsPanel: single modal slot, so
     opening one always replaces the other (no stacked-overlay class). Memory
     isn't an editor host, so cross-page semantics apply: scopeLabel /
     sourceLabel / backlinks come straight from the pin row (or are stubbed
     to safe defaults) and onSave always takes the cross-page write path. -->
{#if pinModalState?.type === "artifact"}
  {@const pin = pinById(pinModalState.pinId)}
  {#if pin}
    <PinArtifactModal
      pin={pin}
      samePage={false}
      scopeLabel={pin.lineage_id ? (getLineageName(pin.lineage_id) || "trail") : "global"}
      scopeVariant={pin.lineage_id ? "neutral" : "accent"}
      sourceLabel={pin.source_page_lineage_id ? (getLineageName(pin.source_page_lineage_id) || "(unknown trail)") : "untrailed"}
      backlinks={[]}
      formatRelativeDate={(iso) => (iso ? iso.slice(0, 10) : "")}
      onClose={() => (pinModalState = null)}
      onSave={(newNode, newTitle, contentChanged, titleChanged) => savePinArtifact(pin.id, newNode, newTitle, contentChanged, titleChanged)}
      onDelete={() => deletePinAndClose(pin.id)}
      onToggleAutoInsert={() => {}}
      onInject={() => {}}
      canInject={false}
      showAutoInsert={false}
      onNavigateToSource={goToPinSource}
    />
  {/if}
{:else if pinModalState?.type === "note"}
  {@const pin = pinById(pinModalState.pinId)}
  {#if pin}
    <PinNoteModal
      pin={pin}
      samePage={false}
      scopeLabel={pin.lineage_id ? (getLineageName(pin.lineage_id) || "trail") : "global"}
      scopeVariant={pin.lineage_id ? "neutral" : "accent"}
      sourceLabel={pin.source_page_lineage_id ? (getLineageName(pin.source_page_lineage_id) || "(unknown trail)") : "untrailed"}
      backlinks={[]}
      formatRelativeDate={(iso) => (iso ? iso.slice(0, 10) : "")}
      onClose={() => (pinModalState = null)}
      onSave={(newContent, newTitle, contentChanged, titleChanged) => savePinNote(pin.id, newContent, newTitle, contentChanged, titleChanged)}
      onDelete={() => deletePinAndClose(pin.id)}
      onToggleAutoInsert={() => {}}
      onInject={() => {}}
      canInject={false}
      showAutoInsert={false}
      onNavigateToSource={goToPinSource}
    />
  {/if}
{/if}

<style>
  .memory {
    width: 100%;
    flex: 1;
    min-height: 0;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    background: var(--canvas-bg);
    z-index: 1;
    box-sizing: border-box;
  }
  /* SidebarShell's own height:100% would push .back-row off-screen when
     trail-map content is tall enough to fill the viewport. Constrain it
     to flex: 1 so the shell consumes available space and the back-row
     anchors below it. */
  .memory > :global(.sidebar-shell) {
    flex: 1;
    min-height: 0;
    height: auto;
  }

  /* Make the search input claim the toolbar's primary slot. */
  .search-slot {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .count-label {
    margin-left: auto;
    font-family: "DM Mono", monospace;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.35;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem 0 1rem;
  }

  /* Memory-scoped Card surface refresh (Phase A § Section 3): borderless,
     subtle ink-tint background, rounded, comfy padding. Applied to BOTH the
     pages timeline and the pins list so the two views share one card style;
     the trail map's block surface (TrailMap.svelte) mirrors these values, so
     all three memory modes read as one card family. */
  .cards :global(.card),
  .pin-rows :global(.card) {
    /* Warm-tinted surface + a barely-there lift so the borderless card reads
       as an intentional, warm panel rather than a flat grey smudge. Derived
       from tokens so it adapts across cream / white / dark tones. */
    background: color-mix(in srgb, var(--warm-accent) 4%, color-mix(in srgb, var(--ink) 3%, var(--canvas-bg)));
    border: none;
    border-radius: var(--radius-lg);
    padding: 0.875rem 1rem;
    box-shadow: 0 0.125rem 0.5rem var(--card-shadow);
    transition: background-color var(--motion-fast), box-shadow var(--motion-fast);
  }
  .cards :global(.card.clickable:hover),
  .cards :global(.card.focused),
  .pin-rows :global(.card.clickable:hover),
  .pin-rows :global(.card.focused) {
    background: color-mix(in srgb, var(--warm-accent) 6%, color-mix(in srgb, var(--ink) 6%, var(--canvas-bg)));
    box-shadow: 0 0.25rem 1rem var(--card-shadow-hover);
  }

  /* Pins mode list — same flex column + gap as the pages timeline so the
     cards sit on a consistent rhythm across modes. */
  .pin-rows {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .loading-line {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.35;
    text-align: center;
    padding-top: 2.5rem;
  }

  .ground-stat {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    color: var(--ink);
    opacity: 0.35;
    text-align: center;
    padding: 1.25rem 0 0.5rem;
  }

  .back-row {
    padding: 0.5rem 1.75rem 0.75rem;
    display: flex;
    justify-content: center;
    border-top: 1px solid var(--horizon);
  }
  /* Belt + suspenders: even if `isPhone` JS detection lags or misses
     on certain Android WebViews, the back-row hides on any touch
     device. MobileActionBar handles "back to page" via the pages tab. */
  @media (pointer: coarse) {
    .back-row { display: none !important; }
  }

  .popover-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 14rem;
  }

  .filter-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .filter-label {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.35;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    margin-right: 0.25rem;
  }

  /* Segmented mode switch wrapper — holds the SegmentedControl mode
     switcher; the flex-shrink rule below keeps it from getting crushed
     on phone. */
  .seg {
    display: inline-flex;
    gap: 0.375rem;
  }

  .caret {
    font-size: 0.6875rem;
    opacity: 0.55;
  }

  :global(.trail-branch) {
    color: color-mix(in srgb, var(--ink) 35%, transparent);
    font-style: normal;
    margin-right: 0.125rem;
  }
  :global(.trail-chevron) {
    display: inline-block;
    width: 0.875rem;
    text-align: center;
    color: color-mix(in srgb, var(--ink) 45%, transparent);
    font-size: 0.625rem;
    margin-right: 0.1875rem;
    cursor: pointer;
    user-select: none;
  }
  :global(.trail-chevron:hover) {
    color: var(--warm-accent);
  }
  :global(.trail-chevron-spacer) {
    display: inline-block;
    width: 0.875rem;
    margin-right: 0.1875rem;
  }

  /* Phone layout: wrap the toolbar controls onto multiple rows and
     prioritize search + mode segment. Less-essential chips (date,
     filters, view) drop to a second row; count moves to its own
     line so the seg doesn't get crushed into 'tra m'. Chip type +
     border match the page header's chip language. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .seg {
      flex-shrink: 0;
    }
    .count-label {
      font-size: 0.75rem;
      flex-basis: 100%;
      text-align: right;
    }
    .search-slot {
      flex: 1 1 100%;
      min-width: 100%;
      order: -1;
    }
    /* Day-number gutter (dayMarker date column on continuous-trail
       expanded cards, ThreadCard.svelte's .marker-date) narrows on
       phone — reached via :global since the card markup is rendered
       by a child component but the width belongs to this view's
       phone rhythm, same pattern as the .cards :global(.card) reskin
       above. */
    .cards :global(.marker-date) {
      min-width: calc(4.5rem - var(--space-3));
    }
  }

  /* The shell-toolbar's flex-direction is row by default. On phone
     allow it to wrap so the search input sits on its own line above
     the seg + chips. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    :global(.shell-toolbar) {
      flex-wrap: wrap;
      row-gap: var(--space-3);
      /* No padding here. SidebarShell sets the toolbar's `padding`
         shorthand in its own file, where Svelte's scoping class makes it
         (0,2,0) — a `:global()` selector from here is (0,1,0) and loses,
         so a padding declaration in this block is silently inert. It was:
         it used to say calc(env(safe-area-inset-top) + 12px) and never
         applied once. flex-wrap and row-gap do apply, because SidebarShell
         doesn't set them. The phone padding lives in SidebarShell.svelte. */
    }
  }

  /* Phone-only: back arrow at top-left, trails trigger inside the
     toolbar (replaces the SidebarShell hamburger drawer), comfy
     spacing for the chip strip. */
  .memory-back {
    appearance: none;
    background: transparent;
    border: none;
    width: 2.5rem;
    height: 2.5rem;
    display: none;
    align-items: center;
    justify-content: center;
    color: var(--ink);
    font-family: "Lora", Georgia, serif;
    font-size: 1.5rem;
    line-height: 1;
    opacity: 0.75;
    cursor: pointer;
    border-radius: 0.375rem;
    position: absolute;
    /* Absolute inside .memory, which already sits below the shell's
       status-bar padding — an inset here would push it down a second time. */
    top: 0.5rem;
    left: max(var(--safe-left), 0.5rem);
    z-index: 2;
    transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1), opacity 120ms cubic-bezier(0.2, 0, 0, 1);
  }
  .memory-back:hover { opacity: 1; background: color-mix(in srgb, var(--ink) 5%, transparent); }
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .memory-back { display: inline-flex; }
    .memory {
      /* The status-bar inset is reserved ONCE, by .app-shell (App.svelte) —
         the same rule Page.svelte follows with its plain 12px. Memory used
         to re-add env(safe-area-inset-top) here AND again on .shell-toolbar
         inside it, so on a handset with a ~30px status bar the list started
         roughly 125px down the screen against the page's ~50px. Breathing
         room only now, matched to the page.

         The BOTTOM inset genuinely does need re-adding: it clears the
         MobileActionBar, which is position: fixed and so ignores the
         shell's padding entirely. */
      padding-top: 12px;
      padding-bottom: var(--mobile-bar-h);
      position: relative;
    }
  }

  .trails-sheet :global(.sidebar-nav-row) {
    min-height: 2.75rem;
    font-size: 0.9375rem;
    padding: 0.625rem 0.5rem;
  }
</style>
