<!--
  MobileActionBar — bottom tab strip for the three top-level surfaces
  on touch viewports. Hidden on desktop (> 768px).

  Buttons (left to right):
    pages    → jump to the writing surface (Page space).
    memory   → navigate to the memory view.
    settings → toggle the settings modal (open / close).

  Pins is NOT here — it's a page-scoped overlay, not a top-level
  surface. The pin chip lives in the top header next to "trail".
-->
<script>
  /** @type {{
    onPages: () => void,
    onMemory: () => void,
    onSettings: () => void,
    pagesActive?: boolean,
    memoryActive?: boolean,
    settingsActive?: boolean,
    hidden?: boolean,
  }} */
  let { onPages, onMemory, onSettings, pagesActive = false, memoryActive = false, settingsActive = false, hidden = false } = $props();
</script>

<!-- Icons are inline SVG, not text glyphs. The bar used ≡ / ↑ / ⚙ set in
     DM Mono, which carries no gear: ⚙ fell back to a system symbol font and
     rendered bold and filled next to two hairline glyphs — three icons at
     three weights, and a different fallback per webview engine. SVG strokes
     stay identical across WebKitGTK, WebView2 and Android WebView, and stay
     crisp at any DPR. -->
<nav class="mobile-action-bar" class:hidden aria-label="quick actions">
  <button class="action-btn" class:active={pagesActive} onclick={onPages} aria-label="go to page">
    <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="14" y2="17" />
    </svg>
    <span class="action-label">pages</span>
  </button>
  <button class="action-btn" class:active={memoryActive} onclick={onMemory} aria-label="open memory">
    <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="6" />
      <polyline points="6,12 12,6 18,12" />
    </svg>
    <span class="action-label">memory</span>
  </button>
  <button class="action-btn" class:active={settingsActive} onclick={onSettings} aria-label={settingsActive ? "close settings" : "open settings"}>
    <!-- Sliders rather than a gear: at 20px a gear's teeth collapse into
         noise, while two rules and two knobs stay legible. -->
    <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="9" r="2.4" />
      <circle cx="16" cy="16" r="2.4" />
    </svg>
    <span class="action-label">settings</span>
  </button>
</nav>

<style>
  /* Mounted only when App.svelte's `mobileNav` predicate is true (see
     src/lib/responsive.js isMobileNav) — the bar's presence in the DOM,
     not a CSS breakpoint, now decides whether it shows. Visibility while
     mounted is driven by the `hidden` prop, which mirrors the navstack's
     `hideBar` flag (set by bottom sheets via navPush(..., { hideBar: true })).
     Settings is a top-level surface with its own tab in this bar, so it
     does NOT set hideBar — the bar stays visible (tab active,
     toggle-to-close) while settings is open. */
  .mobile-action-bar {
    display: flex;
    justify-content: space-around;
    gap: var(--space-2);
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    pointer-events: auto;
    touch-action: manipulation;
    padding:
      var(--space-2)
      max(var(--safe-right), 0.75rem)
      max(var(--safe-bottom), 1.75rem)
      max(var(--safe-left), 0.75rem);
    background: color-mix(in srgb, var(--canvas-bg) 92%, transparent);
    border-top: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .mobile-action-bar.hidden {
    display: none;
  }

  .action-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
    padding: var(--space-2) var(--space-1);
    background: none;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--ink);
    /* 0.55 left the inactive tabs reading as disabled rather than merely
       unselected; the active tab still separates via --warm-accent. */
    opacity: 0.68;
    transition: opacity var(--motion-fast), background var(--motion-fast);
  }

  .action-btn:hover,
  .action-btn:focus-visible {
    opacity: 0.92;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    outline: none;
  }

  .action-btn:active {
    opacity: 1;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }

  /* Toggled-on state: the surface this button opens is currently up. */
  .action-btn.active {
    opacity: 1;
    color: var(--warm-accent);
    background: var(--warm-accent-soft);
  }

  /* 20px box, 1.75 stroke: reads clearly at phone DPRs without becoming
     chrome. The old 16px text glyphs were the smallest thing in the bar
     while being its primary affordance. */
  .action-icon {
    width: 20px;
    height: 20px;
    display: block;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .action-label {
    font-family: "DM Mono", monospace;
    /* 10px sat below the comfortable floor for a primary control. */
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
    line-height: 1;
  }
</style>
