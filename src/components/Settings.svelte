<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { setSetting, getSetting, setCloseToTray, deleteAllData, checkEncryptionStatus, exportPagesGui, backupDatabaseGui, sendNotification, setLockTimeout } from "../lib/api.js";
  import { runExport } from "../lib/export/run.js";
  import { isYjsEnabled, setYjsEnabled } from "../lib/yjs/feature-flag.js";
  import SetupEncryption from "./SetupEncryption.svelte";
  import Modal from "../lib/ui/Modal.svelte";
  import Row from "../lib/ui/Row.svelte";
  import Toggle from "../lib/ui/Toggle.svelte";
  import SectionHeader from "../lib/ui/SectionHeader.svelte";
  import Divider from "../lib/ui/Divider.svelte";
  import Chip from "../lib/ui/Chip.svelte";
  import SegmentedControl from "../lib/ui/SegmentedControl.svelte";
  import Button from "../lib/ui/Button.svelte";
  import Popover from "../lib/ui/Popover.svelte";
  import SidebarShell from "../lib/ui/SidebarShell.svelte";
  import SidebarNavRow from "../lib/ui/SidebarNavRow.svelte";
  import MobileNavRow from "../lib/ui/MobileNavRow.svelte";
  import SyncSettings from "./SyncSettings.svelte";
  import { isCoarsePointer, isPhoneViewport } from "../lib/responsive.js";
  import { navPush, navClose } from "../lib/navstack.js";

  /** @type {{ currentTone: string, onToneChange: (tone: string) => void, currentFontFamily: string, onFontFamilyChange: (f: string) => void, currentFontSize: number, onFontSizeChange: (n: number) => void, onDeleteAll: () => void, onClose: () => void, initialTab?: "appearance"|"writing"|"data"|"encryption"|"sync"|"labs"|"danger"|"about" }} */
  let {
    currentTone,
    onToneChange,
    currentFontFamily = "lora",
    onFontFamilyChange = () => {},
    currentFontSize = 16,
    onFontSizeChange = () => {},
    onDeleteAll,
    onClose,
    initialTab = "appearance",
  } = $props();

  // __APP_VERSION__ is injected at build time from package.json via
  // vite.config.js's `define`. Test runs load vitest.config.js instead — a
  // separate config that does not set the define — so __APP_VERSION__ is
  // genuinely undefined there; the typeof guard below is what makes that
  // safe, falling back to "dev".
  const appVersion = `v${typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"}`;

  let deleteConfirm = $state("");

  // Platform detection for the tray toggle — mirrors App.svelte's
  // isMobilePlatform check. isPhoneViewport() is width-only, so a narrow
  // desktop window was hiding "close to tray" even though the feature is
  // real there (a real Android/iOS device just has no system tray at
  // all). Gate on platform instead so a narrow desktop window keeps the
  // toggle and real mobile never shows it, in either pane.
  let isMobilePlatform = $state(false);

  onMount(async () => {
    const ua = navigator.userAgent || "";
    isMobilePlatform = /Android|iPhone|iPad|iPod/i.test(ua);
    try {
      encrypted = await checkEncryptionStatus();
    } catch {}
    try {
      const lt = await getSetting("lock_timeout_minutes");
      if (lt) lockTimeout = parseInt(lt, 10) || 0;
    } catch {}
    try {
      const r = await getSetting("restore_last_page");
      // Default: off (matches the value Page.svelte assumes when the key is unset).
      restoreLastPage = r === "true";
    } catch {}
    try {
      const s = await getSetting("ui_scale");
      const parsed = s ? parseFloat(s) : NaN;
      if (Number.isFinite(parsed) && uiScaleOptions.some((o) => o.value === parsed)) {
        uiScale = parsed;
        applyUiScale(parsed);
      }
    } catch {}
    try {
      const c = await getSetting("close_to_tray");
      closeToTray = c === "true";
    } catch {}
    try {
      yjsEnabled = await isYjsEnabled();
    } catch {}
  });

  async function toggleYjs(next) {
    yjsEnabled = next;
    try {
      await setYjsEnabled(next);
    } catch (err) {
      console.error("Failed to save yjs flag:", err);
    }
  }

  let restoreLastPage = $state(false);
  let closeToTray = $state(false);

  // UI scale (chrome density): independent of editor body font size.
  // Controls --ui-scale so every rem in the design system scales together.
  const uiScaleOptions = [
    { value: 0.875, label: "small" },
    { value: 1.0,   label: "medium" },
    { value: 1.125, label: "large" },
  ];
  let uiScale = $state(1.0);

  function applyUiScale(v) {
    document.documentElement.style.setProperty("--ui-scale", String(v));
  }

  async function selectUiScale(v) {
    uiScale = v;
    applyUiScale(v);
    try {
      await setSetting("ui_scale", String(v));
    } catch (err) {
      console.error("Failed to save ui scale:", err);
    }
  }

  async function toggleRestoreLastPage() {
    restoreLastPage = !restoreLastPage;
    try {
      await setSetting("restore_last_page", restoreLastPage ? "true" : "false");
    } catch (err) {
      console.error("Failed to save restore-last-page:", err);
    }
  }

  async function toggleCloseToTray(next) {
    try {
      await setCloseToTray(next);
    } catch (err) {
      console.error("Failed to save close-to-tray:", err);
    }
  }

  let showDeleteInput = $state(false);
  let deleting = $state(false);
  let encrypted = $state(false);
  let showEncryptSetup = $state(false);
  // Deliberately a one-time read, not a $derived: Settings is destroyed and
  // recreated each time it opens ({#if showSettings} in Page.svelte), so
  // capturing initialTab once at mount is exactly right — re-deriving it
  // would fight the user's own tab clicks if the parent's requested tab
  // ever changed while this instance stayed open.
  // svelte-ignore state_referenced_locally
  let activeTab = $state(/** @type {"appearance"|"writing"|"data"|"encryption"|"sync"|"labs"|"danger"|"about"} */ (initialTab));
  let drawerOpen = $state(false);

  // On phones, settings has no sidebar — the requested tab opens straight
  // into its own sub-view instead of landing on the root tab list.
  // svelte-ignore state_referenced_locally
  let mobileView = $state(/** @type {"root"|"appearance"|"writing"|"data"|"encryption"|"sync"|"labs"|"danger"|"about"} */ (initialTab !== "appearance" ? initialTab : "root"));
  let pageTitle = $derived(mobileView === "root" ? "settings" : mobileView);

  // Section navigation is a navstack entry: hardware back / the browser
  // back button pops the section exactly like the in-UI back arrow.
  let sectionNavId = null;

  function enterSection(tab) {
    lastPushedFrom = tab;
    mobileView = tab;
    if (isPhoneViewport() && sectionNavId === null) {
      sectionNavId = navPush("settings-section", () => {
        sectionNavId = null;
        mobileView = "root";
        lockTimeoutPopoverOpen = false;
        tick().then(() => focusRootRow(lastPushedFrom));
      });
    }
    tick().then(focusFirstInPane);
  }

  function leaveSection() {
    mobileView = "root";
    lockTimeoutPopoverOpen = false;
    if (sectionNavId !== null) {
      const id = sectionNavId;
      sectionNavId = null;
      navClose(id);
    }
    tick().then(() => focusRootRow(lastPushedFrom));
  }

  // Single back affordance for the phone modal — at a section it pops
  // to root, at root it closes the modal entirely. Matches the hardware
  // Android back semantics so muscle-memory is consistent.
  function handleBack() {
    if (mobileView !== "root") {
      leaveSection();
    } else {
      onClose?.();
    }
  }

  let stackEl = $state(/** @type {HTMLDivElement | null} */ (null));
  let lastPushedFrom = $state(/** @type {string | null} */ (null));

  function focusFirstInPane() {
    if (!stackEl) return;
    const section = stackEl.querySelector(".pane.section");
    if (!section) return;
    const focusable = section.querySelector(
      "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"
    );
    if (focusable instanceof HTMLElement) focusable.focus({ preventScroll: true });
  }

  function focusRootRow(name) {
    if (!stackEl) return;
    const rows = stackEl.querySelectorAll(".pane.root .mobile-nav-row");
    for (const row of rows) {
      if (row.querySelector(".title")?.textContent?.trim() === name) {
        if (row instanceof HTMLElement) row.focus({ preventScroll: true });
        return;
      }
    }
  }

  onDestroy(() => {
    if (sectionNavId !== null) navClose(sectionNavId);
  });

  const tabBlurb = {
    appearance: "tone, type, scale.",
    writing: "what reopens when you launch shizumu.",
    data: "export pages or back up the database.",
    encryption: "lock the app with a password.",
    sync: "configure or pair this device with a relay.",
    labs: "opt-in experiments. may move or vanish.",
    danger: "permanent. read twice before clicking.",
    about: "build info.",
  };
  let exporting = $state(false);
  let exportProgress = $state(/** @type {{ pageCount: number, totalPageCount: number } | null} */ (null));
  let exportSummary = $state(/** @type {string | null} */ (null));
  let backingUp = $state(false);
  let yjsEnabled = $state(false);
  let lockTimeout = $state(0);
  const lockTimeoutOptions = [
    { value: 0, label: "never" },
    { value: 5, label: "5m" },
    { value: 15, label: "15m" },
    { value: 30, label: "30m" },
  ];

  let lockTimeoutPopoverOpen = $state(false);
  let lockTimeoutChipEl = $state(/** @type {HTMLElement | null} */ (null));
  let lockTimeoutLabel = $derived(
    lockTimeoutOptions.find((o) => o.value === lockTimeout)?.label ?? "never"
  );

  const tones = [
    { id: "cream", label: "cream" },
    { id: "white", label: "white" },
    { id: "dark", label: "dark" },
    { id: "system", label: "system" },
  ];

  const fonts = [
    { id: "lora", label: "lora" },
    { id: "inter", label: "inter" },
    { id: "dm-mono", label: "mono" },
    { id: "system-serif", label: "system" },
  ];

  async function selectTone(tone) {
    onToneChange(tone);
    try {
      await setSetting("canvas_tone", tone);
    } catch (err) {
      console.error("Failed to save tone:", err);
    }
  }

  async function selectFontFamily(family) {
    onFontFamilyChange(family);
    try {
      await setSetting("canvas_font_family", family);
    } catch (err) {
      console.error("Failed to save font family:", err);
    }
  }

  // Live preview while dragging — apply on input; persist on change.
  function previewFontSize(e) {
    const v = parseInt(e.currentTarget.value, 10);
    if (!Number.isFinite(v)) return;
    onFontSizeChange(v);
  }
  async function commitFontSize(e) {
    const v = parseInt(e.currentTarget.value, 10);
    if (!Number.isFinite(v)) return;
    onFontSizeChange(v);
    try {
      await setSetting("canvas_font_size", String(v));
    } catch (err) {
      console.error("Failed to save font size:", err);
    }
  }

  async function confirmDelete() {
    if (deleteConfirm !== "delete") return;
    deleting = true;
    try {
      await deleteAllData();
      onDeleteAll();
    } catch (err) {
      console.error("Failed to delete data:", err);
      deleting = false;
    }
  }

  async function handleExport() {
    if (exporting) return;
    exportSummary = null;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, title: "choose export folder" });
      if (!picked || typeof picked !== "string") return;

      exporting = true;
      exportProgress = { pageCount: 0, totalPageCount: 0 };
      const summary = await runExportWithOverwritePrompt(picked);
      if (summary) {
        exportSummary = `exported ${summary.pageCount} pages across ${summary.trailCount} trails`;
        sendNotification("shizumu", exportSummary);
      }
    } catch (err) {
      const msg = err?.toString?.() || "export failed";
      exportSummary = `export failed — ${msg}`;
      console.error("Export failed:", err);
    }
    exporting = false;
    exportProgress = null;
  }

  async function runExportWithOverwritePrompt(targetDir) {
    try {
      return await runExport(targetDir, {
        overwrite: false,
        onProgress: (p) => { exportProgress = p; },
      });
    } catch (err) {
      const msg = err?.toString?.() || "";
      if (msg.includes("folder is not empty")) {
        const proceed = confirm("folder is not empty. overwrite?");
        if (!proceed) return null;
        return await runExport(targetDir, {
          overwrite: true,
          onProgress: (p) => { exportProgress = p; },
        });
      }
      throw err;
    }
  }

  async function handleBackup() {
    backingUp = true;
    try {
      await backupDatabaseGui();
      sendNotification("shizumu", "backup saved");
    } catch (err) {
      console.error("Backup failed:", err);
    }
    backingUp = false;
  }

  async function selectLockTimeout(minutes) {
    lockTimeout = minutes;
    lockTimeoutPopoverOpen = false;
    try {
      await setLockTimeout(minutes);
      await setSetting("lock_timeout_minutes", String(minutes));
    } catch (err) {
      console.error("Failed to save lock timeout:", err);
    }
  }

  function handleEncryptionComplete() {
    showEncryptSetup = false;
    encrypted = true;
  }
</script>

{#if showEncryptSetup}
  <Modal open title="encryption" onClose={() => (showEncryptSetup = false)}>
    <SetupEncryption
      onComplete={handleEncryptionComplete}
      onCancel={() => (showEncryptSetup = false)}
    />
  </Modal>
{:else if isPhoneViewport()}
  <Modal open title={pageTitle} {onClose} hideBar={false}>
    {#snippet leading()}
      {#if mobileView !== "root"}
        <button
          type="button"
          class="back-arrow"
          aria-label="back"
          onclick={handleBack}
        >‹</button>
      {/if}
    {/snippet}

    <div class="stack" class:pushed={mobileView !== "root"} bind:this={stackEl}>
      <div class="stack-inner">
      <div class="pane root" aria-hidden={mobileView !== "root"}>
        <MobileNavRow title="appearance" blurb={tabBlurb.appearance} onClick={() => enterSection("appearance")} />
        <MobileNavRow title="writing"    blurb={tabBlurb.writing}    onClick={() => enterSection("writing")} />
        <MobileNavRow title="data"       blurb={tabBlurb.data}       onClick={() => enterSection("data")} />
        <MobileNavRow title="encryption" blurb={tabBlurb.encryption} onClick={() => enterSection("encryption")} />
        <MobileNavRow title="sync"       blurb={tabBlurb.sync}       onClick={() => enterSection("sync")} />
        <MobileNavRow title="labs"       blurb={tabBlurb.labs}       onClick={() => enterSection("labs")} />

        <Divider />

        <MobileNavRow title="danger" blurb={tabBlurb.danger} accent onClick={() => enterSection("danger")} />
        <MobileNavRow title="about"  blurb={tabBlurb.about}        onClick={() => enterSection("about")} />
      </div>

      <div class="pane section" aria-hidden={mobileView === "root"}>
        {#if mobileView === "appearance"}
          <Row description="canvas color underneath everything you write.">
            tone
            {#snippet trailing()}
              <SegmentedControl
                ariaLabel="tone"
                options={tones.map((t) => ({ value: t.id, label: t.label }))}
                value={currentTone}
                onChange={selectTone}
              />
            {/snippet}
          </Row>

          <Row description="typeface for body text in the editor.">
            font
            {#snippet trailing()}
              <SegmentedControl
                ariaLabel="font"
                options={fonts.map((f) => ({ value: f.id, label: f.label }))}
                value={currentFontFamily}
                onChange={selectFontFamily}
              />
            {/snippet}
          </Row>

          <Row description="size of body text in the editor, in pixels.">
            size
            {#snippet trailing()}
              <input
                type="range"
                min="10"
                max="22"
                step="1"
                value={currentFontSize}
                oninput={previewFontSize}
                onchange={commitFontSize}
                class="size-slider"
                aria-label="font size"
              />
              <span class="size-num">{currentFontSize}</span>
            {/snippet}
          </Row>

          <Row description="scales every menu, button, and chip outside the canvas.">
            interface size
            {#snippet trailing()}
              <SegmentedControl
                ariaLabel="interface size"
                options={uiScaleOptions.map((o) => ({ value: String(o.value), label: o.label }))}
                value={String(uiScale)}
                onChange={(v) => selectUiScale(parseFloat(v))}
              />
            {/snippet}
          </Row>
        {:else if mobileView === "writing"}
          <Row description="when you launch shizumu, jump straight back to the page you last edited instead of today's blank.">
            open last page
            {#snippet trailing()}
              <Toggle bind:checked={restoreLastPage} onChange={toggleRestoreLastPage} label="open last page" />
            {/snippet}
          </Row>
          {#if !isMobilePlatform}
            <Row description="closing the window keeps shizumu in the system tray instead of quitting.">
              close to tray
              {#snippet trailing()}
                <Toggle bind:checked={closeToTray} onChange={toggleCloseToTray} label="close to tray" />
              {/snippet}
            </Row>
          {/if}
        {:else if mobileView === "data"}
          <Row description="write every page as a markdown file into a folder you choose.">
            export to folder
            {#snippet trailing()}
              {#if exporting && exportProgress}
                <span class="export-progress">
                  {#if exportProgress.totalPageCount > 0}
                    exporting {exportProgress.pageCount} of {exportProgress.totalPageCount}…
                  {:else}
                    preparing…
                  {/if}
                </span>
              {:else if exportSummary}
                <span class="export-summary">{exportSummary}</span>
              {/if}
              <Button variant="ghost" onClick={handleExport} disabled={exporting}>
                {exporting ? "exporting" : "export"}
              </Button>
            {/snippet}
          </Row>

          <Row description="copy the whole database file to a location of your choice. restore by replacing the app's data dir.">
            backup everything
            {#snippet trailing()}
              <Button variant="ghost" onClick={handleBackup} disabled={backingUp}>
                {backingUp ? "backing up" : "backup"}
              </Button>
            {/snippet}
          </Row>
        {:else if mobileView === "encryption"}
          <Row description="protect every page with a password. you'll be asked for it each time the app starts.">
            lock with password
            {#snippet trailing()}
              {#if encrypted}
                <Chip variant="neutral">on</Chip>
              {:else}
                <Button variant="accent" onClick={() => (showEncryptSetup = true)}>set up</Button>
              {/if}
            {/snippet}
          </Row>

          <Row hidden={!encrypted} description="auto-lock the app after this much idle time. pick 'never' to keep it unlocked until you quit.">
            lock after inactivity
            {#snippet trailing()}
              <span bind:this={lockTimeoutChipEl}>
                <Chip
                  variant="neutral"
                  active={lockTimeoutPopoverOpen}
                  onClick={() => (lockTimeoutPopoverOpen = !lockTimeoutPopoverOpen)}
                >{lockTimeoutLabel}</Chip>
              </span>
            {/snippet}
          </Row>
        {:else if mobileView === "sync"}
          <SyncSettings />
        {:else if mobileView === "labs"}
          <Row description="use yjs (a crdt) under the hood for continuous trails. enables future multi-device editing on the same page.">
            yjs for continuous trails
            {#snippet trailing()}
              <Toggle checked={yjsEnabled} onChange={toggleYjs} label="yjs for continuous trails" />
            {/snippet}
          </Row>
        {:else if mobileView === "danger"}
          {#if !showDeleteInput}
            <Row description="wipes every page, pin, trail, attachment, and setting. unrecoverable. back up first if you might want any of it later.">
              delete all writing
              {#snippet trailing()}
                <span class="danger-slot">
                  <Button variant="ghost" onClick={() => (showDeleteInput = true)}>delete</Button>
                </span>
              {/snippet}
            </Row>
          {:else}
            <Row>
              type "delete" to confirm
              {#snippet trailing()}
                <input
                  type="text"
                  class="delete-input selectable"
                  bind:value={deleteConfirm}
                  placeholder="delete"
                  spellcheck="false"
                  autofocus
                />
                <span class="danger-slot">
                  <Button
                    variant="ghost"
                    disabled={deleteConfirm !== "delete" || deleting}
                    onClick={confirmDelete}
                  >{deleting ? "..." : "confirm"}</Button>
                </span>
              {/snippet}
            </Row>
          {/if}
        {:else if mobileView === "about"}
          <Row>
            version
            {#snippet trailing()}
              <span class="version">shizumu · {appVersion}</span>
            {/snippet}
          </Row>
        {/if}
      </div>
      </div>
    </div>
  </Modal>
{:else}
  <Modal open title="settings" size="wide" {onClose} hideBar={false}>
    <SidebarShell sidebarWidth="10rem" density="compact" sidebarMode="auto" bind:drawerOpen>
      {#snippet sidebar()}
        <SidebarNavRow active={activeTab === "appearance"} accent={activeTab === "appearance"} onClick={() => (activeTab = "appearance")}>appearance</SidebarNavRow>
        <SidebarNavRow active={activeTab === "writing"}    accent={activeTab === "writing"}    onClick={() => (activeTab = "writing")}>writing</SidebarNavRow>
        <SidebarNavRow active={activeTab === "data"}       accent={activeTab === "data"}       onClick={() => (activeTab = "data")}>data</SidebarNavRow>
        <SidebarNavRow active={activeTab === "encryption"} accent={activeTab === "encryption"} onClick={() => (activeTab = "encryption")}>encryption</SidebarNavRow>
        <SidebarNavRow active={activeTab === "sync"}       accent={activeTab === "sync"}       onClick={() => (activeTab = "sync")}>sync</SidebarNavRow>
        <SidebarNavRow active={activeTab === "labs"}       accent={activeTab === "labs"}       onClick={() => (activeTab = "labs")}>labs</SidebarNavRow>

        <Divider />

        <SidebarNavRow active={activeTab === "danger"} accent={activeTab === "danger"} onClick={() => (activeTab = "danger")}>
          <span class="danger-label">danger</span>
        </SidebarNavRow>
        <SidebarNavRow active={activeTab === "about"}  accent={activeTab === "about"}  onClick={() => (activeTab = "about")}>about</SidebarNavRow>
      {/snippet}

      <div class="section-hero">
        <h2 class="section-title">{activeTab}</h2>
        <p class="section-blurb">{tabBlurb[activeTab]}</p>
      </div>

      {#if activeTab === "appearance"}
        <Row description="canvas color underneath everything you write.">
          tone
          {#snippet trailing()}
            <SegmentedControl
              ariaLabel="tone"
              options={tones.map((t) => ({ value: t.id, label: t.label }))}
              value={currentTone}
              onChange={selectTone}
            />
          {/snippet}
        </Row>

        <Row description="typeface for body text in the editor.">
          font
          {#snippet trailing()}
            <SegmentedControl
              ariaLabel="font"
              options={fonts.map((f) => ({ value: f.id, label: f.label }))}
              value={currentFontFamily}
              onChange={selectFontFamily}
            />
          {/snippet}
        </Row>

        <Row description="size of body text in the editor, in pixels.">
          size
          {#snippet trailing()}
            <input
              type="range"
              min="10"
              max="22"
              step="1"
              value={currentFontSize}
              oninput={previewFontSize}
              onchange={commitFontSize}
              class="size-slider"
              aria-label="font size"
            />
            <span class="size-num">{currentFontSize}</span>
          {/snippet}
        </Row>

        <Row description="scales every menu, button, and chip outside the canvas.">
          interface size
          {#snippet trailing()}
            <SegmentedControl
              ariaLabel="interface size"
              options={uiScaleOptions.map((o) => ({ value: String(o.value), label: o.label }))}
              value={String(uiScale)}
              onChange={(v) => selectUiScale(parseFloat(v))}
            />
          {/snippet}
        </Row>
      {:else if activeTab === "writing"}
        <Row description="when you launch shizumu, jump straight back to the page you last edited instead of today's blank.">
          open last page
          {#snippet trailing()}
            <Toggle bind:checked={restoreLastPage} onChange={toggleRestoreLastPage} label="open last page" />
          {/snippet}
        </Row>
        {#if !isMobilePlatform}
          <Row description="closing the window keeps shizumu in the system tray instead of quitting.">
            close to tray
            {#snippet trailing()}
              <Toggle bind:checked={closeToTray} onChange={toggleCloseToTray} label="close to tray" />
            {/snippet}
          </Row>
        {/if}
      {:else if activeTab === "data"}
        <Row description="write every page as a markdown file into a folder you choose.">
          export to folder
          {#snippet trailing()}
            {#if exporting && exportProgress}
              <span class="export-progress">
                {#if exportProgress.totalPageCount > 0}
                  exporting {exportProgress.pageCount} of {exportProgress.totalPageCount}…
                {:else}
                  preparing…
                {/if}
              </span>
            {:else if exportSummary}
              <span class="export-summary">{exportSummary}</span>
            {/if}
            <Button variant="ghost" onClick={handleExport} disabled={exporting}>
              {exporting ? "exporting" : "export"}
            </Button>
          {/snippet}
        </Row>

        <Row description="copy the whole database file to a location of your choice. restore by replacing the app's data dir.">
          backup everything
          {#snippet trailing()}
            <Button variant="ghost" onClick={handleBackup} disabled={backingUp}>
              {backingUp ? "backing up" : "backup"}
            </Button>
          {/snippet}
        </Row>

      {:else if activeTab === "encryption"}
        <Row description="protect every page with a password. you'll be asked for it each time the app starts.">
          lock with password
          {#snippet trailing()}
            {#if encrypted}
              <Chip variant="neutral">on</Chip>
            {:else}
              <Button variant="accent" onClick={() => (showEncryptSetup = true)}>set up</Button>
            {/if}
          {/snippet}
        </Row>

        <Row hidden={!encrypted} description="auto-lock the app after this much idle time. pick 'never' to keep it unlocked until you quit.">
          lock after inactivity
          {#snippet trailing()}
            <span bind:this={lockTimeoutChipEl}>
              <Chip
                variant="neutral"
                active={lockTimeoutPopoverOpen}
                onClick={() => (lockTimeoutPopoverOpen = !lockTimeoutPopoverOpen)}
              >{lockTimeoutLabel}</Chip>
            </span>
          {/snippet}
        </Row>
      {:else if activeTab === "sync"}
        <SyncSettings />
      {:else if activeTab === "labs"}
        <Row description="use yjs (a crdt) under the hood for continuous trails. enables future multi-device editing on the same page.">
          yjs for continuous trails
          {#snippet trailing()}
            <Toggle checked={yjsEnabled} onChange={toggleYjs} label="yjs for continuous trails" />
          {/snippet}
        </Row>
      {:else if activeTab === "danger"}
        {#if !showDeleteInput}
          <Row description="wipes every page, pin, trail, attachment, and setting. unrecoverable. back up first if you might want any of it later.">
            delete all writing
            {#snippet trailing()}
              <span class="danger-slot">
                <Button variant="ghost" onClick={() => (showDeleteInput = true)}>delete</Button>
              </span>
            {/snippet}
          </Row>
        {:else}
          <Row>
            type "delete" to confirm
            {#snippet trailing()}
              <input
                type="text"
                class="delete-input selectable"
                bind:value={deleteConfirm}
                placeholder="delete"
                spellcheck="false"
                autofocus
              />
              <span class="danger-slot">
                <Button
                  variant="ghost"
                  disabled={deleteConfirm !== "delete" || deleting}
                  onClick={confirmDelete}
                >{deleting ? "..." : "confirm"}</Button>
              </span>
            {/snippet}
          </Row>
        {/if}
      {:else if activeTab === "about"}
        <Row>
          version
          {#snippet trailing()}
            <span class="version">shizumu · {appVersion}</span>
          {/snippet}
        </Row>
      {/if}
    </SidebarShell>
  </Modal>
{/if}

{#if lockTimeoutPopoverOpen}
  <Popover
    anchor={lockTimeoutChipEl}
    open
    placement="bottom-end"
    title="lock after inactivity"
    onClose={() => (lockTimeoutPopoverOpen = false)}
  >
    <div class="popover-options">
      {#each lockTimeoutOptions as o}
        <Chip
          variant="neutral"
          active={lockTimeout === o.value}
          onClick={() => selectLockTimeout(o.value)}
        >{o.label}</Chip>
      {/each}
    </div>
  </Popover>
{/if}

<style>
  .size-slider {
    flex: 1;
    min-width: 8rem;
    accent-color: var(--ink);
    cursor: pointer;
    background: transparent;
  }

  .size-num {
    font-family: "DM Mono", monospace;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.55;
    min-width: 1.5rem;
    text-align: right;
  }

  .delete-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    outline: none;
    font-family: "Inter", sans-serif;
    font-size: 0.8125rem;
    color: var(--ink);
    padding: 0.25rem 0;
    width: 7rem;
    transition: border-color var(--motion-fast);
  }
  .delete-input:focus {
    border-bottom-color: var(--warm-accent);
  }

  .version {
    font-family: "DM Mono", monospace;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.35;
  }

  .export-progress,
  .export-summary {
    font-family: "DM Mono", monospace;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.55;
    margin-right: 0.5rem;
  }

  .popover-options {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .danger-label {
    color: var(--warm-accent);
  }

  .section-hero {
    margin: 0 0 1.25rem;
    padding-bottom: 0.875rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
  }
  .section-title {
    margin: 0;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 1.375rem;
    font-weight: 500;
    color: var(--warm-accent);
    line-height: 1.2;
    letter-spacing: -0.005em;
  }
  .section-blurb {
    margin: 0.375rem 0 0;
    font-family: "Lora", Georgia, serif;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.55;
    line-height: 1.5;
  }

  /* Section hero compact variant on phone — title smaller, blurb hidden. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .section-hero {
      margin: 0 0 0.625rem;
      padding-bottom: 0.5rem;
    }
    .section-title {
      font-size: 1.125rem;
    }
    .section-blurb {
      display: none;
    }
  }

  .danger-slot {
    display: inline-flex;
    align-items: center;
  }
  .danger-slot :global(.btn) {
    color: var(--warm-accent);
    opacity: 0.75;
  }
  .danger-slot :global(.btn:hover:not(:disabled)) {
    opacity: 1;
  }
  .danger-slot :global(.btn:disabled) {
    opacity: 0.25;
  }

  /* === Phone stacked navigation === */

  .stack {
    position: relative;
    width: 100%;
    overflow: hidden;
  }
  .stack-inner {
    display: flex;
    align-items: flex-start;
    width: 200%;
    transition: transform 220ms cubic-bezier(0.2, 0, 0, 1);
  }
  .stack.pushed .stack-inner {
    transform: translateX(-50%);
  }
  .pane {
    width: 50%;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .pane.root {
    transition: opacity 220ms cubic-bezier(0.2, 0, 0, 1);
  }
  .stack.pushed .pane.root {
    opacity: 0.5;
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .stack-inner {
      transition: none;
    }
    .pane.root {
      transition: none;
    }
  }

  .back-arrow {
    appearance: none;
    background: transparent;
    border: none;
    width: 2.5rem;
    height: 2.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--ink);
    cursor: pointer;
    border-radius: 0.375rem;
    font-family: "Lora", Georgia, serif;
    font-size: 1.5rem;
    line-height: 1;
    opacity: 0.75;
    transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1), opacity 120ms cubic-bezier(0.2, 0, 0, 1);
  }
  .back-arrow:hover { opacity: 1; background: color-mix(in srgb, var(--ink) 5%, transparent); }
</style>
