<!--
  An inset group of rows: an optional eyebrow, then a rounded surface
  holding the rows, with a soft line between each pair and none at the
  group's edges.

  This is where the line between rows now lives. Row used to draw a
  hairline under itself, every row, everywhere — so a list of one row had
  a line under nothing, a list's last row underlined the gap beneath it,
  and a sheet's rows were ruled the same as a screen's. A group knows
  where its rows begin and end; a row does not. So the separator is drawn
  here, on every child AFTER the first, inset to the label's edge, and
  the surface's own boundary does the containing the old bottom line was
  standing in for.

  `> * + *`, not `.shell-row + .shell-row`: PinsScreen and MemoryScreen
  wrap each Row in a status div, and a selector that named the row would
  draw nothing between them. The children are whatever the screen puts
  here; the rule reads the group's DIRECT children and no deeper.

  `flush` drops the inset, the surface and the radius: a sheet is already
  a surface, and a group inside one that drew its own would be a card on
  a card. The separators stay.
-->
<script>
  import Eyebrow from "./Eyebrow.svelte";

  /** @type {{
    eyebrow?: string,
    flush?: boolean,
    children: import("svelte").Snippet,
  }} */
  let { eyebrow = "", flush = false, children } = $props();
</script>

<section class="shell-row-group" class:flush>
  {#if eyebrow}<Eyebrow label={eyebrow} />{/if}
  <div class="shell-row-group-body">{@render children()}</div>
</section>

<style>
  .shell-row-group {
    margin: var(--space-3) 0;
  }

  .shell-row-group-body {
    margin: 0 var(--space-4);
    background: var(--surface);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .flush .shell-row-group-body {
    margin: 0;
    background: none;
    border-radius: 0;
  }

  /* The line between rows. Drawn as a pseudo-element on every child after
     the first rather than as a border on the child, because the children
     are the screen's markup — a Row, or a div around one — and none of
     them should have to know it sits in a group. Anchored to the child's
     top edge and inset to var(--space-4), the label's own left edge, so
     the line reads as dividing the labels rather than boxing the surface.
     Absolutely positioned within the child, which is the one placement the
     rules test permits; the child is made the containing block for it. */
  .shell-row-group-body > :global(* + *) {
    position: relative;
  }

  .shell-row-group-body > :global(* + *)::before {
    content: "";
    position: absolute;
    left: var(--space-4);
    right: 0;
    top: 0;
    height: 1px;
    background: var(--hairline-soft);
  }
</style>
