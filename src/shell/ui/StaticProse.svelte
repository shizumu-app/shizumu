<!--
  Writing rendered, not mounted: `ProseHTML` plus the list rules the editor
  would otherwise have supplied.

  ── WHY A WRAPPER AND NOT A CLASS ──────────────────────────────────────

  Every list rule in the app lives under `.ProseMirror` (global.css:
  `list-style: none`, the `::before` bullet and counter, the task
  checkbox chrome). `prose.css` carries none of them — its only list rule
  is the paragraph margin inside an item. So a `ul[data-list]` rendered as
  static HTML into `.prose` gets the browser's own disc bullet beside the
  marker `unified-list.js`'s `renderHTML` emits, and a task list on a real
  phone read `• ☐ item`, both markers at once. ReadingScreen and
  PinArtifactScreen both render this way and both had it.

  The fix cannot go where the desktop's rules are. `prose.css` and
  `global.css` are shared trees this branch may only append tokens to
  (CLAUDE.md, two trees), and a rule on `.prose ul[data-list]` would reach
  the live editor too — EditorCore's host is `class="tiptap-editor prose"`,
  so the ProseMirror list already sits inside `.prose` and would take a
  second set of the same declarations at a different specificity. The
  rules are scoped to a class only this component puts on the container,
  and the two screens share one answer rather than each keeping a copy
  the other depends on without saying so.

  ── MIRRORED FROM `.ProseMirror`, WITH ONE DIFFERENCE NAMED ────────────

  All four markers, so a pinned ordered list numbers and a plain item
  keeps its column — a subset would render one kind right and the next
  pin wrong. The one place the mirror bends: the editor's NodeView wraps
  an item's content in a `<div>` that is the grid's second cell, and
  `renderHTML` emits that div for task items only — a bullet item's
  paragraphs are the `<li>`'s own children. So instead of the editor's
  `> li > div` rule, every child but the label is sent to column two,
  which is what the div achieved. The editor's `cursor: text` and
  `user-select: text` on that div are not carried: they describe a
  surface with a cursor, and the whole point of this one is that it has
  none.

  The checkbox is inert. The static `<input type=checkbox>` is a real
  control the browser would toggle on tap, and nothing behind it saves —
  a pin is a frozen snapshot (CLAUDE.md, pin pointer clause) and a read
  page is read-only (page-writable.js). A box that flips and forgets is a
  promise the surface cannot keep, the class `Row` refuses in its own
  header, so the label swallows the tap.

  jsdom applies no stylesheet, so PinArtifactScreen.test.js holds the
  declarations by reading this file, Row.test.js's way.
-->
<script>
  import ProseHTML from "../../lib/render/ProseHTML.svelte";

  /** @type {{ doc?: any, cacheKey?: string }} */
  let { doc, cacheKey } = $props();
</script>

<ProseHTML {doc} {cacheKey} class="shell-static-prose" />

<style>
  :global(.shell-static-prose ul[data-list]) {
    list-style: none;
    padding: 0;
    margin: 4px 0;
    counter-reset: list-counter;
  }

  :global(.shell-static-prose ul[data-list] > li) {
    display: grid;
    grid-template-columns: 22px 1fr;
    align-items: baseline;
    column-gap: 8px;
    margin: 2px 0;
    line-height: 1.6;
    font-size: 0.9375em;
  }

  /* The content column. The editor's NodeView has one div here; the
     static render has the item's children directly, so each of them takes
     the column the div would have — the label alone stays in the first. */
  :global(.shell-static-prose ul[data-list] > li > *) {
    grid-column: 2;
    min-width: 0;
  }

  /* Bullet marker */
  :global(.shell-static-prose ul[data-list] > li[data-marker="bullet"]::before) {
    content: "•";
    font-family: "DM Mono", monospace;
    color: var(--ink);
    opacity: 0.65;
    text-align: center;
  }

  /* Ordered marker — counter advances only on ordered items */
  :global(.shell-static-prose ul[data-list] > li[data-marker="ordered"]) {
    counter-increment: list-counter;
  }
  :global(.shell-static-prose ul[data-list] > li[data-marker="ordered"]::before) {
    content: counter(list-counter) ".";
    font-family: "DM Mono", monospace;
    font-size: 0.85em;
    color: var(--ink);
    opacity: 0.65;
    text-align: right;
    padding-right: 2px;
  }

  /* Plain marker — the pseudo-element holds the column with no glyph */
  :global(.shell-static-prose ul[data-list] > li[data-marker="plain"]::before) {
    content: "";
  }

  /* Task marker — the <label><input type=checkbox></label> chrome that
     renderHTML emits takes the marker column, and takes no tap. */
  :global(.shell-static-prose ul[data-list] > li[data-marker="task"] > label) {
    grid-column: 1;
    user-select: none;
    -webkit-user-select: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  :global(.shell-static-prose ul[data-list] > li[data-marker="task"] > label input[type="checkbox"]) {
    accent-color: var(--warm-accent);
  }
  :global(.shell-static-prose ul[data-list] > li[data-marker="task"][data-checked="true"] > div > p) {
    text-decoration: line-through;
    opacity: 0.5;
  }
</style>
