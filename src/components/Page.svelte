<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import {
    getLocalDateStr,
    contentJsonHasDayMarker,
    contentJsonHasRealContent,
  } from "../lib/utils.js";
  import TipTapEditor from "./TipTapEditor.svelte";
  import Settings from "./Settings.svelte";
  import FocusRail from "./FocusRail.svelte";
  import LineageSelector from "./LineageSelector.svelte";
  import SharedObjectsPanel from "./SharedObjectsPanel.svelte";
  import WhatMattersNow from "./WhatMattersNow.svelte";
  import WhatShifted from "./WhatShifted.svelte";
  import PageNav from "./PageNav.svelte";
  import TrailIndex from "./TrailIndex.svelte";
  import ShortcutHelp from "./ShortcutHelp.svelte";
  import MidnightModal from "./MidnightModal.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import SyncStatusPill from "./SyncStatusPill.svelte";
  import Backlinks from "./Backlinks.svelte";
  import Button from "../lib/ui/Button.svelte";
  import TriggerChip from "../lib/ui/TriggerChip.svelte";
  import PagesChip from "../lib/ui/PagesChip.svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import { isPhoneViewport, watchPhoneViewport, watchKeyboardOpen } from "../lib/responsive.js";
  import { pageAddress } from "../lib/page-address.js";
  import { navPush, navClose, subscribe as navSubscribe } from "../lib/navstack.js";
  import { verticalFlick } from "../lib/gestures.js";
  import { canCreateNewPage } from "../lib/pageCapabilities.js";
  import { atLastPage } from "../lib/page-rail-state.js";
  import { shouldCollapseHeader } from "../lib/header-collapse.js";
  import {
    getOrCreateToday,
    saveLine,
    getAdjacentPage,
    createNewPage,
    createLineage,
    getPageCountForDate,
    checkAndAddSessionMarker,
    getFocusesForDate,
    getPage,
    deleteFocus,
    getGroundData,
    getPins,
    getLineages,
    updateWhatMattersNow,
    setFocusLineage,
    getCanonicalTrailPage,
    appendPageToCanonical,
    cleanupOrphanPages,
    cleanupEmptyDayMarkers,
    getCarryForwardPins,
    clonePageForNewDay,
    getPageForMention,
    getSetting,
    setSetting,
  } from "../lib/api.js";
  import { buildCarryForwardNodes } from "../lib/pin-carry-forward.js";
  import { recordAppearance, bumpAppearance, getAppearance, hasAppearance } from "../lib/rail-appearance.js";

  /** @type {{ onNavigateMemory: () => void, currentTone: string, onToneChange: (t: string) => void, currentFontFamily: string, onFontFamilyChange: (f: string) => void, currentFontSize: number, onFontSizeChange: (n: number) => void, onDeleteAll: () => void, continueFocus: any }} */
  let { onNavigateMemory = () => {}, currentTone = "cream", onToneChange = () => {}, currentFontFamily = "lora", onFontFamilyChange = () => {}, currentFontSize = 16, onFontSizeChange = () => {}, onDeleteAll = () => {}, continueFocus = null } = $props();

  let showSettings = $state(false);
  // Which tab Settings should land on when it next opens. Reset to the
  // default after every open request so a plain toggle (keyboard shortcut,
  // mobile action bar) doesn't inherit a stale "sync" from a prior open via
  // the sync pill.
  let settingsInitialTab = $state("appearance");
  function openSettings(tab = "appearance") {
    settingsInitialTab = tab;
    showSettings = true;
  }
  let showSharedPanel = $state(false);
  let isPhone = $state(isPhoneViewport());
  $effect(() => {
    const unwatch = watchPhoneViewport((m) => { isPhone = m; });
    return unwatch;
  });
  let keyboardOpen = $state(false);
  $effect(() => {
    const unwatch = watchKeyboardOpen((open) => { keyboardOpen = open; });
    return unwatch;
  });
  // Not a bare `isPhone && keyboardOpen`: collapsing applies display:none to
  // the header row that hosts the trail sheet, which un-focuses whatever is
  // inside it and drops the keyboard. See header-collapse.js for the full
  // account. navSnap.depth is the navstack depth (declared below).
  let headerCollapsed = $derived(
    shouldCollapseHeader({ isPhone, keyboardOpen, overlayDepth: navSnap.depth })
  );
  let targetPinId = $state(null);
  let commandPaletteOpen = $state(false);
  let pinCount = $state(0);
  let divergedPinCount = $state(0);
  let editorDoc = $state(null);
  let currentLineageName = $state("");
  let currentTrailMode = $state("discrete");
  // Cached lineage list so trail name/mode update the frame page changes, not after the next API round-trip
  let lineagesCache = $state([]);
  let flowModeRef = $state(null);
  let railFocuses = $state([]);
  let sessionMarkers = $state([]);
  let earliestDate = $state(null);

  let page = $state(null);
  let lines = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let trailWarning = $state(null);
  let trailWarningTimer = null;

  function showTrailWarning(msg) {
    trailWarning = msg;
    if (trailWarningTimer) clearTimeout(trailWarningTimer);
    trailWarningTimer = setTimeout(() => { trailWarning = null; }, 2500);
  }

  // Rail appearance order lives in a module-scope singleton so it
  // survives Page unmount/remount during Memory navigation. Without
  // that persistence, a fresh remount sorts the rail by `created_at`
  // fallback and a continuous canonical (old created_at) jumps to the
  // leftmost slot, breaking keyboard navigation. See lib/rail-appearance.js.
  // recordAppearance imported below; bumpAppearance is used in the
  // continuous-trail assignment paths to force-rewrite the canonical's
  // timestamp to "now".

  let totalPages = $state(1);
  let isToday = $state(true);
  let transitioning = $state(false);
  // +1 = moving forward (next page enters from the right), -1 = back (from
  // the left). Drives the slide direction of the writing-body transition.
  let navDirection = $state(1);

  let currentWordCount = $state(0);

  // Trail navigation palette (Cmd+K) — only on continuous trails.
  let showTrailIndex = $state(false);
  let trailIndexMarkers = $state([]);

  // Writability: must be open AND on today's date (past dates are always read-only).
  // Continuous trails are the exception: their canonical doc is always writable,
  // even though its `date` field reflects creation date rather than today.
  // NOT $derived: getLocalDateStr() reads the wall clock, which isn't a
  // reactive dependency, so a $derived would compute once at mount and never
  // update — leaving todayStr stale after midnight. A stale todayStr makes
  // isWritable() false for the new day's page (date !== todayStr), so the
  // editor renders read-only and the page looks blank/frozen. We refresh it
  // explicitly in checkMidnight() and loadPage().
  let todayStr = $state(getLocalDateStr());
  // The date context the user is actively viewing. Separate from page.date
  // and trail mode: a continuous canonical can be visited from today's rail
  // (viewingDate = today) or from yesterday's rail (viewingDate = yesterday)
  // — same page row, different surrounding day. All date-scoped UI (rail
  // focuses, page count, "new page" gating, PageNav label, prev/next bounds)
  // reads effectiveDate, which simply aliases viewingDate.
  //
  // Navigation callers pass their date context to loadPage(pageData, date):
  //   - handleRailSelect → focus.date (what rail was showing)
  //   - handleDateSelect → the picked date
  //   - continueFocus from memory → continueFocus.date
  //   - loadToday → todayStr
  //   - DB-adjacent navigation → page.date of the returned page
  let viewingDate = $state(getLocalDateStr());
  let effectiveDate = $derived(viewingDate);
  let isWritable = $derived(
    page?.is_open !== false && (page?.date === todayStr || currentTrailMode === "continuous")
  );

  // Midnight detection state. When the local clock crosses midnight while the
  // app is open, the user's current "today" page becomes a "past" page (the
  // is_open / isWritable gate flips). The modal asks how to transition:
  // start fresh on a new day's page, or clone the previous day's page so they
  // can keep working with the same content.
  let midnightSeenDate = $state(getLocalDateStr());
  let midnightSourcePageId = $state(null);
  let midnightModalOpen = $state(false);
  let midnightInterval;

  function checkMidnight() {
    const now = getLocalDateStr();
    if (now === midnightSeenDate) return;
    // Date changed. Refresh todayStr so isWritable() recomputes for the new
    // day — without this the editor would stay read-only after midnight.
    todayStr = now;
    // Show the modal only when the user was actively on the page that just
    // became "yesterday" (today's editing page).
    if (page && page.date === midnightSeenDate) {
      midnightSourcePageId = page.id;
      midnightModalOpen = true;
    }
    midnightSeenDate = now;
  }

  async function handleMidnightStartFresh() {
    midnightModalOpen = false;
    midnightSourcePageId = null;
    try {
      // loadPage expects the full result object ({ page, lines,
      // session_markers }) and reads pageData.page internally. Passing
      // result.page made page = undefined and the editor froze on an
      // empty white view.
      const result = await getOrCreateToday();
      await loadPage(result, getLocalDateStr());
    } catch (err) {
      console.error("Failed to start a fresh day:", err);
    }
  }

  async function handleMidnightContinue() {
    if (!midnightSourcePageId) {
      midnightModalOpen = false;
      return;
    }
    try {
      const result = await clonePageForNewDay(midnightSourcePageId, getLocalDateStr());
      midnightModalOpen = false;
      midnightSourcePageId = null;
      await loadPage(result, getLocalDateStr());
    } catch (err) {
      console.error("Failed to clone yesterday's page:", err);
      midnightModalOpen = false;
    }
  }

  onMount(async () => {
    // Sweep past pages that were created (typically by get_or_create_today on
    // launch) but never received content. Without this, the rail's
    // "self-pin" exception keeps surfacing them as orphan dots whenever the
    // user happens to land on one.
    try { await cleanupOrphanPages(); } catch {}
    try { await cleanupEmptyDayMarkers(); } catch {}

    // Load the earliest write date up front. The calendar in PageNav uses
    // it as the lower bound for picking past days; without it, every past
    // date is disabled. loadToday() also sets this, but the continueFocus
    // path below skips loadToday, so we need an unconditional load here.
    try {
      const gd = await getGroundData();
      earliestDate = gd?.first_write_date || null;
    } catch {}

    // If we mounted with a continueFocus prop (the user just hit "open in
    // editor" from Memory), the $effect below will load that page. Skip
    // the loadToday path here — otherwise the two async chains race and
    // loadToday often finishes last, snapping the user back to today.
    if (continueFocus && continueFocus.date && continueFocus.page_number) {
      midnightSeenDate = getLocalDateStr();
      midnightInterval = setInterval(checkMidnight, 60_000);
      return;
    }

    // Try to restore the page the user was last on. Default to disabled when
    // the setting key is unset (matches the Settings default). Falls back
    // silently to loadToday() on any miss — never crashes the open path.
    let restored = false;
    try {
      const enabled = await getSetting("restore_last_page");
      if (enabled === "true") {
        const lastId = await getSetting("last_open_page_id");
        if (lastId) {
          const row = await getPageForMention(lastId);
          if (row) {
            const result = row.lineage_mode === "continuous" && row.lineage_id
              ? await getCanonicalTrailPage(row.lineage_id)
              : await getPage(...pageAddress(row));
            if (result) {
              await loadPage(result, row.date);
              restored = true;
            }
          }
        }
      }
    } catch (err) {
      console.warn("restore_last_page failed:", err);
    }
    if (!restored) {
      await loadToday();
    }

    midnightSeenDate = getLocalDateStr();
    midnightInterval = setInterval(checkMidnight, 60_000);

    syncUnlisten = await listen("sync-pulled", async () => {
      if (page?.id) {
        try {
          const result = page.lineage_mode === "continuous" && page.lineage_id
            ? await getCanonicalTrailPage(page.lineage_id)
            : await getPage(...pageAddress(page));
          if (result) {
            page = result.page;
            lines = result.lines || [];
            // Push the new content into the TipTap editor so the visible
            // doc reflects the synced state. Without this, the editor
            // keeps its stale local copy and the user's next edit saves
            // that stale doc, wiping the remote update (data loss on
            // discrete pages with concurrent edits).
            if (result.page?.content_json && flowModeRef?.reloadFromContent) {
              flowModeRef.reloadFromContent(result.page.content_json);
            }
          } else if (viewingDate === getLocalDateStr()) {
            // The page we were on is gone. On the FIRST pull after launch
            // that is the expected outcome, not an error: `get_or_create_today`
            // mints a blank page for today before sync has had a chance to
            // say what today already holds, and the first-pull orphan sweep
            // then removes it once the real pages arrive. Without this the
            // user keeps staring at a deleted blank page while their own
            // writing from another device sits one reload away — the
            // "mobile looks empty" half of the 2026-08-22 report.
            //
            // Only for today: a past page vanishing is a delete the user
            // asked for somewhere, and snapping them to today would hide it.
            try {
              const today = await getOrCreateToday();
              if (today) await loadPage(today, getLocalDateStr());
            } catch {}
          }
        } catch {}
      }
      await loadPinCount();
      await loadRailFocuses();
    });
  });

  let syncUnlisten = $state(null);

  // MobileActionBar lives in App.svelte. Its "settings" button
  // dispatches this event; pins lives in the top-header pin chip
  // (page-scoped, not a top-level surface).
  function handleToggleSettings() {
    if (showSettings) showSettings = false;
    else openSettings();
  }

  // Mirrors App.svelte's navSnap pattern (App.svelte:241-245). Page needs
  // navSnap.depth itself so the swipe-up-to-memory flick's overlayOpen
  // gate (gesture-arming.js) can see any open navstack entry — pin panel
  // (SharedObjectsPanel pushes "shared-objects-panel"), trail index,
  // settings-section, pin note/artifact modals, sheets — not just
  // showSettings. App.svelte already owns initNavStack()'s popstate
  // wiring; Page only needs the snapshot.
  let navSnap = $state({ depth: 0, top: null, hideBar: false, has: () => false });
  $effect(() => {
    const un = navSubscribe((s) => { navSnap = s; });
    return () => un();
  });

  // Settings is a navstack entry: hardware back / the browser back button
  // closes it exactly like the in-UI close control. App.svelte reads
  // navSnap.has("settings") to know settings is open — the old
  // shizumu:settings-state event mirror is gone.
  let settingsNavId = null;
  $effect(() => {
    if (showSettings && settingsNavId === null) {
      settingsNavId = navPush("settings", () => {
        settingsNavId = null;
        showSettings = false;
      });
    } else if (!showSettings && settingsNavId !== null) {
      const id = settingsNavId;
      settingsNavId = null;
      navClose(id);
    }
  });

  // Edge swipes navigate the page rail, exactly as Ctrl/Cmd+Left and
  // Ctrl/Cmd+Right do on desktop — App.svelte owns the gesture and decides
  // the intent (lib/swipe-intent.js), this is just the same two calls the
  // keyboard shortcuts make. Note navigateNext still spawns a page at the
  // rail's right edge on today; that's the desktop behavior being mirrored,
  // not the old "every right swipe makes a page".
  function handleSwipeNavPrev() { navigatePrev(); }
  // Mid-rail, a swipe navigates and never creates — Ctrl/Cmd+Right creating
  // a page at the rail's end is a deliberate keypress meaning "keep writing
  // forward", and an edge swipe is exploratory/easy to trigger by accident.
  // App.svelte only routes here when swipeIntent() says "next", i.e. there
  // IS a next page to pull in.
  function handleSwipeNavNext() { navigateNext({ allowCreate: false }); }
  // At the rail's right edge there's nothing for "next" to pull in — that
  // used to make the swipe a silent no-op (the reported bug). App.svelte's
  // swipeIntent() now routes that case to "create" instead, which lands
  // here on the exact same handler the pages sheet's "+ new page" button
  // calls — no second creation path.
  function handleSwipeNavCreate() { handleRailNew(); }

  // Mirror the rail's "no next page" boundary out to lib/page-rail-state.js
  // so App.svelte's edge-swipe gesture — which lives outside this
  // component's tree — can tell swipeIntent() whether a right swipe should
  // navigate or create. Same boundary navigateNext() already uses.
  $effect(() => {
    const idx = railIndexOfCurrent();
    atLastPage.set(idx >= 0 && idx === railFocuses.length - 1);
  });

  onMount(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("shizumu:toggle-settings", handleToggleSettings);
    window.addEventListener("shizumu:nav-prev", handleSwipeNavPrev);
    window.addEventListener("shizumu:nav-next", handleSwipeNavNext);
    window.addEventListener("shizumu:nav-create", handleSwipeNavCreate);
  });

  onDestroy(() => {
    if (midnightInterval) clearInterval(midnightInterval);
    if (syncUnlisten) syncUnlisten();
    // Page may unmount (e.g. switching to memory) while its "settings"
    // navstack entry is still live — close it so the stack doesn't carry
    // a dangling entry whose onClose would set state on an unmounted component.
    if (settingsNavId !== null) navClose(settingsNavId);
    // Reset so a stale "true" can't survive into a space where nothing
    // re-derives it (App.svelte only ever reads this while space === "page",
    // but leaving it latched true would be a landmine for the next reader).
    atLastPage.set(false);
    if (typeof window === "undefined") return;
    window.removeEventListener("shizumu:toggle-settings", handleToggleSettings);
    window.removeEventListener("shizumu:nav-prev", handleSwipeNavPrev);
    window.removeEventListener("shizumu:nav-next", handleSwipeNavNext);
    window.removeEventListener("shizumu:nav-create", handleSwipeNavCreate);
  });

  // Returns continuous-trail canonicals whose content_json contains a
  // dayMarker for the given date. The canonical is a single DB row but it
  // contributes content to every date it was written on — so on each such
  // date's rail we surface it as if it were a page created that day. This
  // mirrors discrete-trail rail behavior (per-day dots) while keeping the
  // continuous invariant (one canonical row per trail).
  async function getContinuousCanonicalsForDate(date) {
    try {
      const trails = await getLineages();
      const canonicals = [];
      for (const trail of trails) {
        if (trail.mode !== "continuous") continue;
        const result = await getCanonicalTrailPage(trail.id);
        const canonical = result?.page;
        // Per-date marker filter — a continuous trail surfaces on a given
        // date's rail only when it actually wrote that day. Today is a
        // clean slate by default; the user picks a trail explicitly to
        // engage with it, and once they fill the gate (stamping today's
        // marker) the trail joins the rail. The "current canonical
        // without today marker" special case in loadRailFocuses keeps a
        // dot visible while the user is on the canonical itself.
        if (canonical && contentJsonHasDayMarker(canonical.content_json, date)) {
          canonicals.push(canonical);
        }
      }
      // Sort by canonical.created_at ASC (immutable). Stable across saves —
      // TipTapEditor's auto-save bumps `pages.updated_at`, which would flip
      // any sort order based on it (the trail-cycling bug from earlier).
      canonicals.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
      return canonicals;
    } catch (err) {
      console.error("getContinuousCanonicalsForDate failed:", err);
      return [];
    }
  }

  async function loadToday() {
    try {
      const result = await getOrCreateToday();
      page = result.page;
      lines = result.lines;
      sessionMarkers = result.session_markers || [];
      viewingDate = getLocalDateStr();
      isToday = true;
      // Trail mode first so updatePageCount / loadRailFocuses can short-circuit
      // for continuous trails (which own exactly one canonical page).
      await loadPinCount();
      await updatePageCount();
      await loadRailFocuses();
      // Load earliest date for date picker constraints
      try {
        const gd = await getGroundData();
        earliestDate = gd?.first_write_date || null;
      } catch {}
      // Check if we need a session marker for this return
      if (page) {
        await checkAndAddSessionMarker(page.id);
      }
    } catch (err) {
      console.error("Failed to load page:", err);
      error = err.toString();
    } finally {
      loading = false;
    }
  }

  async function handleLineageChange(lid) {
    if (!page) return;

    // A continuous canonical's lineage_id IS the trail's identity — stripping
    // or repointing it orphans the trail (its living doc becomes unreachable
    // via getCanonicalTrailPage). Unlink and discrete-reassign are blocked
    // here; continuous-to-continuous picks a few branches down navigate
    // without merging instead.
    const onContinuousCanonical = currentTrailMode === "continuous";

    // Unlink: just drop the lineage.
    if (!lid) {
      if (onContinuousCanonical) {
        showTrailWarning("can't unlink a continuous trail's living doc");
        return;
      }
      try {
        await setFocusLineage(page.id, null);
        page = { ...page, lineage_id: null };
      } catch (err) {
        console.error("setFocusLineage rejected:", err);
        showTrailWarning("couldn't unlink this page");
        return;
      }
      currentTrailMode = "discrete";
      await loadPinCount();
      await loadRailFocuses();
      return;
    }

    // Resolve the selected trail's mode. Prefer the cache so we decide
    // without a round-trip; fall back to getCanonicalTrailPage's implicit
    // check below for continuous behavior.
    const cached = lineagesCache.find((l) => l.id === lid);
    const selectedMode = cached?.mode || "discrete";

    if (selectedMode === "continuous") {
      // Does the trail already have a canonical?
      let existing = null;
      try {
        existing = await getCanonicalTrailPage(lid);
      } catch (err) {
        console.error("canonical trail page lookup failed:", err);
        return;
      }
      const canonical = existing?.page || null;

      // No canonical yet → current page becomes the canonical (first-time
      // assignment). But if the current page is itself another continuous
      // trail's canonical, doing setFocusLineage would steal it from that
      // trail. Refuse — the user has to write a new page first.
      if (!canonical) {
        if (onContinuousCanonical) {
          showTrailWarning("write a new page first to start a continuous trail");
          return;
        }
        try {
          await setFocusLineage(page.id, lid);
          page = { ...page, lineage_id: lid };
        } catch (err) {
          console.error("setFocusLineage rejected:", err);
          showTrailWarning("couldn't attach this page to the trail");
          return;
        }
        await loadPinCount();
        // Page just became the new trail's canonical — refresh the rail
        // so the dot reflects its new lineage state without waiting for
        // the user's next interaction to trigger a load.
        await loadRailFocuses();
        flowModeRef?.stampDayMarker?.(getLocalDateStr(), page.what_matters_now ?? "");
        return;
      }

      // Canonical exists and we're already on it — nothing to do.
      if (canonical.id === page.id) {
        await loadPinCount();
        flowModeRef?.stampDayMarker?.(getLocalDateStr(), page.what_matters_now ?? "");
        return;
      }

      // Switching from one continuous canonical to another: navigate, never
      // merge. appendPageToCanonical would delete the source row and destroy
      // the source trail's entire history.
      if (onContinuousCanonical) {
        bumpAppearance(existing.page.id);
        await loadPage(existing, getLocalDateStr());
        // Wait for the editor to remount and apply the new canonical's
        // content via TipTapEditor's pageId-change $effect — otherwise
        // stampDayMarker would run against the previous doc and the
        // setContent(...) call would overwrite the just-stamped marker.
        await tick();
        flowModeRef?.stampDayMarker?.(getLocalDateStr(), page.what_matters_now ?? "");
        return;
      }

      // Canonical exists elsewhere. If today's page is empty, just navigate
      // to the canonical. If today has real writing, append it to the
      // canonical (under a today dayMarker) — same final state as if the
      // trail had been selected before writing.
      const hasContent = contentJsonHasRealContent(page.content_json);
      if (hasContent) {
        try {
          const merged = await appendPageToCanonical(page.id, lid);
          if (merged) {
            bumpAppearance(merged.page.id);
            await loadPage(merged, getLocalDateStr());
          }
        } catch (err) {
          console.error("append_page_to_canonical rejected:", err);
          showTrailWarning("couldn't merge this page into the trail");
        }
        return;
      }

      // Empty-source branch — the source page has no real body text
      // (branch 5 above handled the has-content path via Rust merge).
      // Consume the source unconditionally: navigate to the canonical
      // and delete the source row. Picking a trail means "use this
      // trail's canonical instead of this scratchpad page" — the
      // scratchpad shouldn't linger as an orphan dot to the left of the
      // canonical. If the source had a `what_matters_now` value the
      // user typed, carry it onto the canonical's today marker so the
      // intent isn't silently lost. Earlier rounds preserved any source
      // with a non-trail signal, which produced the surprise of "I
      // picked a trail and now I have an extra empty page I didn't
      // want" — the inverse complaint.
      const sourceId = page.id;
      const sourceFocus = (page.what_matters_now || "").trim();
      bumpAppearance(existing.page.id);
      await loadPage(existing, getLocalDateStr());
      if (sourceId !== existing.page.id) {
        try {
          await deleteFocus(sourceId);
        } catch (err) {
          console.warn("source cleanup failed:", err);
        }
        await loadRailFocuses();
      }
      // Wait for the editor to remount and apply the new canonical's
      // content via TipTapEditor's pageId-change $effect — otherwise
      // stampDayMarker would run against the previous doc and the
      // setContent(...) call would overwrite the just-stamped marker.
      await tick();
      // Prefer the source's whatMatters (the user's just-typed intent)
      // over the canonical's stored value, which may be stale from a
      // prior day.
      const focusForMarker = sourceFocus || (page.what_matters_now ?? "");
      flowModeRef?.stampDayMarker?.(getLocalDateStr(), focusForMarker);
      return;
    }

    // Discrete trail (or unknown mode): plain reassignment in place. Refuse
    // when on a continuous canonical — the canonical can't move to a discrete
    // trail without orphaning the source continuous trail.
    if (onContinuousCanonical) {
      showTrailWarning("can't move a continuous trail's living doc");
      return;
    }
    const wasUntrailed = !page.lineage_id;
    try {
      await setFocusLineage(page.id, lid);
      page = { ...page, lineage_id: lid };
    } catch (err) {
      console.error("setFocusLineage rejected:", err);
      showTrailWarning("couldn't move this page to that trail");
      return;
    }
    await loadPinCount();
    // Page's lineage changed — refresh the rail so the dot reflects its
    // new trail attachment immediately.
    await loadRailFocuses();

    // First-time discrete trail assignment for this page → inject every
    // carry-forward pin (auto_insert=1) of the trail and its ancestors.
    // Re-assignments between trails do not re-inject.
    if (wasUntrailed) {
      await injectCarryForwardPins(lid);
    }
  }

  async function injectCarryForwardPins(lid) {
    let pins;
    try {
      pins = await getCarryForwardPins(lid);
    } catch (err) {
      console.error("getCarryForwardPins failed:", err);
      return;
    }
    if (!Array.isArray(pins) || pins.length === 0) return;

    // Defense-in-depth: dedup pins by id before fanning out into nodes.
    // appendNodesToDoc also dedups by node shape, but stripping here avoids
    // building duplicate JSON that would just be discarded.
    const seen = new Set();
    pins = pins.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });

    const nodes = buildCarryForwardNodes(pins);
    if (nodes.length > 0) {
      flowModeRef?.appendNodesToDoc?.(nodes);
    }
  }

  // `@name` typed in the editor → create a subtrail of the current trail
  // (or top-level if untrailed), create a fresh page on it, navigate.
  async function handleMentionNavigate(targetPageId) {
    if (!targetPageId) return;
    try {
      const row = await getPageForMention(targetPageId);
      if (!row) {
        showTrailWarning("that page no longer exists");
        return;
      }
      const result = row.lineage_mode === "continuous" && row.lineage_id
        ? await getCanonicalTrailPage(row.lineage_id)
        : await getPage(...pageAddress(row));
      if (result) await loadPage(result, row.date);
    } catch (err) {
      console.error("mention navigate failed:", err);
      showTrailWarning("couldn't open that page");
    }
  }

  async function handleCreateSubtrail(rawName, kind = "subtrail", trailMode = "discrete") {
    const name = (rawName || "").trim();
    if (!name) return;
    // kind = "subtrail" → child of the current page's lineage
    // kind = "toplevel" → independent trail at the doc root
    // trailMode = "discrete" | "continuous" — what @-popup's Tab toggle decided
    const parentId = kind === "subtrail" ? (page?.lineage_id || null) : null;
    const mode = trailMode === "continuous" ? "continuous" : "discrete";
    let newLineage;
    try {
      newLineage = await createLineage(name, mode, parentId);
    } catch (err) {
      console.error("createLineage failed:", err);
      showTrailWarning(`couldn't create "${name}"`);
      return;
    }
    let newPageData;
    try {
      const today = getLocalDateStr();
      newPageData = await createNewPage(today);
    } catch (err) {
      console.error("createNewPage for subtrail failed:", err);
      showTrailWarning(`couldn't open page on "${name}"`);
      return;
    }
    try {
      await setFocusLineage(newPageData.page.id, newLineage.id);
      newPageData.page = { ...newPageData.page, lineage_id: newLineage.id };
    } catch (err) {
      console.error("setFocusLineage for subtrail failed:", err);
      showTrailWarning(`couldn't link page to "${name}"`);
      return;
    }
    // Back-reference: the mention command inserted a placeholder pageRef
    // (targetId === "") at the @ position before we got here. Now that the
    // new page id exists, fill it in and flush a save BEFORE navigating
    // away, so returning to the source page later still shows the link.
    try {
      await flowModeRef?.linkPendingPageRef?.(name, newPageData.page.id);
    } catch (err) {
      console.error("linkPendingPageRef failed:", err);
    }
    try {
      await loadPage(newPageData, getLocalDateStr());
      await loadRailFocuses();
    } catch (err) {
      console.error("loadPage after subtrail create failed:", err);
      showTrailWarning(`couldn't navigate to "${name}"`);
    }
  }

  // Bumped when a pin is created so SharedObjectsPanel reloads its list
  // instead of waiting for a remount.
  let pinRefreshToken = $state(0);

  async function loadPinCount() {
    // Instant update from cache so the trail name/mode reflects the new page
    // before the API call completes.
    if (page?.lineage_id) {
      const cached = lineagesCache.find(l => l.id === page.lineage_id);
      if (cached) {
        currentLineageName = cached.name || "";
        currentTrailMode = cached.mode || "discrete";
      }
    } else {
      currentLineageName = "";
      currentTrailMode = "discrete";
    }

    try {
      const globalPins = await getPins(null);
      let trailPins = [];
      if (page?.lineage_id) {
        trailPins = await getPins(page.lineage_id);
        const lins = await getLineages();
        lineagesCache = lins;
        const lin = lins.find(l => l.id === page.lineage_id);
        currentLineageName = lin?.name || "";
        currentTrailMode = lin?.mode || "discrete";
      } else {
        const lins = await getLineages();
        lineagesCache = lins;
        currentLineageName = "";
        currentTrailMode = "discrete";
      }
      // The pin badge counts pins for the active scope:
      // - on a trail page, trail pins only (global pins are visible via the
      //   global tab inside the panel and shouldn't inflate the trail badge)
      // - on an untrailed page, global pins
      const activePins = page?.lineage_id ? trailPins : globalPins;
      pinCount = activePins.length;
      divergedPinCount = activePins.filter(p => p.diverged).length;
    } catch { pinCount = 0; divergedPinCount = 0; }
  }

  async function loadRailFocuses() {
    if (!page) return;
    try {
      let focuses = await getFocusesForDate(effectiveDate);
      // Pull in continuous-trail canonicals that wrote on the viewed date
      // (per-date marker filter — see getContinuousCanonicalsForDate).
      // Today-dated canonicals are already in `focuses` via getFocusesForDate
      // and dedup by id-match. Past-dated canonicals get added here.
      const canonicals = await getContinuousCanonicalsForDate(effectiveDate);
      const inject = canonicals
        .filter(c => !focuses.some(f => f.id === c.id))
        .map(c => ({
          id: c.id,
          date: effectiveDate,
          page_number: c.page_number,
          what_matters_now: c.what_matters_now,
          is_open: c.is_open,
          lineage_id: c.lineage_id,
          isContinuousCanonical: true,
          created_at: c.created_at,
        }));
      focuses = [...focuses, ...inject];
      // Special case: the user is currently on a continuous canonical that
      // has no dayMarker for the viewed date (e.g., past-date view via
      // memory navigation onto a canonical that didn't write that day).
      // The marker filter excludes such canonicals, but we still want a
      // rail dot for the page they're actually looking at — otherwise
      // they'd land on a page with no rail representation.
      if (
        currentTrailMode === "continuous" &&
        page?.lineage_id &&
        !focuses.some(f => f.id === page.id)
      ) {
        focuses = [
          ...focuses,
          {
            id: page.id,
            date: effectiveDate,
            page_number: page.page_number,
            what_matters_now: page.what_matters_now,
            is_open: page.is_open,
            lineage_id: page.lineage_id,
            isContinuousCanonical: true,
            created_at: page.created_at,
          },
        ];
      }
      // Sort by created_at — stable across devices (HLC-derived on
      // synced pages) and stable across navigation (the user pressing
      // Ctrl+Left to a page shouldn't reorder the rail). Continuous
      // canonicals use bumpAppearance on trail assignment to override
      // this with "moved to here just now"; that still works because
      // bumpAppearance overwrites the appearance map.
      const fallbackTime = (entry) => {
        const t = new Date(entry.created_at || 0).getTime();
        return Number.isFinite(t) ? t : 0;
      };
      focuses.sort((a, b) => {
        // Only honor appearance for items where it was EXPLICITLY bumped
        // (trail assignment). Passive loadPage no longer records, so
        // most pages fall through to created_at — stable order.
        const ta = hasAppearance(a.id) ? getAppearance(a.id) : fallbackTime(a);
        const tb = hasAppearance(b.id) ? getAppearance(b.id) : fallbackTime(b);
        return ta - tb;
      });
      railFocuses = focuses;
    } catch {
      railFocuses = [];
    }
  }

  async function handleRailSelect(focusId) {
    const focus = railFocuses.find(f => f.id === focusId);
    if (!focus) return;
    // Slide direction follows the rail: a dot to the right of the current
    // one reads as moving forward, to the left as moving back.
    const curIdx = railIndexOfCurrent();
    const tgtIdx = railFocuses.findIndex(f => f.id === focusId);
    if (curIdx >= 0 && tgtIdx >= 0 && curIdx !== tgtIdx) {
      navDirection = tgtIdx > curIdx ? 1 : -1;
    }
    try {
      // Continuous canonicals are rendered with an overridden display date,
      // so fetch by lineage_id instead of the date+page_number path that
      // regular per-day dots use.
      let result;
      if (focus.isContinuousCanonical && focus.lineage_id) {
        result = await getCanonicalTrailPage(focus.lineage_id);
      } else {
        result = await getPage(...pageAddress(focus));
      }
      // Pass focus.date as the date context so the canonical stays under
      // whichever day the rail was displaying when the user clicked.
      if (result) await loadPage(result, focus.date);
    } catch (err) {
      console.error("Rail navigation error:", err);
    }
  }

  async function handleRailNew() {
    if (!page) return;
    const today = getLocalDateStr();
    // "+" only makes sense on today's rail — new pages go under today.
    if (viewingDate !== today) return;
    // Always allow creating a new page. Empty drafts are visible on the rail
    // (so the click feels alive) but stay out of memory and prev/next via
    // is_page_relevant. cleanup_orphan_pages sweeps untouched ones on launch.
    try {
      const newFocus = await createNewPage(today);
      await loadPage(newFocus, today);
      await loadRailFocuses();
    } catch (err) {
      console.error("Failed to create new focus:", err);
    }
  }

  async function updatePageCount() {
    if (!page) return;
    try {
      totalPages = await getPageCountForDate(effectiveDate);
    } catch {
      totalPages = page.page_number;
    }
  }

  async function loadPage(pageData, dateContext = null) {
    try {
      transitioning = true;
      await new Promise((r) => setTimeout(r, 50));
      page = pageData.page;
      // No recordAppearance here: passive page loads (Ctrl+Left/Right
      // navigation, rail clicks) shouldn't reorder the rail. The rail
      // sorts by created_at (stable across devices via HLC). Only
      // bumpAppearance (trail assignment) overrides this.
      // Persist for restore-on-open. Fire-and-forget; failure is non-fatal.
      if (page?.id) {
        setSetting("last_open_page_id", page.id).catch(() => {});
      }
      lines = pageData.lines;
      sessionMarkers = pageData.session_markers || [];
      // Set the viewing date. Callers that know the rail context (rail-click,
      // date picker, memory view) pass it explicitly — that lets a continuous
      // canonical be viewed under yesterday or today without snapping context.
      // Without a dateContext, follow the page's DB date (normal case).
      viewingDate = dateContext || page.date;
      await loadPinCount();
      const today = getLocalDateStr();
      todayStr = today; // keep fresh across a midnight crossing (see todayStr note)
      isToday = viewingDate === today;
      await updatePageCount();
      await loadRailFocuses();
    } finally {
      // Clear loading on every path (initial restore, navigation, errors).
      // Without this the {#if loading} branch never renders the page.
      loading = false;
      transitioning = false;
    }
  }

  async function handleLineSave(text, state, pauseMs) {
    if (!page) return null;
    const saved = await saveLine(page.id, {
      text,
      state,
      pause_duration_ms: pauseMs,
    });
    return saved;
  }

  // On a continuous canonical, the UI presents it as if it lives on
  // effectiveDate (not its DB row date). Navigation must follow the same
  // illusion — use the rail order so prev/next walk through dots visible to
  // the user, not the canonical's underlying adjacency in the DB.
  function railIndexOfCurrent() {
    if (!page) return -1;
    return railFocuses.findIndex(f => f.id === page.id);
  }

  // Keyboard arrows walk the rail linearly through every dot — continuous
  // canonicals and discrete pages alike. ctrl+← at idx=0 is a no-op (use
  // memory ctrl+↑ for past days). ctrl+→ at the rightmost rail dot creates
  // a new today page so the user can keep moving forward via keyboard.
  // The createNewPage is gated to today only and only fires at idx=last —
  // it can't auto-spawn cycles because canonicals sit at the left edge
  // (sorted by their immutable created_at in getContinuousCanonicalsForDate)
  // and new discrete pages sort to the right by page_number.
  async function navigatePrev() {
    if (!page || transitioning) return;
    try {
      const idx = railIndexOfCurrent();
      if (idx > 0) {
        await handleRailSelect(railFocuses[idx - 1].id);
      }
    } catch (err) {
      console.error("Navigation error:", err);
    }
  }

  async function navigateNext({ allowCreate = true } = {}) {
    if (!page || transitioning) return;
    try {
      const idx = railIndexOfCurrent();
      if (idx >= 0 && idx < railFocuses.length - 1) {
        await handleRailSelect(railFocuses[idx + 1].id);
        return;
      }
      // At the rail's right edge: spawn a new today page so the user can
      // keep writing forward via the keyboard. Guard on effectiveDate ===
      // today — past-date views are read-only and a row there would be an
      // instant orphan. Each press creates exactly one page; the new page
      // lands at the rightmost rail position (highest page_number) and
      // becomes the new "last dot" for the next press.
      if (!allowCreate) return;
      const today = getLocalDateStr();
      if (effectiveDate === today) {
        navDirection = 1;
        const newPage = await createNewPage(today);
        await loadPage(newPage, today);
        await loadRailFocuses();
      }
    } catch (err) {
      console.error("Navigation error:", err);
    }
  }

  async function handleRailDelete(focusId) {
    try {
      const isDeletingCurrent = page && page.id === focusId;
      let target = null;
      if (isDeletingCurrent) {
        try { target = await getAdjacentPage(focusId, "prev"); } catch {}
        if (!target) {
          try { target = await getAdjacentPage(focusId, "next"); } catch {}
        }
      }
      await deleteFocus(focusId);
      await loadRailFocuses();
      if (isDeletingCurrent) {
        if (target) {
          await loadPage(target);
        } else {
          await loadToday();
        }
      }
    } catch (err) {
      console.error("Failed to delete focus:", err);
    }
  }

  async function handleDateSelect(selectedDate) {
    if (!selectedDate) return;
    try {
      const focuses = await getFocusesForDate(selectedDate);
      if (focuses.length > 0) {
        const result = await getPage(...pageAddress(focuses[0]));
        if (result) await loadPage(result, selectedDate);
        await loadRailFocuses();
        return;
      }
      // No focuses on the picked date. Past dates are read-only, so creating
      // a fresh page there would just produce a permanent orphan (empty +
      // unwritable). Only today gets an on-demand row.
      const today = getLocalDateStr();
      if (selectedDate === today) {
        const newFocus = await createNewPage(selectedDate);
        await loadPage(newFocus, selectedDate);
        await loadRailFocuses();
      } else {
        showTrailWarning("nothing written this day");
      }
    } catch (err) {
      console.error("Failed to navigate to date:", err);
    }
  }

  function handleShiftedSave() {
    if (page) {
      page = { ...page, what_shifted_complete: true };
    }
    loadRailFocuses();
  }

  // Returns true if the trail index opened (continuous trail with markers).
  // Lets the Cmd+K handler fall through to the global command palette
  // when this context doesn't have anything to index.
  function openTrailIndex() {
    if (currentTrailMode !== "continuous") return false;
    const markers = flowModeRef?.getDayMarkers?.() || [];
    if (markers.length === 0) return false;
    trailIndexMarkers = markers;
    showTrailIndex = true;
    return true;
  }

  function handleTrailIndexSelect(date) {
    flowModeRef?.scrollToDate?.(date);
  }

  function handleKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "ArrowLeft") {
      e.preventDefault();
      navigatePrev();
    } else if (mod && e.key === "ArrowRight") {
      e.preventDefault();
      navigateNext();
    } else if (mod && e.key === "ArrowUp") {
      e.preventDefault();
      onNavigateMemory();
    } else if (mod && e.key === ",") {
      e.preventDefault();
      if (showSettings) showSettings = false;
      else openSettings();
    } else if (mod && e.key === "k") {
      e.preventDefault();
      // Cmd+K on a continuous trail with markers opens the in-doc trail
      // index (existing behavior). Anywhere else, fall through to the
      // global command palette for cross-page navigation.
      const opened = openTrailIndex();
      if (!opened) commandPaletteOpen = true;
    } else if (e.key === "Escape" && !showSettings && !showTrailIndex && !commandPaletteOpen) {
      flowModeRef?.focusInput();
    }
  }

  // Handle continue focus from Memory view. For continuous-trail pages the
  // user expects to land on TODAY's view of the canonical (the trail is a
  // single living doc), not the canonical's underlying DB date. We resolve
  // lineage_mode via getPageForMention(page_id) — same shape as the
  // restore-last-page path — and route through getCanonicalTrailPage when
  // the row belongs to a continuous trail. Falls back to date+page_number
  // lookup when no page_id is present (older callers).
  let lastContinueFocus = $state(null);
  $effect(() => {
    if (!continueFocus || !continueFocus.date || !continueFocus.page_number) return;
    if (continueFocus === lastContinueFocus) return;
    lastContinueFocus = continueFocus;
    (async () => {
      try {
        if (continueFocus.page_id) {
          const row = await getPageForMention(continueFocus.page_id);
          if (row && row.lineage_mode === "continuous" && row.lineage_id) {
            const canonical = await getCanonicalTrailPage(row.lineage_id);
            if (canonical) {
              // Open the canonical at the CLICKED date, not today —
              // when the user picks "may 12" from memory, the page
              // should land on may 12's dayMarker, not snap forward.
              await loadPage(canonical, continueFocus.date);
              return;
            }
          }
        }
        const result = await getPage(...pageAddress(continueFocus));
        if (result) await loadPage(result, continueFocus.date);
      } catch (err) {
        console.warn("continueFocus load failed:", err);
      }
    })();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="page"
  class:transitioning
  use:verticalFlick={{
    onUp: () => onNavigateMemory(),
    // .sheet: a fast vertical drag scrolling a BottomSheet's body (date
    // calendar, pages list, trail picker) must not also register as a
    // swipe-to-memory flick — that would tear the sheet down mid-scroll,
    // reading as "the sheet doesn't open" when it's actually closing under
    // the user's thumb before they finish reading it.
    // .modal / .modal-body: the settings/sync modal renders INSIDE .page (it is
    // only visually detached via position:fixed, not portaled), so scrolling
    // its body bubbled to this flick and jumped to memory — pronounced once the
    // pairing wizard makes the pane taller than the viewport and it can scroll.
    ignoreSelector: ".tiptap-editor, .thread-scroll, .scrollable, .panel-list, .memory-list, .sheet, .modal, .modal-body, textarea, input",
    // Allowlist (gesture-arming.js): armed only when nothing is open —
    // navSnap.depth catches every navstack entry (pin panel, trail index,
    // settings-section, pin modals, sheets); showSettings is read directly
    // too because navPush("settings") lands one effect tick after
    // showSettings flips, and a touchstart landing in that gap must still
    // see settings as open — AND the editor's own scroll container was
    // already at its bottom boundary when the touch started. ignoreSelector
    // above stays as belt-and-braces for touches starting inside a
    // scrollable directly.
    overlayOpen: () => showSettings || navSnap.depth > 0,
    // The soft keyboard being open means the user is typing — a flick must
    // never fire mid-keystroke.
    keyboardOpen: () => keyboardOpen,
    scrollEl: () => flowModeRef?.getScrollEl?.() ?? null,
  }}
>

  {#if loading}
    <!-- Blank canvas is the loading state -->
  {:else if error}
    <div class="column">
      <p class="error label">{error}</p>
    </div>
  {:else if page}
    <div class="column">
      <!-- Memory link -->
      <div class="memory-wrap">
        <Button variant="ghost" onClick={onNavigateMemory} ariaLabel="open memory">↑ open memory</Button>
      </div>

      <!-- Focus dots + trail + pins -->
      <div class="top-header" class:is-phone={isPhone} class:collapsed={headerCollapsed}>
        <!-- Shared trigger snippets — same props/markup rendered from both
             the phone editorial scaffold and the desktop .top-right cluster,
             so the two branches can't drift out of sync with each other. -->
        {#snippet pinsChip()}
          <TriggerChip
            label="pins"
            count={pinCount > 0 ? pinCount : undefined}
            active={showSharedPanel}
            onClick={() => showSharedPanel = !showSharedPanel}
            ariaLabel={showSharedPanel ? "close pin panel" : "open pin panel"}
          >
            {#snippet leading()}
              <span class="pin-icon"><Icon name="arrow-up-right" /></span>
            {/snippet}
            {#if divergedPinCount > 0}
              {#snippet trailing()}
                <span class="diverged-badge">{divergedPinCount}!</span>
              {/snippet}
            {/if}
          </TriggerChip>
        {/snippet}
        {#snippet trailChip(compact)}
          <LineageSelector
            pageId={page.id}
            lineageId={page.lineage_id || null}
            readonly={!isWritable}
            onLineageChange={handleLineageChange}
            compact={compact}
          />
        {/snippet}
        {#if headerCollapsed}
          <div class="collapsed-pill" aria-live="polite">
            {viewingDate === todayStr ? "today" : viewingDate}{currentLineageName ? ` · ${currentLineageName}` : ""}
          </div>
        {/if}
        <!-- Row stays mounted even when collapsed; .hidden-while-collapsed
             toggles display: none. Unmounting LineageSelector mid-typing
             would destroy any open trail/picker BottomSheet — the user
             reports the trail sheet disappearing on input focus is
             exactly this. -->
        {#if isPhone}
          <div class="eh" class:hidden-while-collapsed={headerCollapsed}>
            <div class="eh-line1">
              <PageNav
                editorial
                date={viewingDate}
                pageNumber={page.page_number}
                {totalPages}
                onPrev={navigatePrev}
                onNext={navigateNext}
                onDateSelect={handleDateSelect}
                {earliestDate}
                focuses={railFocuses}
                onFocusSelect={async (f) => {
                  const result = f.isContinuousCanonical && f.lineage_id
                    ? await getCanonicalTrailPage(f.lineage_id)
                    : await getPage(...pageAddress(f));
                  if (result) await loadPage(result, f.date);
                }}
                onNewPage={handleRailNew}
                canNewPage={canCreateNewPage(viewingDate, getLocalDateStr())}
              />
            </div>
            <!-- pins sits on line 2 with trail and pages, not up on line 1
                 beside the date. All three are the same kind of thing — a
                 way into somewhere else — and they now read as one row of
                 them instead of one stray chip on the date's line. -->
            <div class="eh-line2">
              {@render trailChip(true)}
              {#if railFocuses.length > 0}
                <span class="eh-sep" aria-hidden="true"></span>
                <PagesChip
                  focuses={railFocuses}
                  currentPageNumber={page.page_number}
                  onSelect={(f) => handleRailSelect(f.id)}
                  onNew={handleRailNew}
                  canNew={canCreateNewPage(viewingDate, getLocalDateStr())}
                />
              {/if}
              <div class="eh-actions">
                {@render pinsChip()}
              </div>
            </div>
          </div>
        {:else}
          <div class="top-row-1" class:hidden-while-collapsed={headerCollapsed}>
            {#if railFocuses.length > 0}
              <FocusRail
                focuses={railFocuses}
                currentId={page.id}
                onSelect={handleRailSelect}
                onNew={handleRailNew}
                onDelete={handleRailDelete}
                trailMode={currentTrailMode}
                lineageId={page.lineage_id || null}
                isToday={isToday}
              />
            {/if}
            <div class="top-right">
              <SyncStatusPill onOpen={() => openSettings("sync")} />
              {@render trailChip(false)}
              {@render pinsChip()}
            </div>
          </div>
        {/if}
      </div>

      <!-- Trail collision warning -->
      {#if trailWarning}
        <div class="trail-warning label" role="status">{trailWarning}</div>
      {/if}

      <!-- Writing body — slides on page navigation while the header/rail
           and bottom bar stay put. --slide-x sets the enter side. -->
      <div class="page-body" style="--slide-x: {navDirection > 0 ? '2rem' : '-2rem'}">
      <!-- Focus declaration -->
      <div class="top-zone">
        <WhatMattersNow
          pageId={page.id}
          value={page.what_matters_now}
          readonly={!isWritable}
          required={isWritable}
          onValueChange={(text) => {
            // Patch the rail entry so FocusRail tooltip reflects the new value
            // in the same tick, without waiting for a full loadRailFocuses round-trip.
            if (page) {
              const hasEntry = railFocuses.some((f) => f.id === page.id);
              if (hasEntry) {
                railFocuses = railFocuses.map((f) =>
                  f.id === page.id ? { ...f, what_matters_now: text || null } : f
                );
              } else {
                // Page not yet in railFocuses (e.g., freshly created or date
                // with no focuses returned). Mirror loadRailFocuses' fallback
                // synthesis so FocusRail sees the update in the same tick.
                railFocuses = [
                  ...railFocuses,
                  {
                    id: page.id,
                    date: effectiveDate,
                    page_number: page.page_number,
                    what_matters_now: text || null,
                    is_open: page.is_open,
                    lineage_id: page.lineage_id,
                    isContinuousCanonical: currentTrailMode === "continuous",
                    created_at: page.created_at,
                  },
                ];
              }
            }
            if (currentTrailMode === "continuous" && page?.lineage_id) {
              flowModeRef?.stampDayMarker?.(getLocalDateStr(), text || "");
            }
          }}
          onInput={(text) => { if (page) page = { ...page, what_matters_now: text || null }; }}
          onEnter={() => { if (flowModeRef?.focusInput) flowModeRef.focusInput(); }}
        />
      </div>

      <!-- Writing area. -->
      <div class="flow-zone">
        <TipTapEditor
          bind:this={flowModeRef}
          pageId={page.id}
          initialContent={page.content_json}
          initialYjsState={page.yjs_state ?? null}
          readonly={!isWritable}
          lineageId={page.lineage_id || null}
          onPinCreated={() => { pinRefreshToken += 1; loadPinCount(); }}
          onDocChange={(json) => editorDoc = json}
          onWordCount={(c) => currentWordCount = c}
          onCreateSubtrail={handleCreateSubtrail}
          onMentionNavigate={handleMentionNavigate}
          onPinRefNavigate={(pinId) => { showSharedPanel = true; targetPinId = pinId; }}
          trailMode={currentTrailMode}
          trailLineageId={page.lineage_id || null}
          isTrailMode={currentTrailMode === "continuous"}
          currentLineageId={page.lineage_id || null}
          currentLineageName={currentLineageName || ""}
        />
        <Backlinks pageId={page?.id || null} onNavigate={handleMentionNavigate} />
      </div>
      </div>
    </div>

    <!-- Bottom bar: what shifted + nav -->
    <div class="bottom-bar">
      <div class="bottom-left">
        {#if currentTrailMode !== "continuous"}
          <WhatShifted
            pageId={page.id}
            value={page.what_shifted}
            complete={page.what_shifted_complete}
            readonly={!isWritable}
            hasParent={!!page.parent_id}
            onClose={handleShiftedSave}
          />
        {/if}
      </div>
      <div class="bottom-center">
        {#if !isPhone}
          <PageNav
            date={viewingDate}
            pageNumber={page.page_number}
            {totalPages}
            onPrev={navigatePrev}
            onNext={navigateNext}
            onDateSelect={handleDateSelect}
            {earliestDate}
            focuses={railFocuses}
            onFocusSelect={async (f) => {
              const result = f.isContinuousCanonical && f.lineage_id
                ? await getCanonicalTrailPage(f.lineage_id)
                : await getPage(...pageAddress(f));
              if (result) await loadPage(result, f.date);
            }}
            onNewPage={handleRailNew}
            canNewPage={canCreateNewPage(viewingDate, getLocalDateStr())}
          />
        {/if}
      </div>
      <div class="bottom-right">
        {#if currentWordCount > 0}
          <span class="word-ct label">{currentWordCount}w</span>
        {/if}
        {#if !isPhone}
          <Button variant="ghost" onClick={() => openSettings()} ariaLabel="settings">⚙</Button>
        {/if}
      </div>
    </div>

    {#if showSettings}
      <Settings
        {currentTone}
        {onToneChange}
        {currentFontFamily}
        {onFontFamilyChange}
        {currentFontSize}
        {onFontSizeChange}
        initialTab={settingsInitialTab}
        {onDeleteAll}
        onClose={() => {
          showSettings = false;
          flowModeRef?.focusInput();
        }}
      />
    {/if}

    {#if showTrailIndex}
      <TrailIndex
        markers={trailIndexMarkers}
        onSelect={handleTrailIndexSelect}
        onClose={() => { showTrailIndex = false; flowModeRef?.focusInput(); }}
      />
    {/if}

    <!-- Pins panel -->
    {#if page && showSharedPanel}
      <SharedObjectsPanel
        refreshToken={pinRefreshToken}
        lineageId={page.lineage_id || null}
        lineageName={currentLineageName}
        pageId={page.id}
        editorDoc={editorDoc}
        openPinId={targetPinId}
        onPinOpened={() => (targetPinId = null)}
        onClose={() => { showSharedPanel = false; targetPinId = null; loadPinCount(); }}
        onPinRemoved={(content) => {
          if (flowModeRef?.invalidatePinContent) {
            flowModeRef.invalidatePinContent(content);
          }
        }}
        onPinInject={(nodes) => flowModeRef?.appendNodesToDoc?.(nodes)}
        onPinLocate={(pinId) => flowModeRef?.scrollToPinId?.(pinId)}
        onSamePagePinSave={(pinId, newNode) => flowModeRef?.spliceNodeAtPinId?.(pinId, newNode)}
        onNavigateToSource={(srcPageId) => { showSharedPanel = false; handleMentionNavigate(srcPageId); }}
      />
    {/if}
  {/if}

  <ShortcutHelp />
  <MidnightModal
    open={midnightModalOpen}
    onStartFresh={handleMidnightStartFresh}
    onContinue={handleMidnightContinue}
  />
  <CommandPalette
    open={commandPaletteOpen}
    onClose={() => commandPaletteOpen = false}
    onNavigate={handleMentionNavigate}
  />

  <!-- Bottom action bar — visible on phones/tablets only (CSS-gated at
       ≤ 768px). MobileActionBar is now hoisted to App.svelte so it
       persists across views; Page listens for the toggle events
       dispatched from there. -->

</div>

<style>
  .page {
    position: relative;
    width: 100%;
    /* Carry the editor font-size on the page itself so `ch` resolves to
       the current canvas font. Without this the column would always be
       computed at the document's default 16px and wouldn't widen when
       the user picks a larger size in settings. Children with explicit
       font-size (input chrome, labels, slash menu, etc.) override this
       inherited value, so only untargeted text picks it up — which is
       fine because such text is body/canvas-context anyway. */
    font-size: var(--editor-font-size, 16px);
    /* Width scales with the canvas font (65ch = ~65 readable characters
       at the current font size), but never collapses below 820px on
       desktop — at small font sizes a strict 65ch column would shrink to
       ~720px on a wide screen, which feels like a sliver instead of a
       writing surface. Max stays at 1100px so a fullscreen big-font
       session doesn't sprawl. On tablet/phone (≤ 768px) the lower
       floor is removed entirely so 65ch can collapse to the viewport. */
    max-width: clamp(820px, calc(65ch + 104px), 1100px);
    align-self: stretch;
    /* Top padding tightened (was 32px) so the focus pill / WMN sit higher
       and feel less stranded on a short or empty page. Right/left padding
       honors the iPhone safe-area-inset on the canvas-edge sides. */
    padding:
      16px
      max(var(--safe-right), 52px)
      0
      max(var(--safe-left), 52px);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    margin: 0 auto;
    transition: opacity 150ms ease;
    background: var(--canvas-bg);
    z-index: 1;
  }

  /* Writing body: fills the column below the header, and carries the
     page-navigation slide. Header/rail and bottom bar stay put. */
  .page-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    transition:
      transform var(--motion-normal, 240ms) cubic-bezier(0.2, 0, 0, 1),
      opacity var(--motion-fast, 140ms) ease;
  }

  /* `will-change: transform` ONLY while the slide is running.
     Unconditionally, it makes this element the containing block for every
     `position: fixed` descendant — which is every overlay the editor mounts,
     since TipTapEditor lives in here. Those overlays then measure the
     viewport in JS and get positioned against the writing body's box
     instead: ChartBuilder's modal starts below the header while still being
     100dvh tall, so its action row hangs off the bottom, and SharePopup's
     "20% down so the keyboard never covers it" becomes 20% measured from the
     wrong origin. Their scrims dim only the writing body, leaving the header
     live behind a modal surface.
     Settings, TrailIndex and CommandPalette render OUTSIDE .page-body, which
     is why this only ever bit the editor's own overlays. */
  .page-body.transitioning {
    will-change: transform;
  }

  /* During the swap window the body eases off toward the travel direction
     and fades; when .transitioning clears, the freshly-loaded page eases
     back to centre — a smooth directional slide-in. */
  .page.transitioning .page-body {
    transform: translateX(var(--slide-x, 2rem));
    opacity: 0;
  }

  /* Tablet + phone: drop the 820px lower floor so the 65ch column can
     collapse to viewport width, and shrink the canvas-edge padding so
     the writing surface gets enough room. Honors safe-area-inset on the
     left/right edges (notch / curved corners). */
  @media (max-width: 768px), (orientation: landscape) and (max-height: 480px) {
    .page {
      max-width: 100%;
      padding:
        12px
        max(var(--safe-right), 1rem)
        0
        max(var(--safe-left), 1rem);
    }
  }
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .page {
      /* The status-bar inset is reserved once by .app-shell (App.svelte), so
         the top here is just breathing room below it — re-adding the inset
         would double it. Bottom clears the fixed MobileActionBar so the
         .bottom-bar (what-settled + word count + settings) isn't covered. */
      padding:
        12px
        max(var(--safe-right), var(--space-4))
        0
        max(var(--safe-left), var(--space-4));
      /* The bar hides under the keyboard, so its clearance yields to the
         keyboard inset (same shape as Modal.svelte's padding). */
      padding-bottom: max(0px, calc(var(--mobile-bar-h) - var(--kb-inset, 0px)));
    }
  }

  .column {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
    z-index: 1;
    /* Clip the sliding body's off-screen offset so it never spawns a
       horizontal scrollbar mid-transition (clip keeps vertical scroll). */
    overflow-x: clip;
  }

  .top-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-bottom: 0.5rem;
  }

  /* Phone: stacks the editorial scaffold (.eh) in a column. Desktop
     stays a single flex row (.top-row-1 + .top-right). */
  .top-header.is-phone {
    flex-direction: column;
    align-items: stretch;
    gap: 0.625rem;
    padding-top: var(--space-2);
    padding-bottom: var(--space-3);
    transition: gap var(--motion-normal);
  }
  .top-header.is-phone.collapsed {
    gap: 0;
    padding-bottom: 0;
  }
  /* Keep rows mounted so portaled descendants (LineageSelector's trail
     BottomSheet etc.) survive the IME-driven collapse.

     The doubled class is load-bearing, not a typo. `.eh` and `.top-row-1`
     below both set `display: flex` at the same specificity as a single
     `.hidden-while-collapsed`, and they come later in this stylesheet — so
     the later rule won and the row never actually hid. The keyboard would
     open, the collapsed pill would render "today", and PageNav's "today ⌄"
     calendar trigger stayed painted right beneath it: two todays stacked.
     Doubling the class outranks any single-class display rule regardless
     of where it sits, so this can't silently break again when someone adds
     a row style further down. */
  .hidden-while-collapsed.hidden-while-collapsed {
    display: none;
  }
  .collapsed-pill {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.375rem 0.25rem;
    height: 2rem;
    display: flex;
    align-items: center;
    animation: pill-in 80ms var(--motion-fast) both;
  }
  @keyframes pill-in {
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 0.55; transform: translateY(0); }
  }
  .top-row-1 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }

  .top-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }

  /* Editorial header (phone): quiet, no boxes. One accent per line. */
  .eh { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-3); }
  .eh-line1 { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; }
  /* Right-aligned on its row: pins keeps the edge it has always had, so
     moving it down a line changes which row it belongs to without
     rearranging where the eye looks for it. */
  .eh-actions { display: flex; align-items: center; gap: var(--space-1); flex-shrink: 0; margin-left: auto; }
  .eh-line2 { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  .eh-sep { width: 3px; height: 3px; border-radius: 50%; background: color-mix(in srgb, var(--ink) 15%, transparent); flex-shrink: 0; }
  /* Dangling separator: readonly untrailed past pages render no trail chip,
     so the dot that was meant to sit between it and the page-dots would
     otherwise open the line with an orphaned bullet. */
  .eh-line2 > .eh-sep:first-child { display: none; }
  /* Unbox the trail trigger and pins chip inside the editorial header only. */
  .eh :global(.trigger-chip) {
    border-color: transparent;
    padding-left: 0;
    padding-right: var(--space-2);
  }
  /* Quiet by default — "+ trail" is an invitation, not a decision already
     made. Accent only kicks in once a trail is actually attached (.active,
     set by LineageSelector from `!!currentLineage`). */
  .eh-line2 :global(.trigger-chip) { color: var(--ink); opacity: 0.45; }
  .eh-line2 :global(.trigger-chip.active) {
    background: transparent;
    border-color: transparent;
    color: var(--warm-accent);
    /* Same specificity as the quiet base rule above (both are two classes
       plus this component's scoping hash) — without an explicit opacity
       here, source order left the trailed chip stuck at the quiet 0.45
       instead of reading as a full accent "active" state. */
    opacity: 1;
  }
  /* The pages chip stays unboxed like its neighbours. It briefly carried a
     hairline pill so it wouldn't read as a static count, but that was a
     workaround for having no affordance of its own: it now has a real
     chevron icon, which says "opens something" without a border, and the
     pill was the only outlined control on this line — the one thing that
     didn't match. Opacity alone separates it from the quiet trail chip. */
  .eh-line2 :global(.pages-chip .trigger-chip) {
    opacity: 0.75;
  }
  .eh-actions :global(.trigger-chip) { color: var(--ink); opacity: 0.6; }
  .eh-actions :global(.trigger-chip.active) { color: var(--warm-accent); opacity: 1; }
  /* Today-link accent exception: when the return link is present, pins yields. */
  .eh:has(.pn-today) .eh-actions :global(.trigger-chip.active) { color: var(--ink); background: transparent; }

  .pin-icon {
    display: inline-flex;
    line-height: 1;
  }

  .diverged-badge {
    font-size: 0.7rem;
    color: color-mix(in srgb, var(--ink) 60%, #c44 40%);
    margin-left: 0.15rem;
  }

  .top-zone {
    flex-shrink: 0;
    padding-bottom: 0.75rem;
  }

  .flow-zone {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .bottom-bar {
    flex-shrink: 0;
    margin-top: auto;
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 0 1rem;
    gap: 0.75rem;
    overflow: visible;
  }
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .bottom-bar { padding: var(--space-2) 0 var(--space-1); }
  }
  /* Hide the bottom-bar (what-settled + word count + cog) when any
     BottomSheet or Modal is open. Both overlays' z-index (9999 / 201)
     should cover it, but .bottom-bar is a DOM sibling of .column (both
     z-index: 1, direct children of .page) declared LATER — so at the
     .page stacking level the tie goes to source order and .bottom-bar
     paints over whatever's nested inside .column, no matter how high
     that content's own z-index is. Concretely: ChartBuilder's Modal on
     phone (full-screen, z-index 201) still had "what settled" show
     through over its node rows. Belt + suspenders on both classes. */
  :global(body.shizumu-bottom-sheet-open) .bottom-bar,
  :global(body.shizumu-modal-open) .bottom-bar {
    display: none;
  }

  .bottom-left {
    flex: 1 1 0;
    min-width: 0;
    max-width: 22.5rem;
  }

  .memory-wrap {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    padding: 0.25rem 0;
  }
  /* Phone: MobileActionBar already exposes "memory" at the bottom. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .memory-wrap { display: none; }
  }

  .bottom-center {
    flex-shrink: 0;
    margin-left: auto;
  }

  .bottom-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .word-ct {
    font-size: 0.625rem;
    opacity: 0.25;
    color: var(--ink);
  }

  .trail-warning {
    align-self: flex-start;
    font-size: 0.6875rem;
    color: var(--warm-accent);
    opacity: 0.75;
    padding: 0.1875rem 0 0.5rem;
    animation: trail-warn-fade 2.5s ease forwards;
  }

  @keyframes trail-warn-fade {
    0%   { opacity: 0.75; }
    70%  { opacity: 0.75; }
    100% { opacity: 0; }
  }

  .error {
    opacity: 0.55;
    font-style: italic;
    margin-top: auto;
  }
</style>
