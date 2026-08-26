<script>
  import Popover from "../lib/ui/Popover.svelte";
  import KeyHint from "../lib/ui/KeyHint.svelte";
  import { currentModifierLabel } from "../lib/ui/modifier-label.js";

  let open = $state(false);
  let toggleEl = $state(null);

  function handleKeyDown(e) {
    if (open && e.key === "Escape") {
      open = false;
      e.preventDefault();
    }
  }

  // Every chord below that carries `mod` is bound as `e.ctrlKey ||
  // e.metaKey` (Page.svelte, TipTapEditor's wrapper listener, Memory and
  // Thread) or as TipTap's "Mod-" prefix. The panel used to print ⌘ for
  // all of them, which is a key Linux and Windows keyboards do not have.
  // Resolved once, at module scope of this component, from navigator —
  // NOT from App.svelte's isMacOS, which is computed after the
  // `window.__VR__` early return and would leave this blank under ?vr=1.
  const mod = currentModifierLabel();

  // Sectioned shortcut groups. Deliberately trimmed to the bindings worth
  // muscle memory, so the panel stays scannable: the OS standards (copy,
  // undo, bold), the markdown input rules, memory's j/k, and
  // alt+shift+arrow's move-the-parent variant are all left out. They still
  // work. Every row here was checked against its binding — the labels say
  // what the key does, not what it was once meant to do.
  const sections = [
    {
      title: "writing",
      rows: [
        {
          label: "create a block",
          // src/lib/slash-commands.js — five of eighteen, the ones people
          // come looking for; the menu itself is the full list.
          sub: "list · table · chart · code · image",
          keys: ["/"],
        },
        {
          label: "link or start a trail",
          // src/lib/extensions/mention-command.js: three sections, four
          // item kinds — ref, pin-ref, create-subtrail, create-toplevel.
          // The old "insert subtrail" named one of the four.
          sub: "page · pin · subtrail · new trail",
          keys: ["@"],
        },
        { label: "line break, no new block", keys: ["shift", "↵"] },
        { label: "step out of the block",    keys: ["esc"] },
      ],
    },
    {
      title: "blocks",
      rows: [
        // Only up and down exist (block-movement.js). Left and right were
        // on the panel and bound nowhere.
        { label: "move block, item, or row",         keys: ["alt", "↑ / ↓"] },
        { label: "indent a list item, or next cell", keys: ["tab / shift+tab"] },
        { label: "copy the block as markdown",       keys: [mod, "shift", "c"] },
      ],
    },
    {
      title: "board titles",
      rows: [
        { label: "from the line above, into the title", keys: ["↓"] },
        { label: "keep the title, into the body",       keys: ["↵"] },
      ],
    },
    {
      title: "navigation",
      rows: [
        { label: "previous / next page",       keys: [mod, "← / →"] },
        { label: "open memory",                keys: [mod, "↑"] },
        { label: "back to the page",           keys: [mod, "↓"] },
        { label: "in memory: pages · trail map · pins", keys: ["1 · 2 · 3"] },
        // Page.svelte: on a continuous trail with day markers this opens
        // the in-doc trail index; the palette is the fallback.
        { label: "trail index, or command palette", keys: [mod, "k"] },
        { label: "open or close settings",     keys: [mod, ","] },
      ],
    },
    {
      title: "pins & find",
      rows: [
        { label: "pin from the cursor", keys: [mod, "p"] },
        { label: "find in page",        keys: [mod, "f"] },
        { label: "find and replace",    keys: [mod, "h"] },
      ],
    },
  ];
</script>

<svelte:window onkeydown={handleKeyDown} />

<button
  class="help-toggle"
  bind:this={toggleEl}
  onclick={() => (open = !open)}
  aria-label="keyboard shortcuts"
>?</button>

<Popover anchor={toggleEl} {open} placement="top-end" onClose={() => (open = false)}>
  <div class="help-panel" role="dialog" aria-label="keyboard shortcuts">
    <p class="help-title">shortcuts</p>
    {#each sections as section (section.title)}
      <p class="help-section-title">{section.title}</p>
      <ul class="help-list">
        {#each section.rows as r (r.label)}
          <li class="help-row">
            <span class="help-text">
              <span class="help-label">{r.label}</span>
              {#if r.sub}<span class="help-sub">{r.sub}</span>{/if}
            </span>
            <span class="help-keys">
              <KeyHint keys={r.keys} />
            </span>
          </li>
        {/each}
      </ul>
    {/each}
  </div>
</Popover>

<style>
  /* Phone: hide both the toggle and the popover content. Touch users
     don't have a keyboard to use the shortcuts. */
  @media (pointer: coarse) {
    .help-toggle,
    .help-panel {
      display: none !important;
    }
  }

  .help-toggle {
    position: fixed;
    bottom: 1rem; right: 1rem;
    width: 1.75rem; height: 1.75rem;
    border-radius: 50%;
    background: var(--ink);
    color: var(--canvas-bg);
    opacity: 0.25;
    border: 0;
    font-size: 0.875rem;
    font-family: "DM Mono", monospace;
    cursor: pointer;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
    z-index: 50;
  }
  .help-toggle:hover { opacity: 0.55; }

  .help-panel {
    min-width: 28rem;
    max-width: 34rem;
    /* 18 true rows are taller than the 12 half-true ones were. 88vh
       rather than 78vh, plus the tightened rhythm below, is what keeps
       the whole panel on one screen at a normal window height; a short
       window still scrolls, which is what overflow is for. */
    max-height: 88vh;
    overflow-y: auto;
    font-family: "Lora", serif;
    scrollbar-width: thin;
  }
  .help-title {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    color: var(--ink);
    opacity: 0.35;
    margin: 0 0 0.5rem;
  }
  .help-section-title {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.75rem;
    color: var(--warm-accent);
    opacity: 0.78;
    margin: 0.5rem 0 0.125rem;
    letter-spacing: 0.005em;
  }
  .help-section-title:first-of-type {
    margin-top: 0;
  }
  .help-list {
    list-style: none;
    padding: 0;
    margin: 0 0 0.125rem;
    display: flex;
    flex-direction: column;
    gap: 0.1875rem;
  }
  /* Grid, not space-between — but the grid has to span the PANEL.
     `space-between` on a two-item row already pushed the keys flush right
     (.help-label was flex:1); what is ragged is their LEFT edge, because
     each row sizes its own key group. A per-row `1fr auto` reproduces that
     exactly, and a per-LIST grid only straightens the rows within one
     section — the VR driver measured five different left edges, one per
     section, and said so. One track down the whole panel, reached by two
     levels of subgrid, is what puts every key group on the same x and lets
     the eye run down the modifier column.
     Base rule = today's per-row behaviour, so an engine without subgrid
     loses the alignment and nothing else. */
  .help-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    column-gap: 1rem;
    padding: 0.125rem 0;
  }
  @supports (grid-template-columns: subgrid) {
    .help-panel {
      display: grid;
      grid-template-columns: 1fr auto;
      column-gap: 1rem;
      align-content: start;
    }
    /* The headings are not part of the two-column rhythm; they span it.
       Row spacing stays on their existing margins, so the panel's vertical
       rhythm is unchanged by the switch. */
    .help-title,
    .help-section-title {
      grid-column: 1 / -1;
    }
    .help-list {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: subgrid;
      row-gap: 0.1875rem;
    }
    .help-row {
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
    }
  }
  .help-text {
    display: flex;
    flex-direction: column;
    gap: 0.0625rem;
    min-width: 0;
  }
  .help-label {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.8125rem;
    line-height: 1.35;
    color: var(--ink);
    opacity: 0.85;
  }
  /* `/` and `@` are gateways, not actions: they open whole menus, and
     naming what is inside is the reason the `@` row was wrong for so
     long. Quiet enough that the other rows stay the same weight. */
  .help-sub {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    line-height: 1.5;
    color: var(--ink);
    opacity: 0.4;
  }
  .help-keys {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }
  /* The keys are what people opened the panel for, and at KeyHint's
     shared .55-over-6% they were the faintest thing on it. Raised here
     only — onboarding and the playground keep the quieter inline chip. */
  .help-keys :global(.key-hint) {
    opacity: 0.85;
  }
  .help-keys :global(.key) {
    background: color-mix(in srgb, var(--ink) 12%, transparent);
  }
</style>
