<!--
  Modal — full overlay panel.
  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component visual specs.

  Scrim + centered panel. Focus traps inside while open; first focusable
  receives focus on open; focus returns to the opener on close.

  Slots:
    title    → optional title (also referenced by aria-labelledby)
    children → modal body
    actions  → footer (right-aligned)
-->
<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { navPush, navClose } from "../navstack.js";

  /** @type {{
    open: boolean,
    title?: string,
    dismissable?: boolean,
    size?: "default" | "wide",
    onClose?: () => void,
    hideBar?: boolean,
    children?: import("svelte").Snippet,
    actions?: import("svelte").Snippet,
    leading?: import("svelte").Snippet,
    trailing?: import("svelte").Snippet,
  }} */
  let {
    open,
    title,
    dismissable = true,
    size = "default",
    onClose,
    // Most modals are full-screen-equivalent overlays that should hide the
    // MobileActionBar while open. The settings surface is the one exception
    // (Page.svelte already owns a "settings" navstack entry that keeps the
    // bar visible with its tab active) — Settings.svelte passes
    // hideBar={false} on its own <Modal> so this primitive's own entry
    // doesn't re-hide it.
    hideBar = true,
    children,
    actions,
    leading,
    trailing,
  } = $props();

  let modalEl = $state(/** @type {HTMLDivElement | null} */ (null));
  let previousFocus = $state(/** @type {HTMLElement | null} */ (null));
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

  function getFocusable() {
    if (!modalEl) return [];
    return Array.from(
      modalEl.querySelectorAll(
        "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )
    ).filter((el) => el instanceof HTMLElement);
  }

  function handleKeydown(e) {
    if (!open) return;
    if (e.key === "Escape" && dismissable) {
      e.preventDefault();
      e.stopPropagation();
      onClose?.();
      return;
    }
    if (e.key === "Tab") {
      const focusables = getFocusable();
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function handleScrim() {
    if (dismissable) onClose?.();
  }

  // Hardware back / browser back closes the modal via the shared navstack,
  // same mechanism as BottomSheet. When NOT dismissable (e.g. MidnightModal),
  // back must not close it — the onClose callback immediately re-pushes a
  // fresh entry so the stack/history stay balanced and back still has
  // something to consume next time, but the modal never actually closes.
  let modalNavId = null;

  function pushModalEntry() {
    modalNavId = navPush("modal", () => {
      modalNavId = null;
      if (dismissable) {
        onClose?.();
      } else {
        pushModalEntry();
      }
    }, { hideBar });
  }

  $effect(() => {
    if (open && modalNavId === null) {
      pushModalEntry();
    } else if (!open && modalNavId !== null) {
      const id = modalNavId;
      modalNavId = null;
      navClose(id);
    }
  });

  onDestroy(() => {
    if (modalNavId !== null) navClose(modalNavId);
  });

  $effect(() => {
    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      tick().then(() => {
        const focusables = getFocusable();
        if (focusables.length > 0) focusables[0].focus();
        else modalEl?.focus();
      });
    } else if (previousFocus) {
      previousFocus.focus();
      previousFocus = null;
    }
  });

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  });
</script>

{#if open}
  <div
    class="scrim"
    onclick={handleScrim}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") handleScrim();
    }}
    role="presentation"
  ></div>
  <div
    class="modal"
    class:wide={size === "wide"}
    bind:this={modalEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby={title ? titleId : undefined}
    tabindex="-1"
  >
    {#if title || leading || trailing}
      <div class="modal-header">
        {#if leading}
          <div class="modal-leading">{@render leading()}</div>
        {/if}
        {#if title}
          <h2 id={titleId} class="modal-title">{title}</h2>
        {/if}
        {#if trailing}
          <div class="modal-trailing">{@render trailing()}</div>
        {/if}
      </div>
    {/if}
    {#if children}
      <div class="modal-body">{@render children()}</div>
    {/if}
    {#if actions}
      <div class="modal-actions">{@render actions()}</div>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 25%, transparent);
    z-index: 200;
    animation: scrim-in var(--motion-sheet-open);
  }

  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 201;
    display: flex;
    flex-direction: column;
    /* Honor safe-area on both sides so the modal never tucks under
       notches / curved corners; the calc keeps the 2rem gutter
       behavior on devices without safe-area-inset. */
    width: calc(100% - 2rem - var(--safe-left) - var(--safe-right));
    max-width: 32rem;
    max-height: calc(100vh - 4rem - var(--safe-top) - var(--safe-bottom));
    overflow-y: auto;
    background: var(--canvas-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-lg);
    padding: 1.75rem;
    box-shadow: 0 1rem 3rem var(--card-shadow-hover);
    animation: modal-in var(--motion-sheet-open);
    outline: none;
  }

  .modal.wide {
    max-width: 52rem;
    /* Fixed height so switching tabs never resizes the modal — sized to hold
       the content proportionately (taller tabs scroll their own body) rather
       than stretching to the full viewport and leaving a big empty box. */
    height: min(36rem, calc(100vh - 4rem - var(--safe-top) - var(--safe-bottom)));
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .modal-leading {
    display: inline-flex;
    align-items: center;
  }
  .modal-trailing {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
  }

  /* Landscape phones: don't enforce 28rem min-height; viewport is
     shorter than the modal. The scroll container handles overflow. */
  @media (orientation: landscape) and (max-height: 480px) {
    .modal.wide {
      min-height: 0;
      max-height: calc(100vh - 2rem);
    }
  }
  /* On phones: edge-to-edge fullscreen sheet. No rounded corners, no
     center transform, no side gutters. Respects safe-area insets so the
     content doesn't tuck under notches or system nav bars. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .modal {
      top: 0;
      left: 0;
      transform: none;
      width: 100%;
      max-width: 100%;
      height: 100dvh;
      max-height: 100dvh;
      border-radius: 0;
      border: none;
      padding: 1rem;
      padding-top: max(1rem, var(--safe-top));
      /* Reserve the fixed MobileActionBar's height (z-index:1000, above this
         modal at z-index:201) so the modal's last content — the cancel/join
         action row of the pairing wizard — can scroll clear of the bar instead
         of sitting hidden behind pages/memory/settings. --mobile-bar-h already
         folds in the bottom safe-area. Same clearance pattern as Memory and
         SidebarShell. Also clear the soft keyboard when it's taller than the
         bar (--kb-inset from keyboard-state.js, the app's single
         viewport-state owner) — otherwise a focused field near the bottom of
         a phone modal sits behind the IME instead of above it. */
      padding-bottom: calc(max(var(--mobile-bar-h), var(--kb-inset, 0px)) + 0.75rem);
      padding-left: max(1rem, var(--safe-left));
      padding-right: max(1rem, var(--safe-right));
      box-shadow: none;
      animation: modal-in-phone var(--motion-sheet-open);
    }
  }
  @keyframes modal-in-phone {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }

  .modal-title {
    margin: 0;
    font-family: "Lora", serif;
    font-size: 1.25rem;
    font-weight: 500;
    line-height: 1.3;
    color: var(--ink);
    opacity: 0.92;
  }

  .modal-body {
    font-family: "Lora", serif;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--ink);
    opacity: 0.75;
    /* Fill the remaining height (below the header) so a fixed-height modal's
       content area can own its scroll instead of the modal resizing. */
    flex: 1 1 auto;
    min-height: 0;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1.5rem;
  }

  @keyframes scrim-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes modal-in {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }
</style>
