<script>
  import { onMount } from "svelte";
  import "./styles/vr.css";
  import Page from "./components/Page.svelte";
  import Memory from "./components/Memory.svelte";
  import Onboarding from "./components/Onboarding.svelte";
  import LockScreen from "./components/LockScreen.svelte";
  import { checkOnboardingComplete, getSetting, checkEncryptionStatus, createNewPage } from "./lib/api.js";
  import { getLocalDateStr } from "./lib/utils.js";
  import MobileActionBar from "./components/MobileActionBar.svelte";
  import { isMobileNav, watchMobileNav } from "./lib/responsive.js";
  import { syncAppHeight } from "./lib/viewport-height.js";
  import { edgeSwipe } from "./lib/gestures.js";
  import { swipeIntent } from "./lib/swipe-intent.js";
  import { initNavStack, navPush, navClose, navBack, subscribe as navSubscribe } from "./lib/navstack.js";

  function resolveSystemTone() {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "cream";
  }

  function applyTone(toneValue) {
    const effective = toneValue === "system" ? resolveSystemTone() : toneValue;
    document.documentElement.setAttribute("data-tone", effective);
  }

  function applyFontFamily(family) {
    document.documentElement.setAttribute("data-font-family", family);
  }

  function applyFontSize(px) {
    const size = Math.max(10, Math.min(22, parseInt(px, 10) || 16));
    document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
  }

  // Dev-only: ?playground=1 short-circuits the app and renders the ui/* gallery.
  // Stripped from production builds by import.meta.env.DEV at build time.
  let playgroundMode = $state(
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("playground") === "1"
  );
  let PlaygroundComponent = $state(null);

  let onboardingComplete = $state(null);
  let space = $state("page");
  let tone = $state("cream");
  let fontFamily = $state("lora");
  let fontSize = $state(16);
  let isEncrypted = $state(false);
  let isLocked = $state(false);

  // Inactivity timeout
  let lastActivity = Date.now();
  let lockTimeoutMin = 0;

  // For continuing a focus from memory
  let continueFocus = $state(null);

  // Platform detection + window controls
  let isMacOS = $state(false);
  let isTauri = $state(false);
  let isMobilePlatform = $state(false);
  let appWindow = null; // plain var — Svelte $state proxy breaks Tauri Window methods

  onMount(async () => {
    if (playgroundMode) {
      const mod = await import("./components/Playground.svelte");
      PlaygroundComponent = mod.default;
      return;
    }

    // VR harness: force the requested space/theme, skip onboarding+lock per the
    // scene, signal readiness, and return early so the normal boot path doesn't
    // clobber these (the seeded mock reports onboarding incomplete by default).
    if (typeof window !== "undefined" && window.__VR__) {
      space = window.__VR__.space;
      tone = window.__VR__.theme;
      applyTone(tone);
      applyFontFamily(fontFamily);
      applyFontSize(fontSize);
      onboardingComplete = !window.__VR__.onboarding;
      isLocked = false;
      await document.fonts?.ready;
      window.__VR_READY__ = true;
      return;
    }

    isMacOS = navigator.platform?.includes("Mac") || navigator.userAgent?.includes("Macintosh");

    // Hide the desktop custom titlebar on Android/iOS only — touch
    // laptops with mouse + touchscreen still want the window controls.
    // userAgent is the right signal here: pointer:coarse over-matches
    // (any device with a touchscreen reports coarse, even desktops).
    const ua = navigator.userAgent || "";
    isMobilePlatform = /Android|iPhone|iPad|iPod/i.test(ua);

    // Lazy-load Tauri window API
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      appWindow = getCurrentWindow();
      isTauri = true;
    } catch {
      isTauri = false;
    }

    try {
      const savedTone = await getSetting("canvas_tone");
      if (savedTone) {
        tone = savedTone;
      }
      applyTone(tone);
    } catch {}

    try {
      const savedFont = await getSetting("canvas_font_family");
      if (savedFont) fontFamily = savedFont;
      applyFontFamily(fontFamily);
      const savedSize = await getSetting("canvas_font_size");
      if (savedSize) fontSize = parseInt(savedSize, 10) || 16;
      applyFontSize(fontSize);
    } catch {}

    try {
      const savedUiScale = await getSetting("ui_scale");
      const parsed = savedUiScale ? parseFloat(savedUiScale) : NaN;
      if (Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2) {
        document.documentElement.style.setProperty("--ui-scale", String(parsed));
      }
    } catch {}

    // Listen for OS dark/light mode changes
    const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    darkModeQuery.addEventListener("change", () => {
      if (tone === "system") {
        applyTone("system");
      }
    });

    // Check encryption status
    try {
      isEncrypted = await checkEncryptionStatus();
      if (isEncrypted) isLocked = true;
    } catch {}

    // Load lock timeout setting
    try {
      const timeout = await getSetting("lock_timeout_minutes");
      if (timeout) lockTimeoutMin = parseInt(timeout, 10) || 0;
    } catch {}

    // Inactivity timer — check every 30s
    if (lockTimeoutMin > 0) {
      setInterval(() => {
        if (isEncrypted && !isLocked && lockTimeoutMin > 0) {
          if (Date.now() - lastActivity > lockTimeoutMin * 60000) {
            isLocked = true;
          }
        }
      }, 30000);
    }

    // Tray "new page" hook — creates page and forces reload
    window.__shizumu_new_page = async () => {
      const today = getLocalDateStr();
      const result = await createNewPage(today);
      continueFocus = result?.page || null;
      space = "page";
    };

    try {
      onboardingComplete = await checkOnboardingComplete();
    } catch {
      onboardingComplete = false;
    }
  });

  function handleMinimize() { appWindow?.minimize(); }
  function handleMaximize() { appWindow?.toggleMaximize(); }
  function handleClose() { appWindow?.close(); }
  function handleDrag(e) { if (e.button === 0 && appWindow) appWindow.startDragging(); }
  function handleDblClick() { appWindow?.toggleMaximize(); }
  // Frameless windows (decorations: false) get no resize border from the WM,
  // so we hand off to the compositor's interactive resize via Tauri. dir is a
  // ResizeDirection: North|NorthEast|East|SouthEast|South|SouthWest|West|NorthWest.
  function handleResize(e, dir) { if (e.button === 0 && appWindow) appWindow.startResizeDragging(dir); }

  function handleToneChange(newTone) {
    tone = newTone;
    applyTone(newTone);
  }

  function handleFontFamilyChange(family) {
    fontFamily = family;
    applyFontFamily(family);
  }

  function handleFontSizeChange(size) {
    fontSize = size;
    applyFontSize(size);
  }

  function handleOnboardingComplete() {
    onboardingComplete = true;
  }

  function handleDeleteAll() {
    onboardingComplete = false;
    space = "page";
    tone = "cream";
    applyTone("cream");
  }

  async function handleContinueFocus(focus) {
    // Navigate to PAGE with this focus loaded
    continueFocus = focus;
    space = "page";
  }

  function handleUnlock() {
    isLocked = false;
  }

  function resetActivity() {
    lastActivity = Date.now();
  }

  // Phone/tablet bottom bar + gesture gate — one predicate shared by the
  // bar mount, swipe enablement, and the navstack's bar-hide signal.
  let mobileNav = $state(isMobileNav());
  $effect(() => watchMobileNav((m) => { mobileNav = m; }));

  // Pin the shell to the visible viewport (see lib/viewport-height.js).
  // Its own effect rather than onMount: that hook returns early for
  // playground and VR mode, and every mount needs a correct shell height.
  $effect(() => syncAppHeight());

  // The navstack is the single owner of "what's open" — settings, memory,
  // bottom sheets all register entries there. App.svelte only needs to
  // read the snapshot to know depth/top/hideBar/has(tag).
  let navSnap = $state({ depth: 0, top: null, hideBar: false, has: () => false });
  $effect(() => {
    const teardown = initNavStack();
    const un = navSubscribe((s) => { navSnap = s; });
    return () => { un(); teardown(); };
  });

  // Memory space is a nav entry: hardware back / back swipe from memory
  // returns to the page, matching user expectation on Android.
  let memoryNavId = null;
  $effect(() => {
    if (space === "memory" && memoryNavId === null) {
      memoryNavId = navPush("memory", () => {
        memoryNavId = null;
        continueFocus = null;
        space = "page";
      });
    } else if (space !== "memory" && memoryNavId !== null) {
      const id = memoryNavId;
      memoryNavId = null;
      navClose(id);
    }
  });

  let swipeProgress = $state(/** @type {{ edge: "left"|"right", dragPx: number, threshold: number } | null} */ (null));

  // Settings open state now comes from the navstack (Page pushes a
  // "settings" entry) — the shizumu:settings-state window-event round
  // trip is gone. The body class stays: global.css uses it to pad the
  // settings modal above the pinned MobileActionBar on phone, now simply
  // driven by the navstack snapshot instead of the event mirror.
  let settingsOpen = $derived(navSnap.has("settings"));
  $effect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("shizumu-settings-open", settingsOpen);
    return () => document.body.classList.remove("shizumu-settings-open");
  });

  function handleSwipeProgress(info) {
    swipeProgress = info.dragPx > 0 ? info : null;
  }

  // Horizontal edge swipes are page navigation — the touch equivalent of
  // the desktop Ctrl/Cmd+Left and Ctrl/Cmd+Right shortcuts, which run
  // Page.svelte's navigatePrev / navigateNext. The rule for which gesture
  // means what lives in lib/swipe-intent.js so it can be tested without a
  // pointer; back still wins the left edge whenever something is open.
  function runSwipeIntent(edge) {
    const intent = swipeIntent({ edge, space, navDepth: navSnap.depth });
    if (intent === "back") navBack();
    else if (intent === "prev") window.dispatchEvent(new CustomEvent("shizumu:nav-prev"));
    else if (intent === "next") window.dispatchEvent(new CustomEvent("shizumu:nav-next"));
  }

  function swipeEnabled() {
    return mobileNav && !isLocked && !!onboardingComplete;
  }

  function barPages() {
    if (space !== "page") {
      space = "page";
      return;
    }
    // Already on the writing surface: open the page browser sheet.
    window.dispatchEvent(new CustomEvent("shizumu:open-pages"));
  }
  function barMemory() {
    if (space !== "memory") space = "memory";
  }
  function barSettings() {
    if (space !== "page") space = "page";
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("shizumu:toggle-settings"));
    });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:window onmousemove={resetActivity} onkeydown={resetActivity} onclick={resetActivity} />

<main class="app-shell">
  <!-- Resize grips — desktop Tauri only. The window is frameless
       (decorations: false), so the WM gives no resize border; these invisible
       edge/corner strips hand off to the compositor's interactive resize. -->
  {#if isTauri && !isMobilePlatform}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-grip rg-n"  onmousedown={(e) => handleResize(e, "North")}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-grip rg-s"  onmousedown={(e) => handleResize(e, "South")}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-grip rg-w"  onmousedown={(e) => handleResize(e, "West")}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-grip rg-e"  onmousedown={(e) => handleResize(e, "East")}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-grip rg-nw" onmousedown={(e) => handleResize(e, "NorthWest")}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-grip rg-ne" onmousedown={(e) => handleResize(e, "NorthEast")}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-grip rg-sw" onmousedown={(e) => handleResize(e, "SouthWest")}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-grip rg-se" onmousedown={(e) => handleResize(e, "SouthEast")}></div>
  {/if}
  <!-- Custom title bar — desktop only. Hidden on Android/iOS where the
       OS owns the chrome and there's no draggable/resizable window, and
       also hidden on web/PWA phone widths (mobileNav) — the ~56px strip
       is dead weight once the bottom action bar owns navigation there. -->
  {#if !isMobilePlatform && !mobileNav}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="titlebar" class:macos={isMacOS} onmousedown={handleDrag} ondblclick={handleDblClick}>
      <span class="titlebar-title">shizumu</span>
      {#if isTauri && !isMacOS}
        <div class="titlebar-controls">
          <button class="tb-btn" onmousedown={(e) => e.stopPropagation()} onclick={handleMinimize} aria-label="minimize">—</button>
          <button class="tb-btn" onmousedown={(e) => e.stopPropagation()} onclick={handleMaximize} aria-label="maximize">□</button>
          <button class="tb-btn tb-close" onmousedown={(e) => e.stopPropagation()} onclick={handleClose} aria-label="close">×</button>
        </div>
      {/if}
    </div>
  {/if}

  <div
    class="canvas"
    use:edgeSwipe={{
      enabled: (edge) => {
        if (!swipeEnabled()) return false;
        // Same rule that decides what the gesture does, so a swipe is never
        // armed for an action that would then be a no-op.
        return swipeIntent({ edge, space, navDepth: navSnap.depth }) !== null;
      },
      // edgeSwipe's callbacks are named for the drag DIRECTION, not the
      // edge: onRight fires for a LEFT-edge drag pulled rightward.
      onRight: () => runSwipeIntent("left"),
      onLeft: () => runSwipeIntent("right"),
      onProgress: handleSwipeProgress,
    }}
  >
  {#if swipeProgress && swipeProgress.dragPx > 0}
    <div
      class="swipe-peek"
      class:left={swipeProgress.edge === "left"}
      class:right={swipeProgress.edge === "right"}
      style:--peek-progress={Math.min(1, swipeProgress.dragPx / swipeProgress.threshold)}
      style:--peek-width={Math.min(swipeProgress.dragPx, swipeProgress.threshold) >= swipeProgress.threshold ? "6px" : "4px"}
      aria-hidden="true"
    ></div>
  {/if}
  {#if playgroundMode}
    {#if PlaygroundComponent}
      {@const PG = PlaygroundComponent}
      <PG />
    {/if}
  {:else if onboardingComplete === null}
    <!-- Loading -->
  {:else if !onboardingComplete}
    <Onboarding onComplete={handleOnboardingComplete} />
  {:else if isLocked}
    <LockScreen onUnlock={handleUnlock} />
  {:else if space === "page"}
    <Page
      onNavigateMemory={() => space = "memory"}
      currentTone={tone}
      onToneChange={handleToneChange}
      currentFontFamily={fontFamily}
      onFontFamilyChange={handleFontFamilyChange}
      currentFontSize={fontSize}
      onFontSizeChange={handleFontSizeChange}
      onDeleteAll={handleDeleteAll}
      {continueFocus}
    />
  {:else if space === "memory"}
    <Memory
      onNavigatePage={() => {
        // "back to the page" should land on today's writing surface, not
        // the old page the user opened via continueFocus earlier. Clear
        // the focus before unmounting Memory so Page's onMount falls
        // through to loadToday instead of replaying the past focus.
        continueFocus = null;
        space = "page";
      }}
      onContinueFocus={handleContinueFocus}
    />
  {/if}
  </div>

  {#if mobileNav && !isLocked && onboardingComplete}
    <MobileActionBar
      hidden={navSnap.hideBar}
      onPages={barPages}
      onMemory={barMemory}
      onSettings={barSettings}
      pagesActive={space === "page" && !settingsOpen}
      memoryActive={space === "memory" && !settingsOpen}
      settingsActive={settingsOpen}
    />
  {/if}
</main>

<style>
  .app-shell {
    width: 100%;
    /* --app-height is visualViewport.height, kept current by
       lib/viewport-height.js. The dvh/vh pair below it is the pre-script
       fallback (and covers the first paint).

       Why not dvh alone: dvh resolves against the LAYOUT viewport, and
       whether the soft keyboard shrinks that depends on the viewport
       meta's interactive-widget mode and, on Android, on a
       windowSoftInputMode we can't set — the manifest lives in the
       generated gen/ tree CI rebuilds. When it doesn't shrink, the shell
       stays taller than the screen and focusing the bottom bar scrolls the
       header and the whole page off the top. visualViewport.height means
       "what's visible" in every mode. */
    height: 100vh;
    height: 100dvh;
    height: var(--app-height, 100dvh);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--margin-bg);
    color: var(--ink);
    /* System-bar insets. On desktop the 32px custom titlebar reserves the
       top; on mobile that titlebar is hidden, so the shell must reserve the
       status-bar inset itself — otherwise content tucks under the Android /
       iOS status bar. env() is correct on iOS and edge-to-edge Android; the
       coarse-pointer floor below covers older Android WebViews that report 0
       for the insets so content never collides with the system bars. */
    padding-top: var(--safe-top);
    padding-bottom: var(--safe-bottom);
  }

  /* No coarse-pointer floor. The floors existed because Android drew
     edge-to-edge while nothing bridged its window insets into
     env(safe-area-inset-*), so --safe-top read 0 and content collided with
     the status bar; 24px was a guess at a bar height.

     The app no longer draws edge-to-edge (scripts/patch-android-insets.py),
     so Android insets the WebView itself using the real height for the
     device. Inside that viewport there is no unsafe area, --safe-top is
     legitimately 0, and a floor would be pure padding stacked on top of the
     inset the system already applied — the wasted space at the top of the
     screen, which was reported in the same breath as the collision.

     iOS is unaffected: it still reports real insets through env(), which
     the `padding-top: var(--safe-top)` above consumes. */

  .canvas {
    flex: 1;
    min-height: 0;
    display: flex;
    justify-content: center;
    overflow: hidden;
    background-color: var(--margin-bg);
    color: var(--ink);
  }
  /* On touch, reserve horizontal gestures for the edge-swipe action: with the
     default touch-action the WebView claims the horizontal pan as a scroll and
     cancels the pointer stream, so the swipe never commits. pan-y keeps
     vertical scrolling. */
  @media (pointer: coarse) {
    .canvas { touch-action: pan-y; }
  }

  /* Frameless-window resize grips — invisible strips at the window edges and
     corners. Corners sit above edges so corner-resize wins in their zone. The
     window's minWidth/minHeight (tauri.conf.json) still clamp the smallest size. */
  .resize-grip { position: fixed; z-index: 2000; }
  .rg-n { top: 0; left: 0; right: 0; height: 6px; cursor: ns-resize; }
  .rg-s { bottom: 0; left: 0; right: 0; height: 6px; cursor: ns-resize; }
  .rg-w { top: 0; bottom: 0; left: 0; width: 6px; cursor: ew-resize; }
  .rg-e { top: 0; bottom: 0; right: 0; width: 6px; cursor: ew-resize; }
  .rg-nw, .rg-ne, .rg-sw, .rg-se { width: 14px; height: 14px; z-index: 2001; }
  .rg-nw { top: 0; left: 0; cursor: nwse-resize; }
  .rg-ne { top: 0; right: 0; cursor: nesw-resize; }
  .rg-sw { bottom: 0; left: 0; cursor: nesw-resize; }
  .rg-se { bottom: 0; right: 0; cursor: nwse-resize; }
  /* At phone width the window is in mobile form: the left/right edges belong to
     the edge-swipe page gesture, not window resizing. Drop the grips so they
     don't sit on top of the swipe zone and eat the touch. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .resize-grip { display: none; }
  }

  /* Custom title bar */
  .titlebar {
    height: 32px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--margin-bg);
    border-bottom: 1px solid color-mix(in srgb, var(--horizon) 40%, transparent);
    position: relative;
    user-select: none;
    -webkit-user-select: none;
  }

  .titlebar.macos {
    padding-left: 72px;
  }

  .titlebar-title {
    font-family: "Inter", sans-serif;
    font-weight: 400;
    font-size: 12px;
    letter-spacing: -0.01em;
    color: var(--ink);
    opacity: 0.35;
    pointer-events: none;
  }

  .titlebar-controls {
    position: absolute;
    right: 0;
    top: 0;
    height: 100%;
    display: flex;
    align-items: stretch;
    -webkit-app-region: no-drag;
  }

  .tb-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-family: "Inter", sans-serif;
    font-size: 13px;
    color: var(--ink);
    opacity: 0.4;
    padding: 0 14px;
    transition: opacity 150ms ease, background 150ms ease;
    -webkit-app-region: no-drag;
  }

  .tb-btn:hover {
    opacity: 0.8;
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }

  .tb-close:hover {
    opacity: 1;
    color: var(--warm-accent);
    background: var(--warm-accent-soft, rgba(196,77,40,0.08));
  }

  .swipe-peek {
    position: fixed;
    top: 0;
    bottom: 0;
    width: var(--peek-width, 4px);
    background: var(--warm-accent);
    opacity: var(--peek-progress, 0);
    pointer-events: none;
    z-index: 100;
    transition: opacity var(--motion-fast), width var(--motion-fast);
  }
  .swipe-peek.left { left: 0; }
  .swipe-peek.right { right: 0; }
</style>
