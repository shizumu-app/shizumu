<!-- src/lib/ui/BottomSheet.svelte -->
<!--
  BottomSheet — modal panel that slides up from the bottom of the
  viewport. Used on phone for filter pickers, action menus, anything
  that pairs "see the list while you tap" with a separate intent.

  Affordances:
    - Drag handle at top — drag down past 30% of sheet height (or flick
      fast) to dismiss; pointer handlers live on the handle only, so
      scrolling the sheet body is untouched.
    - Scrim above (semi-opaque) — tap to dismiss.
    - Escape key to dismiss.
    - Hardware Android back / browser back via the shared navstack
      (src/lib/navstack.js) — same mechanism Settings' phone stacked-nav
      uses.

  Props:
    open       — boolean, parent owns the open/close state.
    onClose    — called on any dismiss path.
    title?     — small label at the top of the sheet.
    children   — sheet body content.
-->
<script>
  import { onMount, onDestroy } from "svelte";
  import { navPush, navClose } from "../navstack.js";
  import { sheetDismissVerdict } from "../gestures.js";

  /** @type {{
    open: boolean,
    onClose: () => void,
    title?: string,
    children?: import("svelte").Snippet,
  }} */
  let { open, onClose, title, children } = $props();

  let sheetEl = $state(/** @type {HTMLDivElement | null} */ (null));

  // Handle drag-to-dismiss. Pointer handlers live ONLY on the handle
  // element (never the sheet body) so content scrolling is untouched.
  let dragDy = $state(0);
  let dragging = $state(false);
  let dragStartY = 0;
  let dragStartT = 0;

  // Popover mounts BottomSheet behind `{#if mobileNav}`, not `{#if open}`,
  // so this instance persists across open/close cycles — and a hardware-
  // back / Esc / scrim dismiss mid-drag calls onClose directly, bypassing
  // handleDragEnd. Without this, stale dragDy/dragging would render the
  // NEXT open visibly offset with transitions disabled.
  $effect(() => {
    if (!open) {
      dragging = false;
      dragDy = 0;
    }
  });

  function handleDragStart(e) {
    dragging = true;
    dragDy = 0;
    dragStartY = e.clientY;
    dragStartT = Date.now();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function handleDragMove(e) {
    if (!dragging) return;
    dragDy = Math.max(0, e.clientY - dragStartY);
  }
  function handleDragEnd() {
    if (!dragging) return;
    dragging = false;
    const h = sheetEl?.offsetHeight || 400;
    if (sheetDismissVerdict({ dy: dragDy, sheetHeight: h, dtMs: Date.now() - dragStartT })) {
      dragDy = 0;
      onClose?.();
    } else {
      dragDy = 0; // spring back via the transform transition
    }
  }

  function handleScrim() {
    // If a form input inside the sheet has focus, the user is typing —
    // ignore the click. Android's soft keyboard can fire a synthetic
    // click on the layout viewport just outside the visible viewport
    // (which is where the scrim now lives), so this catches a common
    // false dismiss while typing in a sheet's search input.
    if (sheetEl && document.activeElement && sheetEl.contains(document.activeElement)) {
      const tag = document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement.isContentEditable) {
        return;
      }
    }
    onClose?.();
  }

  function handleKeydown(e) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  }

  // Hardware back / browser back closes the sheet via the shared navstack:
  // its onClose calls our onClose exactly once. Programmatic close (caller
  // flips `open` to false) rewinds the matching history entry via navClose,
  // which does NOT re-call onClose — the caller already knows it's closed.
  let sheetNavId = null;
  $effect(() => {
    if (open && sheetNavId === null) {
      sheetNavId = navPush("sheet", () => {
        sheetNavId = null;
        onClose?.();
      }, { hideBar: true });
    } else if (!open && sheetNavId !== null) {
      const id = sheetNavId;
      sheetNavId = null;
      navClose(id);
    }
  });

  // Mark <body> while open so chrome that wants to step aside (e.g.
  // the page-content .bottom-bar that would visually clash) can hide
  // itself. The MobileActionBar stays — the sheet sits ABOVE it.
  $effect(() => {
    if (typeof document === "undefined") return;
    if (open) {
      document.body.classList.add("shizumu-bottom-sheet-open");
      return () => document.body.classList.remove("shizumu-bottom-sheet-open");
    }
  });

  // A focusin scrollIntoView backstop used to live here (Android WebView
  // quirk workaround). It's gone: the sheet now lifts itself above the
  // keyboard via `bottom: var(--kb-inset, 0px)` (see the .sheet rule
  // below), so the field is already in view without a scroll — and the
  // backstop's smooth-scroll animation was itself firing a stream of vv
  // scroll events that fought keyboard-state.js's scroll reset, which is
  // what caused the "keyboard appears then collapses" bug (see
  // keyboard-state.js's activeElement guard, the other half of that fix).

  onMount(() => {
    if (typeof window === "undefined") return;
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
    };
  });

  onDestroy(() => {
    if (sheetNavId !== null) navClose(sheetNavId);
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sheet-scrim" onclick={handleScrim}></div>
  <div
    class="sheet"
    class:dragging
    role="dialog"
    aria-modal="true"
    aria-label={title || "sheet"}
    bind:this={sheetEl}
    style:transform={dragDy ? `translateY(${dragDy}px)` : ""}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="sheet-handle"
      aria-hidden="true"
      style="touch-action: none"
      onpointerdown={handleDragStart}
      onpointermove={handleDragMove}
      onpointerup={handleDragEnd}
      onpointercancel={handleDragEnd}
    ></div>
    {#if title}
      <h3 class="sheet-title">{title}</h3>
    {/if}
    <div class="sheet-body">
      {#if children}{@render children()}{/if}
    </div>
  </div>
{/if}

<style>
  .sheet-scrim {
    position: fixed;
    inset: 0;
    /* Stronger ink overlay so the dimmed area below the sheet (between
       sheet bottom and the persistent MobileActionBar) reads as
       "page behind a modal" rather than "empty sheet space". */
    background: color-mix(in srgb, var(--ink) 55%, transparent);
    z-index: 9998;
    animation: scrim-fade var(--motion-sheet-open);
  }

  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    /* Extend to the very bottom of the viewport (above the gesture
       safe-area). MobileActionBar hides itself while a sheet is open
       via body.shizumu-bottom-sheet-open. Above the soft keyboard: --kb-inset
       (keyboard-state.js, the app's single viewport-state owner) is the
       keyboard's height when it's covering the sheet, 0px otherwise. */
    bottom: var(--kb-inset, 0px);
    transition: bottom 160ms cubic-bezier(0.2, 0, 0, 1);
    z-index: 9999;
    background: var(--canvas-bg);
    border-top: 1px solid var(--card-border);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: 0 -0.5rem 2rem var(--card-shadow-hover);
    /* Fill the space between the system status bar and the
       MobileActionBar so long content (filter sheet with calendar +
       sort + filter sections) is mostly visible without scrolling.
       --app-height (keyboard-state.js), not 100dvh: dvh is the LAYOUT
       viewport and doesn't shrink for the soft keyboard, so a tall sheet
       capped against it — even with `bottom` already pulled up by
       --kb-inset above — can still be TALLER than the space actually
       available above the keyboard, pushing the sheet's own top (handle,
       title) off the top of the visible area. Capping against the visible
       viewport instead means the sheet can never be taller than the room
       it actually has, keyboard open or not. */
    max-height: calc(var(--app-height, 100dvh) - var(--safe-top) - 2rem);
    overflow-y: auto;
    padding:
      0.5rem
      max(1rem, var(--safe-right))
      max(0.75rem, var(--safe-bottom))
      max(1rem, var(--safe-left));
    /* Entry/exit uses the `animation` shorthand (sheet-up, below); this
       `transition` is a SEPARATE mechanism that only engages when the
       inline `transform` style changes from handle-drag/spring-back.
       CSS Animations suppress Transitions for changes they themselves
       cause, and the animation's resting keyframe (translateY(0)) matches
       the no-drag baseline here, so the two never fight. .dragging turns
       the transition off entirely so the sheet tracks the finger 1:1. */
    transition: transform var(--motion-sheet-close);
    animation: sheet-up var(--motion-sheet-open);
  }

  .sheet.dragging {
    transition: none;
  }

  .sheet-handle {
    /* Visual bar stays 2.25rem x 0.25rem — background-clip confines the
       fill to the content box. Padding grows the touch/pointer hit area
       to the 44px floor without changing what's drawn. */
    width: 2.25rem;
    height: 0.25rem;
    padding: 1.25rem 1rem;
    box-sizing: content-box;
    background: color-mix(in srgb, var(--ink) 18%, transparent);
    background-clip: content-box;
    border-radius: 0.25rem;
    margin: 0 auto 0.125rem;
  }

  .sheet-title {
    margin: 0 0 0.75rem;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--ink);
    opacity: 0.55;
  }

  .sheet-body {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  @keyframes scrim-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes sheet-up {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

</style>
