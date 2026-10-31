<script>
  import { onMount } from "svelte";
  import "./styles/vr.css";
  import Page from "./components/Page.svelte";
  import Memory from "./components/Memory.svelte";
  import Onboarding from "./components/Onboarding.svelte";
  import LockScreen from "./components/LockScreen.svelte";
  import { checkOnboardingComplete, getSetting, checkEncryptionStatus, createNewPage, syncFlushNow, lockApp, getStartupFailure } from "./lib/api.js";
  import { shouldAutoLock, LOCK_SETTINGS_EVENT } from "./lib/auto-lock.js";
  import { startupScreen } from "./lib/startup-gate.js";
  import StartupFailure from "./components/StartupFailure.svelte";
  import { installSyncFlushOnHide } from "./lib/sync-flush-on-hide.js";
  import { getLocalDateStr } from "./lib/utils.js";
  import MobileActionBar from "./components/MobileActionBar.svelte";
  import {
    isMobileNav,
    watchMobileNav,
    watchKeyboardOpen,
    isCoarsePointer,
    watchCoarsePointer,
  } from "./lib/responsive.js";
  import { shouldBootShell } from "./shell/shell-boot.js";
  import { isLinuxAppHost, windowMinSizeFor, minSizeCall, resizeGripsShown } from "./lib/linux-phone-window.js";
  import { syncAppHeight } from "./lib/viewport-height.js";
  import { startSafeArea } from "./lib/safe-area.js";
  import { edgeSwipe } from "./lib/gestures.js";
  import { swipeIntent } from "./lib/swipe-intent.js";
  import { initNavStack, navPush, navClose, navPopAll, navBack, subscribe as navSubscribe } from "./lib/navstack.js";
  import { get } from "svelte/store";
  import { keyboardOpen, isTextFieldElement } from "./lib/keyboard-state.js";
  import { atLastPage } from "./lib/page-rail-state.js";
  import { barVisible } from "./lib/bar-visibility.js";

  function resolveSystemTone() {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "cream";
  }

  function applyTone(toneValue) {
    const effective = toneValue === "system" ? resolveSystemTone() : toneValue;
    document.documentElement.setAttribute("data-tone", effective);
    // The browser and Android status-bar colour follow the canvas, so a
    // dark page does not sit under a light bar.
    try {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--canvas-bg").trim();
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
      }
      if (bg) meta.content = bg;
    } catch {}
  }

  function applyFontFamily(family) {
    document.documentElement.setAttribute("data-font-family", family);
  }

  function applyFontSize(px) {
    const size = Math.max(10, Math.min(22, parseInt(px, 10) || 16));
    document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
  }

  // Dev-only: ?playground=1 short-circuits the app and renders the ui/* gallery.
  // ?playground=shell renders the shell's own catalogue (src/shell/Gallery.svelte)
  // instead. Stripped from production builds by import.meta.env.DEV at build time.
  const playgroundParam =
    import.meta.env.DEV && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("playground")
      : null;
  let playgroundMode = $state(playgroundParam === "1");
  let playgroundShellMode = $state(playgroundParam === "shell");
  let PlaygroundComponent = $state(null);

  // The shell gallery scene (space === "shell-gallery"), lazily imported so
  // it never enters the desktop bundle — same pattern as PlaygroundComponent
  // above.
  let ShellGalleryComponent = $state(null);

  let onboardingComplete = $state(null);
  let space = $state("page");
  let tone = $state("cream");
  let fontFamily = $state("lora");
  let fontSize = $state(16);
  let isEncrypted = $state(false);
  let isLocked = $state(false);
  // The launch could not open the writer's file (startup-gate.js). Asked
  // before anything else reads the database, which is a placeholder then.
  let startupFailure = $state(null);
  let startupGate = $derived(startupScreen(startupFailure));

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

    if (playgroundShellMode) {
      // Reuse the space === "shell-gallery" route below rather than a
      // second markup branch: the $effect that lazily loads
      // ShellGalleryComponent watches `space`, not how it got set.
      space = "shell-gallery";
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
      // __VR_READY__ means "the app has decided what it renders", and the
      // try-the-new-shell read decides between two whole trees — so a
      // capture released before it settles could photograph the desktop
      // tree for a shell scene. No scene sets the flag yet (P2a Task 6 adds
      // the first), so this is a precaution, not a fix for an observed
      // failure: the race it forecloses cannot be reproduced from here
      // today. Always resolves — its catch swallows.
      await shellFlagRead;
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

    try { startupFailure = await getStartupFailure(); } catch {}

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

    // Settings announces a lock turned on or off and a new timeout, so the
    // timer below follows them without a restart (src/lib/auto-lock.js).
    window.addEventListener(LOCK_SETTINGS_EVENT, (e) => {
      const d = e.detail ?? {};
      if (typeof d.encrypted === "boolean") isEncrypted = d.encrypted;
      if (typeof d.timeoutMin === "number") lockTimeoutMin = d.timeoutMin;
      lastActivity = Date.now();
    });

    // Inactivity timer — check every 30s. Always running, because the
    // timeout can be set after launch.
    setInterval(() => {
      if (shouldAutoLock({ encrypted: isEncrypted, locked: isLocked, timeoutMin: lockTimeoutMin, idleMs: Date.now() - lastActivity })) {
        isLocked = true;
        // The screen alone is a curtain: close the database behind it
        // too, so nothing else reads the pages until unlock (commands.rs).
        lockApp().catch((err) => console.error("lock: could not close the database", err));
      }
    }, 30000);

    // Tray "new page" hook — creates page and forces reload
    window.__shizumu_new_page = async () => {
      const today = getLocalDateStr();
      const result = await createNewPage(today);
      continueFocus = result?.page || null;
      space = "page";
    };

    // Flush pending sync uploads before the OS suspends the process — see
    // lib/sync-flush-on-hide.js for why this is two events, not one, and
    // why both are fire-and-forget.
    installSyncFlushOnHide({ syncFlushNow });

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

  // Lazily loads the shell gallery (src/shell/Gallery.svelte) the first
  // time space becomes "shell-gallery" — reached either via the VR scene
  // registry (onMount's window.__VR__ branch, untouched by this) or the
  // ?playground=shell dev route above. An effect rather than inside
  // onMount so neither of those two branches needs to know this import
  // exists; mirrors the PlaygroundComponent pattern but reacts to state
  // instead of running once at mount.
  $effect(() => {
    if (space === "shell-gallery" && !ShellGalleryComponent) {
      import("./shell/Gallery.svelte").then((mod) => {
        ShellGalleryComponent = mod.default;
      });
    }
  });

  // Phone/tablet bottom bar + gesture gate — one predicate shared by the
  // bar mount, swipe enablement, and the navstack's bar-hide signal.
  let mobileNav = $state(isMobileNav());
  $effect(() => watchMobileNav((m) => { mobileNav = m; }));

  // Input modality, read and watched on its own for the shell gate below.
  //
  // NOT redundant with `mobileNav`, which already consults the same query:
  // `watchMobileNav` only fires when the COMBINED answer flips, and the
  // combination swallows this one whole on a phone-shaped viewport —
  // `isPhoneViewport() || ...` is already true there, so a pointer going
  // coarse→fine leaves `mobileNav` at true and fires nothing. That is
  // precisely the transition the gate has to see: a tablet or a
  // convertible whose keyboard is docked mid-session changes tree, and
  // without a watcher of its own it would keep the tree it booted with
  // until the next launch.
  let coarsePointer = $state(isCoarsePointer());
  $effect(() => watchCoarsePointer((c) => { coarsePointer = c; }));

  // The phone shell renders in place of the desktop tree (spec §7). Since
  // P5 that is the DEFAULT, not an opt-in: an unwritten `try_new_shell`
  // now boots the shell on a phone-shaped, touch-driven viewport, and the
  // key's only remaining job is the escape hatch — "false" opts a tester
  // back out. shell/shell-boot.js owns the decision and enumerates all
  // four flag states; why "false" survives, why a desktop viewport refuses
  // regardless, and why the POINTER is asked as well as the size (a short
  // desktop window matches the landscape-phone clause) are written there.
  //
  // The read starts here rather than inside onMount's settings block
  // (:129-152) because that hook returns early for both playground routes
  // AND for the VR harness, which serves a production build — a read placed
  // after those returns would leave this fork unreachable to every scene,
  // and P2a's whole point is that the shell ships behind it.
  //
  // `undefined` IS THE LOAD-BEARING INITIAL VALUE, and it is not `null`.
  // A rejected read leaves it here, and shell-boot reads undefined as off
  // while reading null as on — so a cold or migrating database keeps the
  // desktop tree, which is the tree a tester who opted out needs to reach
  // when their database is the thing that broke. Initialising this to null
  // would boot the shell for the tick before the read answers, on phones
  // whose stored answer is "false". shell-boot.test.js asserts this line
  // as text.
  let shellFlag = $state(undefined);
  const shellFlagRead = getSetting("try_new_shell")
    .then((value) => { shellFlag = value; })
    .catch(() => {});
  let bootShell = $derived(shouldBootShell({ setting: shellFlag, mobileNav, coarsePointer }));

  // A Linux phone's window (src/lib/linux-phone-window.js): while the shell
  // is booted the desktop floor from tauri.conf.json is cleared, so Phosh's
  // on-screen keyboard can resize the window instead of covering its lower
  // part. A desktop Linux window starts with the floor and makes no call.
  // Plain var, not $state: it records what the window has, and reading it
  // must not re-run the effect that writes it.
  let appliedMinSize = "desktop";
  $effect(() => {
    const wanted = windowMinSizeFor({
      linuxHost: isLinuxAppHost({ userAgent: navigator.userAgent, isTauri }),
      bootShell,
    });
    const call = minSizeCall({ applied: appliedMinSize, wanted });
    if (!call || !appWindow) return;
    appliedMinSize = wanted;
    const win = appWindow;
    import("@tauri-apps/api/dpi")
      .then(({ LogicalSize }) =>
        win.setMinSize(call.size ? new LogicalSize(call.size.width, call.size.height) : null))
      .catch(() => {});
  });
  let showResizeGrips = $derived(resizeGripsShown({ isTauri, isMobilePlatform, bootShell }));

  // Lazily imported, so the shell never enters the desktop bundle — same
  // shape as ShellGalleryComponent above.
  let ShellAppComponent = $state(null);
  $effect(() => {
    if (bootShell && !ShellAppComponent) {
      import("./shell/ShellApp.svelte").then((mod) => {
        ShellAppComponent = mod.default;
      });
    }
  });

  // The shell's two chromeless gates — onboarding and lock (spec §2), one
  // component, `kind` chooses. Lazily imported for the same reason and by
  // the same shape as the shell itself.
  //
  // ITS BRANCHES ARE INSIDE THE EXISTING ONES, never beside them. The chain
  // below runs onboarding → lock → the boot fork, and the fork's place under
  // both gates is the correctness requirement P2a corrected a plan for. A
  // third top-level branch for the shell's gates would be that same edit
  // wearing a different name: whichever of it and `isLocked` came first
  // would decide, and one of the two orderings renders a shell surface over
  // a locked database. So the chain keeps deciding WHETHER a gate applies
  // and `bootShell` only decides what the gate looks like.
  let ShellGateComponent = $state(null);
  $effect(() => {
    if (bootShell && !ShellGateComponent) {
      import("./shell/ShellGate.svelte").then((mod) => {
        ShellGateComponent = mod.default;
      });
    }
  });

  // MobileActionBar visibility (see lib/bar-visibility.js) needs the live
  // keyboard state alongside navSnap.hideBar — same watchKeyboardOpen
  // wrapper Page.svelte already uses for its own keyboard-coupled state.
  let kbOpen = $state(false);
  $effect(() => watchKeyboardOpen((open) => { kbOpen = open; }));

  /** IS THE WRITER IN THE TEXT — a focus fact, read from the DOM.
   *
   *  Beside the keyboard store above because it answers the question that
   *  one used to be asked for and is bad at. The shell's editing strip used
   *  to key on `kbOpen`, so dismissing the keyboard took every editing
   *  control with it; and the canvas gesture table used to ask it whether a
   *  flick was mid-keystroke, which a phone with a frozen viewport could
   *  answer wrongly for a whole session.
   *
   *  `focusin` / `focusout` rather than the keyboard module, because this
   *  is not keyboard state: that module's argument is one owner per
   *  question, and this is a different question. isTextFieldElement is
   *  shared so the definition of "a field" does not fork.
   *
   *  On `focusout` the browser has already moved activeElement to BODY, so
   *  relatedTarget — where focus is GOING — is read first: a tap from one
   *  field to the next is not a pause in writing. */
  let editing = $state(false);
  $effect(() => {
    if (typeof window === "undefined") return;
    // READ NOW, WRITE AFTER THE RENDER. The answer is computed synchronously,
    // because `relatedTarget` and `activeElement` are only true during the
    // event; the state write is deferred to a microtask, because the event
    // itself can arrive in the middle of one.
    //
    // THE DEFECT, caught by the device harness as an uncaught
    // `state_unsafe_mutation` two or three times per run, on every sheet that
    // opened: removing a focused element from the DOM dispatches `focusout`
    // SYNCHRONOUSLY, and Svelte 5 refuses a state write made while it is
    // rendering or evaluating a derived. A sheet opening takes the editor's
    // focus away, mid-render, and this line wrote `editing` from inside that
    // render. Same family as the crash that once left an empty document
    // behind a working onboarding gate — survivable here only because it
    // lands after mount.
    //
    // A microtask runs after the whole synchronous flush and before the next
    // paint, so nothing a writer can see moves: the focusout-to-focusin race
    // this reader exists for is settled by capturing `relatedTarget` above,
    // not by the timing of the write.
    const read = (event) => {
      const incoming = event?.type === "focusout" ? event.relatedTarget : null;
      const next = isTextFieldElement(incoming) || isTextFieldElement(document.activeElement);
      queueMicrotask(() => { editing = next; });
    };
    read();
    window.addEventListener("focusin", read);
    window.addEventListener("focusout", read);
    return () => {
      window.removeEventListener("focusin", read);
      window.removeEventListener("focusout", read);
    };
  });

  // Pin the desktop tree to the visible viewport (see lib/viewport-height.js).
  // Its own effect rather than onMount: that hook returns early for
  // playground and VR mode, and every mount needs a correct shell height.
  //
  // NOT on the shell path, where ShellRoot owns it — "the root starts it
  // once for the whole shell so no screen is ever tempted to", as its test
  // puts it. Both ran until 2026-10-04, and two subscriptions meant two
  // baselines, each with its own idea of how tall the window was before the
  // keyboard, both writing --kb-inset and the keyboardOpen store. The
  // latched bottom bar on a Galaxy A34 is what that cost. keyboard-state.js
  // now shares one subscription between callers, so this is no longer a
  // correctness fix — it is saying which component owns the thing, because
  // "both of them" was never anyone's intent.
  $effect(() => {
    if (bootShell) return;
    return syncAppHeight();
  });

  // WHERE THE SYSTEM BARS ARE, on both trees and whatever the boot fork
  // decides. Unlike the viewport owner above there is nothing to share and
  // nothing to race: the activity publishes, this applies, and on a platform
  // that publishes nothing (iOS, desktop, the browser demo) it never fires
  // and global.css's env() values keep answering. See lib/safe-area.js for
  // why CSS cannot answer this on Android.
  $effect(() => startSafeArea());

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
  // atLastPage/keyboardOpen are read fresh at gesture time (not tracked as
  // local reactive state) since nothing here needs to re-render on them —
  // Page.svelte and keyboard-state.js are the owners.
  function currentSwipeIntent(edge) {
    return swipeIntent({ edge, space, navDepth: navSnap.depth, atLastPage: get(atLastPage), keyboardOpen: get(keyboardOpen) });
  }

  function runSwipeIntent(edge) {
    const intent = currentSwipeIntent(edge);
    if (intent === "back") navBack();
    else if (intent === "prev") window.dispatchEvent(new CustomEvent("shizumu:nav-prev"));
    else if (intent === "next") window.dispatchEvent(new CustomEvent("shizumu:nav-next"));
    // On the last page a right swipe means "give me a fresh page", same as
    // the pages sheet's "+ new page" — routed through the identical
    // handler in Page.svelte (handleRailNew), no second creation path.
    else if (intent === "create") window.dispatchEvent(new CustomEvent("shizumu:nav-create"));
  }

  function swipeEnabled() {
    // !bootShell for the same reason MobileActionBar carries it: these are
    // the desktop tree's page-navigation gestures, and .swipe-peek — the
    // strip they paint mid-drag — lives inside .canvas, which is where the
    // shell renders. An edge drag on a shell surface would draw desktop
    // chrome over it and dispatch shizumu:nav-* events nothing there hears.
    // The shell routes its own gestures (gesture-owner.js).
    return mobileNav && !isLocked && !!onboardingComplete && !bootShell;
  }

  // Every top-level bar tap sweeps stale hideBar entries first — a sheet
  // left open under the surface being switched away from (or, for
  // settings, nested under settings itself) closes through its own
  // onClose so its owner unwinds cleanly, and can never survive as an
  // orphan hideBar entry that latches the bar hidden (the bug this whole
  // module exists to close off). Unconditional on all three: there is no
  // "sheet legitimately survives a bar tap" case.
  // Switching top-level surfaces must not carry a focused field with it.
  // Memory's search box keeps focus when the user taps another tab, and
  // Android leaves the IME up for a field that is no longer on screen — so
  // opening settings from memory arrived with the keyboard already open,
  // covering half the pane. Blurring on the way out closes it, and costs
  // nothing on desktop where no IME is involved.
  function dropFocus() {
    const el = typeof document !== "undefined" ? document.activeElement : null;
    if (el && typeof el.blur === "function") el.blur();
  }
  function barPages() {
    dropFocus();
    navPopAll((e) => e.hideBar);
    if (space !== "page") {
      space = "page";
      return;
    }
    // Already on the writing surface: open the page browser sheet.
    window.dispatchEvent(new CustomEvent("shizumu:open-pages"));
  }
  function barMemory() {
    dropFocus();
    navPopAll((e) => e.hideBar);
    if (space !== "memory") space = "memory";
  }
  function barSettings() {
    dropFocus();
    navPopAll((e) => e.hideBar);
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
  {#if showResizeGrips}
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
        return currentSwipeIntent(edge) !== null;
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
  {:else if space === "shell-gallery"}
    {#if ShellGalleryComponent}
      {@const G = ShellGalleryComponent}
      <G sheetOpen={window.__VR__?.sheetOpen === true} />
    {/if}
  {:else if startupGate === "failed"}
    <StartupFailure failure={startupFailure} />
  {:else if startupGate === "locked"}
    <!-- The file opens with the passphrase; reloading then reads it from the
         start, as a launch that had found the key would have. The desktop
         lock screen on every tree: the shell's lock gate stays inside the
         isLocked branch only, which shell-boot.test.js holds as text. -->
    <LockScreen onUnlock={() => location.reload()} />
  {:else if onboardingComplete === null}
    <!-- Loading -->
  {:else if !onboardingComplete}
    {#if bootShell}
      <!-- The shell's own onboarding, inside the branch that already
           decided a new user has to see one. Nothing renders while the
           lazy import is in flight — the same shape the shell branch below
           takes, and for the same reason: showing the desktop slides for a
           frame and swapping them out is a flash of a surface this tester
           opted out of.

           WHO ACTUALLY SEES IT CHANGED AT P5, and this note said the
           opposite until the default flipped: it read "`bootShell` needs
           `try_new_shell` already written, and a genuinely new install has
           never written it — so a first launch onboards on the desktop
           slides", reached only "by a tester who turned the flag on and
           then cleared their data". An unwritten key now boots the shell,
           so this IS the first-launch path on a phone, and the desktop
           slides below are what a tester sees only after opting out with
           "false". The old note is quoted rather than dropped because the
           VR scene for this gate (scenes.js, `shell-onboarding`) still
           reproduces the cleared-data route deliberately, and a reader
           comparing the two needs to know which one moved. -->
      {#if ShellGateComponent}
        {@const G = ShellGateComponent}
        <G kind="onboarding" keyboardOpen={kbOpen} onComplete={handleOnboardingComplete} />
      {/if}
    {:else}
      <Onboarding onComplete={handleOnboardingComplete} />
    {/if}
  {:else if isLocked}
    {#if bootShell}
      <!-- Still the LOCK branch. The shell decides what a locked phone
           looks like; it does not decide whether the phone is locked. -->
      {#if ShellGateComponent}
        {@const G = ShellGateComponent}
        <G kind="lock" keyboardOpen={kbOpen} onUnlock={handleUnlock} />
      {/if}
    {:else}
      <LockScreen onUnlock={handleUnlock} />
    {/if}
  {:else if bootShell}
    <!-- try the new shell (spec §7). This branch sits BELOW onboarding and
         BELOW isLocked on purpose, and the position is a correctness
         requirement rather than a style choice: the chain runs
         onboarding → lock → spaces, so a fork placed above the lock branch
         renders the shell instead of LockScreen on a locked database — a
         lock bypass reachable by flipping one setting. The next fork added
         here goes below both gates too. shell-boot.test.js asserts this
         order against this file's text, since nothing at the branch itself
         can show it. -->
    {#if ShellAppComponent}
      {@const S = ShellAppComponent}
      <!-- Tone and font travel the same way they travel to Page/Settings,
           and for the same reason: applyTone and applyFontFamily above are
           the ONE owner of `data-tone` and `data-font-family`, and this
           component also holds the matchMedia listener that re-applies a
           `system` tone when the OS theme changes. A shell writing either
           attribute itself would be a second owner, and would leave that
           listener re-applying a `tone` it no longer knows. The shell
           persists the settings; this file applies them. -->
      <S
        keyboardOpen={kbOpen}
        {editing}
        {tone}
        onTone={handleToneChange}
        {fontFamily}
        onFontFamily={handleFontFamilyChange}
      />
    {/if}
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

  {#if mobileNav && !isLocked && onboardingComplete && space !== "shell-gallery" && !bootShell}
    <!-- The shell owns its own bottom slot, so this bar must not paint over
         it: the bar is a sibling of the {#if} chain, not part of it, and
         without !bootShell it would draw a second bottom bar across the
         shell's own tab bar. That holds for the booted shell exactly as it
         does for the gallery.

         THIS CONDITION IS STILL REACHABLE, and the note here used to say
         otherwise ("MobileActionBar is exactly the desktop phone chrome P5
         deletes"). P5 kept the escape hatch, so `bootShell` is not
         equivalent to `mobileNav` and `mobileNav && !bootShell` is not
         identically false — it is precisely the tester who set
         `try_new_shell` to "false". The bar is what gives that tester a
         route to settings at phone width, since Page.svelte:1451 withholds
         the ⚙ button when `isPhone`. It is load-bearing, not leftovers.

         IT IS NOT A ROUTE BACK INTO THE SHELL, and this note claimed it
         was ("and therefore the only route back to turning the shell on")
         while no tree had a switch at all. The switch that exists lives in
         the SHELL's labs section (src/shell/shell-switch.js), so the
         settings this bar reaches cannot undo an opt-out: turning the
         shell off is one-way until a control lands on Settings.svelte,
         which the two-trees rule keeps off the shell branch. The P5 plan
         carries that as a precondition of the switch-over. -->
    <MobileActionBar
      hidden={!barVisible({ hideBarNav: navSnap.hideBar, keyboardOpen: kbOpen })}
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
    /* --app-height is the visible-viewport height, kept current by
       lib/keyboard-state.js (re-exported under its original name by
       lib/viewport-height.js). The dvh/vh pair below it is the pre-script
       fallback (and covers the first paint).

       Why not dvh alone: dvh resolves against the LAYOUT viewport, and
       whether the soft keyboard shrinks that depends on the viewport
       meta's interactive-widget mode and, on Android, on a
       windowSoftInputMode we can't set — the manifest lives in the
       generated gen/ tree CI rebuilds. When it doesn't shrink, the shell
       stays taller than the screen and focusing the bottom bar scrolls the
       header and the whole page off the top. The visible viewport's height
       means "what's visible" in every mode. */
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

     That claim was that the app no longer draws edge-to-edge
     (scripts/patch-android-insets.py removes the call), so Android insets
     the WebView itself and --safe-top is legitimately 0 inside it. It held
     until targetSdk reached 35: Android 15 ENFORCES edge-to-edge for apps
     targeting 35 and above and this one targets 36, so the call is gone and
     the behaviour is back. --safe-bottom read 0 on an A16 and the shell's
     bottom row shared a strip with Android's navigation buttons.

     The floors still do not come back, because a floor is a guess at a bar
     height and the right number is now measured: the activity reports the
     system bar insets (scripts/patch-android-keyboard.py) and
     src/lib/safe-area.js writes them into --safe-*, over the env() values
     below. A device that reports nothing changes nothing and env() keeps
     answering — which is what iOS needs, where env() is correct and none of
     that machinery runs. Either way `padding-top: var(--safe-top)` above is
     the one consumer. */

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
    font-family: var(--font-ui);
    font-weight: 400;
    font-size: 12px;
    letter-spacing: -0.01em;
    color: var(--ink-soft);
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
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--ink-soft);
    padding: 0 14px;
    transition: color 150ms ease, background 150ms ease;
    -webkit-app-region: no-drag;
  }

  /* Hover goes darker, never paler (it faded to 3.8:1). */
  .tb-btn:hover {
    color: var(--ink);
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }

  .tb-close:hover {
    opacity: 1;
    color: var(--accent-text);
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
