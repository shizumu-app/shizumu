<script>
  import Popover from "../lib/ui/Popover.svelte";
  import KeyHint from "../lib/ui/KeyHint.svelte";

  let open = $state(false);
  let toggleEl = $state(null);

  function handleKeyDown(e) {
    if (open && e.key === "Escape") {
      open = false;
      e.preventDefault();
    }
  }

  // Sectioned shortcut groups. Trimmed to the bindings worth muscle
  // memory — the standards (copy, undo, bold) and power-user combos
  // (list markers, find & replace, memory j/k, move parent) are left
  // out so the popup stays scannable. They still work in the editor.
  const sections = [
    {
      title: "writing",
      rows: [
        { label: "create block",                  keys: ["/"] },
        { label: "insert subtrail",               keys: ["@"] },
        { label: "new line in same item",         keys: ["shift", "↵"] },
        { label: "exit current block",            keys: ["esc"] },
      ],
    },
    {
      title: "blocks",
      rows: [
        { label: "move block, item, or row",      keys: ["alt", "↑↓←→"] },
        { label: "indent / outdent list item",    keys: ["tab", "shift+tab"] },
      ],
    },
    {
      title: "navigation",
      rows: [
        { label: "previous / next page",          keys: ["⌘", "← / →"] },
        { label: "open memory",                   keys: ["⌘", "↑"] },
        { label: "command palette",               keys: ["⌘", "k"] },
        { label: "settings",                      keys: ["⌘", ","] },
      ],
    },
    {
      title: "pins & find",
      rows: [
        { label: "quick pin from cursor",         keys: ["⌘", "p"] },
        { label: "find in page",                  keys: ["⌘", "f"] },
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
            <span class="help-label">{r.label}</span>
            <span class="help-keys">
              <KeyHint keys={r.keys} />
              {#if r.hint}<span class="help-hint">{r.hint}</span>{/if}
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
    max-height: 78vh;
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
    margin: 0 0 0.625rem;
  }
  .help-section-title {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.75rem;
    color: var(--warm-accent);
    opacity: 0.78;
    margin: 0.75rem 0 0.1875rem;
    letter-spacing: 0.005em;
  }
  .help-section-title:first-of-type {
    margin-top: 0;
  }
  .help-list {
    list-style: none;
    padding: 0;
    margin: 0 0 0.1875rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .help-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.25rem 0;
  }
  .help-label {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.75;
    flex: 1;
    min-width: 0;
  }
  .help-keys {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
  }
  .help-hint {
    font-family: "Inter", sans-serif;
    font-size: 0.625rem;
    color: var(--ink);
    opacity: 0.35;
    margin-left: 0.25rem;
  }
</style>
