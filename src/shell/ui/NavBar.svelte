<!--
  The nav band: a title, an optional back, and at most two actions.

  Two rules are load-bearing. The bar never computes its own collapse —
  nav-collapse.js owns that (scroll hysteresis plus the keyboard), and a
  bar that decided for itself would be a second owner of a rule that
  already has one, which is how chrome visibility latched in the desktop
  tree. And the action count is capped at two by §4: a bar that quietly
  rendered a third would become the place screens smuggle a toolbar into,
  which is the slot's job and the slot's alone.

  Two faces on one bar, by role. The title and subtitle are set in
  --font-prose: they name the thing on screen — a day, a trail, a pin's
  first line — in the writer's own words, and are read the way the page
  is read. The back glyph and the two actions stay in the interface face,
  --font-ui, because they are controls: a label on something that acts.
  ShellRoot sets the interface face on the whole tree, so until the visual
  pass the titles simply inherited it and read as one more control.
  NavBar.test.js holds both roles by reading this file.
-->
<script>
  /** @type {{
    title?: string,
    subtitle?: string,
    collapsed?: boolean,
    onBack?: (() => void) | null,
    actions?: Array<{id: string, label: string, onSelect: () => void}>,
    children?: import("svelte").Snippet,
  }} */
  let {
    title = "",
    subtitle = "",
    collapsed = false,
    onBack = null,
    actions = [],
    children,
  } = $props();

  const shown = $derived(actions.slice(0, 2));
</script>

<div class="shell-navbar" class:collapsed>
  {#if onBack}
    <button class="shell-navbar-back" type="button" aria-label="back" onclick={onBack}>‹</button>
  {/if}
  <div class="shell-navbar-titles">
    <span class="shell-navbar-title">{title}</span>
    {#if subtitle && !collapsed}
      <span class="shell-navbar-subtitle">{subtitle}</span>
    {/if}
  </div>
  {#if children}{@render children()}{/if}
  <div class="shell-navbar-actions">
    {#each shown as action (action.id)}
      <!-- `data-action-id` is how a scenario names this control. The label
           is not a handle: `filters` becomes `filters · 2` the moment one is
           on, and the trail action is named after whichever trail is
           scoped, so matching the words would break on the states worth
           driving. Same convention as `data-tab-id` and `data-button-id`. -->
      <button
        class="shell-navbar-action"
        type="button"
        data-action-id={action.id}
        onclick={action.onSelect}
      >
        {action.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .shell-navbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    min-height: var(--tap);
    border-bottom: 1px solid transparent;
    transition: min-height var(--motion-normal), border-color var(--motion-fast);
  }

  /* Collapsed is one line: the subtitle is dropped rather than hidden, so
     the bar's height genuinely shrinks and the content band gains it. */
  .shell-navbar.collapsed {
    min-height: var(--tap);
    border-bottom-color: var(--hairline);
  }

  .shell-navbar-titles {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 auto;
  }

  /* Prose, both lines — see the header. */
  .shell-navbar-title {
    font-family: var(--font-prose);
    font-size: var(--text-lg);
    line-height: var(--leading-lg);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shell-navbar-subtitle {
    font-family: var(--font-prose);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    color: var(--ink-soft);
  }

  .shell-navbar-back,
  .shell-navbar-action {
    min-width: var(--tap);
    min-height: var(--tap);
    background: none;
    border: none;
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  /* Two actions are two words, and the page header's rhythm is the one
     they take: `.ph-line1` gaps its controls by space-2, and each control
     centres its short label in a 44px box, so the visible air between
     "find" and "pins" is that gap plus a margin either side. A label
     longer than 44px — "filters", "trails" — fills its box edge to edge,
     so with no gap and no padding the two ran together as one word on
     memory's bar ("filterstrails", on a real phone). The gap is the
     header's; the padding stands in for the margin the header's short
     labels get from centring. NavBar.test.js holds both declarations by
     reading this file — jsdom lays nothing out. */
  .shell-navbar-actions {
    display: flex;
    flex: 0 0 auto;
    gap: var(--space-2);
  }

  .shell-navbar-action {
    padding: 0 var(--space-2);
  }
</style>
