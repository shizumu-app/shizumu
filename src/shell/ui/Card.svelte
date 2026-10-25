<!--
  A bounded card for content on the canvas: the pin's writing on the pin
  view, a read page's doc on the reading view. The desktop's `.modal-editor`
  and `.pv-content` boxes, as one shell primitive.

  It sits on --raised, not --surface. --surface is the group tone, and at
  cream it is within a few percent of the canvas — right for a row group,
  whose rows and eyebrow do most of the bounding, and too little for a
  page of prose that has nothing but its edge to say where it ends. The
  token is one step further from the canvas on every tone (global.css,
  appended by the visual pass's Task 1), and the --hairline-soft border is
  the same line RowGroup draws between rows: enough to divide, not a box.

  `overflow-x: auto` is for what the writing can hold — a table wider than
  the phone, a code block with a long line — which scrolls inside the card
  rather than pushing the screen sideways. The card is the one element on
  a reading screen allowed to be wider than its content band, and it keeps
  that width to itself.

  Inert, no role: it is a frame around content, and the content decides
  what it is.
-->
<script>
  /** @type {{ children: import("svelte").Snippet }} */
  let { children } = $props();
</script>

<div class="shell-card">{@render children()}</div>

<style>
  .shell-card {
    margin: 0 var(--space-4);
    padding: var(--space-4);
    background: var(--raised);
    border: 1px solid var(--hairline-soft);
    border-radius: var(--radius-lg);
    overflow-x: auto;
  }
</style>
