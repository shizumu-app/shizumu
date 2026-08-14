<!--
  Popover — anchored panel.
  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component visual specs.

  Renders a floating panel positioned relative to `anchor` (an HTMLElement).
  Dismisses on outside-click and Esc. Anchor clicks bubble normally; the
  parent is responsible for toggling `open` from the anchor itself.

  Animation: opacity 0→1 + translateY 4px→0 on open (280ms cubic-out),
  reverse on close (180ms) — handled by Svelte's `transition:` directive.
-->
<script>
  import { onMount, tick } from "svelte";
  import { placePopover } from "./popover-place.js";
  import BottomSheet from "./BottomSheet.svelte";
  import { isMobileNav, watchMobileNav } from "../responsive.js";
  import { keyboardOpen } from "../keyboard-state.js";

  /** @type {{
    anchor: HTMLElement | null,
    open: boolean,
    placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end",
    role?: "dialog" | "menu" | null,
    ariaLabelledby?: string,
    autoFocus?: boolean,
    title?: string,
    onClose?: () => void,
    children?: import("svelte").Snippet,
  }} */
  let {
    anchor,
    open,
    placement = "bottom-start",
    role = null,
    ariaLabelledby,
    autoFocus = false,
    title,
    onClose,
    children,
  } = $props();

  let mobileNav = $state(isMobileNav());
  $effect(() => watchMobileNav((m) => { mobileNav = m; }));

  let panelEl = $state(/** @type {HTMLDivElement | null} */ (null));
  let style = $state("");

  function compute() {
    if (!anchor || !panelEl) return;
    const a = anchor.getBoundingClientRect();
    const p = panelEl.getBoundingClientRect();
    const { top, left, maxHeight } = placePopover({
      anchor: a,
      panel: p,
      placement,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    style = `position: fixed; top: ${top}px; left: ${left}px; max-height: ${maxHeight}px;`;
  }

  // The panel's size can settle AFTER the first measurement (webview font
  // loading, async content) — a single-shot compute() left the calendar
  // floating mid-air in the Tauri build. Re-place whenever the panel's
  // box changes. Guarded: jsdom has no ResizeObserver.
  $effect(() => {
    const el = panelEl;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (open && !mobileNav) compute();
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  $effect(() => {
    // Read panelEl and mobileNav synchronously so this effect re-runs when
    // either changes — not just when `open`/`anchor` change. Without this,
    // widening across the mobileNav breakpoint while open leaves the
    // freshly-mounted desktop panel unpositioned: `mobileNav` flipping
    // false doesn't retrigger the effect, and `panelEl` (read only inside
    // the tick().then() callback below) is untracked there.
    const el = panelEl;
    if (!open || !anchor || mobileNav || !el) return;
    tick().then(() => {
      compute();
      if (autoFocus && panelEl) {
        const focusable = panelEl.querySelector(
          "input, button, [tabindex]:not([tabindex='-1'])"
        );
        if (focusable instanceof HTMLElement) focusable.focus();
      }
    });
  });

  function handleDocClick(e) {
    // BottomSheet owns all dismissal on the phone/sheet path (scrim, Esc,
    // hardware back, drag) — panelEl only binds on the desktop branch, so
    // both containment checks below would miss and close the sheet on any
    // tap inside it (e.g. a calendar-day tap before selection lands).
    if (mobileNav) return;
    if (!open) return;
    const target = e.target;
    if (panelEl?.contains(target)) return;
    if (anchor?.contains(target)) return;
    onClose?.();
  }

  function handleKeydown(e) {
    if (!open) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose?.();
    }
  }

  onMount(() => {
    const onScrollOrResize = () => open && compute();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("pointerdown", handleDocClick);
    document.addEventListener("keydown", handleKeydown);
    // Soft-keyboard open/close can shift what's visible without a window
    // resize event (resizes-visual mode) — re-place on every transition.
    // keyboardOpen is published by keyboard-state.js, the app's single
    // viewport-state owner.
    const unsubKeyboardOpen = keyboardOpen.subscribe(onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("pointerdown", handleDocClick);
      document.removeEventListener("keydown", handleKeydown);
      unsubKeyboardOpen();
    };
  });
</script>

{#if mobileNav}
  <BottomSheet {open} onClose={() => onClose?.()} {title}>
    {#if children}{@render children()}{/if}
  </BottomSheet>
{:else if open}
  <div
    class="popover"
    bind:this={panelEl}
    {style}
    role={role ?? undefined}
    aria-labelledby={ariaLabelledby}
  >
    {#if children}{@render children()}{/if}
  </div>
{/if}

<style>
  .popover {
    z-index: 100;
    min-width: 12rem;
    /* Size to the content, not to whatever room happens to be left of the
       viewport edge. Being position:fixed with width:auto, the panel
       shrink-to-fits against `left` — so an anchor near the right edge
       squeezed it (measured: 242px for content that needs 288px) and the
       filters calendar clipped with a horizontal scrollbar. Sizing to
       content first lets placePopover's clamp move the panel left instead. */
    width: max-content;
    /* Allow inner content to set its own max-width up to a generous
       ceiling — the help popup needs 28-34rem to fit the key labels
       without clipping the right column. Earlier value of 24rem was
       hiding the shortcut keys. */
    max-width: 36rem;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-md);
    box-shadow: 0 0.5rem 1.5rem var(--card-shadow-hover);
    padding: 0.5rem;
    /* Height is capped by the computed max-height (placePopover); tall
       content scrolls inside instead of clamping over app chrome. */
    overflow-y: auto;
    overscroll-behavior: contain;
    animation: popover-in 280ms cubic-bezier(0.2, 0, 0, 1);
  }

  @keyframes popover-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
