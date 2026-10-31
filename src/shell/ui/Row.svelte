<!--
  A list row. Six kinds — push, action, choice, destructive, toggle, value
  — and row-kind.js decides which one a set of props is, what it draws
  and what tone it takes. The chevron is drawn for a push and nothing
  else: it is the promise that a tap opens a screen, and `save`, `insert`,
  a tone option or `continue` open none.

  It renders a real <button> only when it actually does something. A row
  that merely displays a value is inert markup, because putting it in the
  tab order promises an interaction it cannot deliver — and this is one of
  a handful of files the rules test lets use a raw <button> at all, so what
  it does with that permission has to be deliberate. Whether a row is a
  button is still `onSelect`'s to say; `kind` decides the chevron and the
  colour, not the element.

  A row draws no line of its own. It used to underline itself with a
  hairline, every row, everywhere, which put a line under a list of one
  and ruled a sheet the same as a screen. The line between rows belongs
  to RowGroup, which knows where its rows begin and end; a row on its own
  sits on the surface it was put on and draws nothing around itself.

  The label is prose (Lora) and the value is mono: a label is the writer's
  word for the thing — a trail's name, a page's first line — and the value
  beside it is the interface's — a count, a mode, a date. Two faces for
  two voices, the way the page has them.

  `keepFocus` is for a row that acts ON THE EDITOR from a sheet — the
  insert sheet, the block sheet, turn into. A tap on a button moves focus
  to it, which blurs the editor, which drops the soft keyboard; the third
  device pass found that as "click on a block from insert, the keyboard
  disappears, then we need to click again". Cancelling pointerdown is
  ToolbarButton's answer to the same blur (its header): focus never moves.
  Unlike ToolbarButton the row still ACTS on click, because a row lives in
  a scrolling list and a press that turns into a scroll must not run
  anything; cancelling pointerdown suppresses the focus change and the
  compatibility mouse events, not the scroll and not the click. Off by
  default: a row in settings has no editor to keep.
-->
<script>
  import Toggle from "../../lib/ui/Toggle.svelte";
  import { rowKind, rowChevron, rowTone } from "../row-kind.js";

  /** @type {{
    label: string,
    value?: string,
    onSelect?: (() => void) | null,
    toggle?: boolean,
    checked?: boolean,
    onToggle?: ((checked: boolean) => void) | null,
    destructive?: boolean,
    kind?: "push"|"action"|"choice"|"destructive"|"toggle"|"value"|null,
    keepFocus?: boolean,
  }} */
  let {
    label,
    value = "",
    onSelect = null,
    toggle = false,
    checked = false,
    onToggle = null,
    destructive = false,
    kind = null,
    keepFocus = false,
  } = $props();

  function holdFocus(event) {
    if (keepFocus) event.preventDefault();
  }

  const shape = $derived(rowKind({ onSelect, toggle, destructive, kind }));
  const tone = $derived(rowTone(shape));
</script>

{#if onSelect}
  <button
    class="shell-row"
    class:destructive
    type="button"
    data-kind={shape}
    data-tone={tone}
    data-destructive={destructive ? "true" : null}
    onpointerdown={holdFocus}
    onclick={onSelect}
  >
    <span class="shell-row-label">{label}</span>
    {#if value}<span class="shell-row-value">{value}</span>{/if}
    {#if rowChevron(shape)}<span class="shell-row-chevron" aria-hidden="true">›</span>{/if}
  </button>
{:else}
  <div class="shell-row" data-kind={shape} data-tone={tone}>
    <span class="shell-row-label">{label}</span>
    {#if toggle}
      <Toggle {checked} {label} onChange={onToggle ?? undefined} />
    {:else if value}
      <span class="shell-row-value">{value}</span>
    {/if}
  </div>
{/if}

<style>
  .shell-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: var(--tap);
    padding: var(--space-2) var(--space-4);
    background: none;
    border: none;
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    line-height: var(--leading-base);
    text-align: left;
  }

  .shell-row[data-kind="action"] { color: var(--accent-text); }
  /* Its own colour, not the action's orange: a row that deletes should not
     look like one that offers (visual pass, 2026-10-30). */
  .shell-row.destructive { color: var(--danger-text); }
  /* A row that does something answers the finger and the pointer: a soft
     tint on press, and on hover where there is one. Only the <button>
     form; an inert row is markup and must not look pressable. */
  button.shell-row {
    transition: background-color var(--motion-fast);
    -webkit-user-select: none;
    user-select: none;
  }
  button.shell-row:active { background: var(--press-tint); }
  @media (hover: hover) {
    button.shell-row:hover { background: var(--hover-tint); }
  }

  .shell-row-label {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--font-prose);
  }

  /* THE VALUE IS CAPPED, and that is P2f-2's finding rather than taste.
     The column had no width of any kind: a flex item's `min-width` is
     `auto`, which floors it at its MIN-CONTENT width, and a value with no
     spaces in it — a trail name, a device name, a path, a build string —
     has a min-content width of the whole string. So the value refused to
     shrink, and the label, which does carry `min-width: 0`, absorbed the
     whole overflow and wrapped to two lines. Nothing clipped and nothing
     failed — the row is `min-height`, not `height` — so the symptom was
     just that the list lost its rhythm at whichever row held the longest
     value. Reachable today from MemoryScreen, whose value column is a
     user-typed trail name.

     Three declarations and each does a separate part of it. `min-width:
     0` is what lets the item shrink at all. `max-width: 50%` is what
     stops it shrinking the LABEL first — without it both items shrink in
     proportion to their base sizes, so a long enough value still eats the
     label's line. The ellipsis pair is what makes the shrink legible
     rather than a mid-word cut.

     jsdom applies no scoped stylesheet and computes no layout, so nothing
     rendered can see any of this. Row.test.js holds the declarations by
     reading this file instead, the way PageScreen.test.js holds the
     page's three left edges, and says so at the assertion. */
  .shell-row-value {
    color: var(--ink-soft);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    flex: 0 1 auto;
    min-width: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shell-row-chevron { color: var(--ink-soft); flex: 0 0 auto; }

  /* The switch's hit area, floored to the tap size through the row.
     Toggle.svelte (src/lib/ui, not the shell's to edit) sizes its label
     2.75rem square, which is 38.5px at the phone's --ui-scale — under the
     44px the whole shell guarantees. Its root class is `.toggle`; the
     row reaches it through :global because the class is Toggle's, not
     this file's. Both axes, not just the height: the switch sits at the
     row's right edge, and a thumb landing beside it misses either way. */
  .shell-row :global(.toggle) {
    min-height: var(--tap);
    min-width: var(--tap);
  }
</style>
