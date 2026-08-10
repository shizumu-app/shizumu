<!-- src/lib/ui/SidebarShell.svelte -->
<!--
  SidebarShell — layout shell with optional sidebar (permanent on desktop,
  drawer on phone/tablet), toolbar slot above the content, and optional
  footer. See docs/superpowers/specs/2026-05-16-ui-ux-refresh-v0.4-design.md
  § "SidebarShell" for the contract.
-->
<script>
  import { onMount, onDestroy } from "svelte";
  import { isTabletViewport } from "../responsive.js";
  import { drawerSwipe } from "../gestures.js";

  /** @type {{
    sidebarWidth?: string,
    sidebarMode?: "auto" | "permanent" | "drawer",
    drawerOpen?: boolean,
    onDrawerChange?: (open: boolean) => void,
    density?: "compact" | "standard",
    sidebar?: import("svelte").Snippet,
    toolbar?: import("svelte").Snippet,
    footer?: import("svelte").Snippet,
    children?: import("svelte").Snippet,
  }} */
  let {
    sidebarWidth = "13.75rem",
    sidebarMode = "auto",
    drawerOpen = $bindable(false),
    onDrawerChange,
    density = "standard",
    sidebar,
    toolbar,
    footer,
    children,
  } = $props();

  let isMobile = $state(false);

  function updateMobile() {
    if (sidebarMode === "permanent") { isMobile = false; return; }
    if (sidebarMode === "drawer") { isMobile = true; return; }
    isMobile = isTabletViewport();
  }

  function onResize() { updateMobile(); }

  onMount(() => {
    updateMobile();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", onResize);
    }
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", onResize);
    }
  });

  function setDrawer(open) {
    drawerOpen = open;
    onDrawerChange?.(open);
  }

  function onScrimClick() { setDrawer(false); }

  function onKeydown(e) {
    if (e.key === "Escape" && drawerOpen) {
      e.preventDefault();
      setDrawer(false);
    }
  }

  let densityValue = $derived(density === "compact" ? "0.75" : "1");
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="sidebar-shell"
  class:is-mobile={isMobile}
  class:drawer-open={drawerOpen}
  style:--sidebar-density={densityValue}
  use:drawerSwipe={{
    enabled: () => isMobile && !!sidebar,
    isOpen: () => drawerOpen,
    onOpen: () => setDrawer(true),
    onClose: () => setDrawer(false),
  }}
>
  {#if isMobile && drawerOpen && sidebar}
    <!-- Escape and hamburger button are the a11y dismissal paths; the scrim is a pointer-only convenience. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="shell-scrim" onclick={onScrimClick}></div>
  {/if}

  {#if sidebar}
    <aside class="shell-sidebar" style:width={sidebarWidth}>
      {@render sidebar()}
    </aside>
  {/if}

  <section class="shell-main">
    {#if toolbar}
      <div class="shell-toolbar">
        {#if isMobile && sidebar}
          <button
            class="shell-hamburger"
            type="button"
            aria-label={drawerOpen ? "close trails" : "open trails"}
            onclick={() => setDrawer(!drawerOpen)}
          ><span aria-hidden="true">☰</span></button>
        {/if}
        {@render toolbar()}
      </div>
    {/if}

    <div class="shell-body">
      {#if children}{@render children()}{/if}
    </div>

    {#if footer}
      <div class="shell-footer">{@render footer()}</div>
    {/if}
  </section>
</div>

<style>
  .sidebar-shell {
    display: flex;
    width: 100%;
    height: 100%;
    background: var(--canvas-bg);
    color: var(--ink);
    position: relative;
  }

  .shell-sidebar {
    flex-shrink: 0;
    border-right: 1px solid var(--horizon);
    padding: 1rem 0.75rem;
    overflow-y: auto;
    background: transparent;
  }

  .shell-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .shell-toolbar {
    padding: 1rem 1.75rem 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    border-bottom: 1px solid var(--horizon);
  }

  .shell-hamburger {
    appearance: none;
    background: transparent;
    border: none;
    padding: 0.5rem;
    margin-left: -0.5rem;
    font-size: 1rem;
    color: var(--ink);
    opacity: 0.55;
    cursor: pointer;
    min-width: 2.75rem;
    min-height: 2.75rem;
  }

  .shell-hamburger:hover { opacity: 0.92; }

  .shell-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.75rem;
  }

  .shell-footer {
    padding: 0.75rem 1.75rem;
    border-top: 1px solid var(--horizon);
  }

  /* Mobile drawer behavior */
  .sidebar-shell.is-mobile .shell-sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 50;
    transform: translateX(-100%);
    transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
    background: var(--canvas-bg);
    box-shadow: 0 4px 16px var(--card-shadow);
  }

  .sidebar-shell.is-mobile.drawer-open .shell-sidebar {
    transform: translateX(0);
    transition-duration: 280ms;
  }

  .shell-scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 20%, transparent);
    z-index: 49;
    animation: scrim-in 280ms cubic-bezier(0.2, 0, 0, 1);
  }

  @keyframes scrim-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Phone bottom safe-area for content (MobileActionBar) */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    /* Reserve what the bar actually occupies, not a guess — 3.5rem was
       30px short of it, so the last row of a list sat underneath. */
    .shell-body { padding-bottom: var(--mobile-bar-h); }
    /* Tighter top on a phone: 1rem of desktop breathing room above the
       toolbar is a chunk of a short screen, and the host surface has
       already spent its own padding getting here. Lives in this file
       because the base `padding` shorthand does — a consumer's
       :global(.shell-toolbar) override loses to the scoped rule and is
       silently ignored (Memory.svelte had one that never applied). */
    .shell-toolbar { padding-top: 0.5rem; }
  }
</style>
