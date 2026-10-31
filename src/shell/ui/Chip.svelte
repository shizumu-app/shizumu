<!--
  A small mono tag beside a title: the trail a pin came from, `3 pins` on
  a block of the trail map, `untrailed` where there is no trail to name.

  INERT, AND THAT IS THE WHOLE DESIGN. The desktop has two chips and one
  of them is a control (TriggerChip opens a popover); a chip on a phone
  that is sometimes a button and sometimes a label is a tap the writer
  cannot predict. So this is a <span> with no handler, no role and no
  tabindex, and it never grows one — a thing that acts is a Row or a
  ToolbarButton, which carry the 44px floor a chip could not honour at
  --text-xs anyway. Chip.test.js holds the span and the absence of any
  control attribute, for exactly this reason.

  Set in the interface face because it is a label the interface applies,
  not a sentence the writer wrote — the shell's type roles give mono to
  what names and prose to what is read. `tone="accent"` is the desktop's
  `.pins-chip` (TrailMap.svelte): --warm-accent on --warm-accent-soft,
  for a count of what was kept. No new colour.
-->
<script>
  /** @type {{
    tone?: "ink" | "accent",
    children: import("svelte").Snippet,
  }} */
  let { tone = "ink", children } = $props();
</script>

<span class="shell-chip" data-tone={tone}>{@render children()}</span>

<style>
  .shell-chip {
    display: inline-block;
    padding: 0 var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    color: var(--ink-soft);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    line-height: var(--leading-sm);
    white-space: nowrap;
    vertical-align: middle;
  }

  .shell-chip[data-tone="accent"] {
    color: var(--accent-text);
    background: var(--warm-accent-soft);
    border-color: transparent;
  }
</style>
