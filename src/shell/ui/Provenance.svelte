<!--
  One line of facts under a title, in the interface face: where a pin or
  a page came from and when — `from the book · kept today`, `the book ·
  written yesterday · edited today`. The desktop's `.modal-provenance`
  (PinArtifactModal), as a shell primitive.

  What the line SAYS is provenance.js's decision (`pinProvenance`,
  `readingProvenance`, and the date words under them); this file owns only
  the face. Mono, because it is a label the interface applies rather than
  a sentence the writer wrote — the type roles give mono to what names and
  prose to what is read — and --text-xs at --ink-soft because it is a
  caption to the title, not a second title.

  A primitive rather than a rule in each screen, for Title.svelte's reason:
  two screens draw it, a scoped style cannot be shared, and the pass's
  gate puts every font-family on a label inside src/shell/ui/**.

  A <p>, inert, no role: it is never a control. Pin rows that used to
  carry these facts were inert too, but they were ROWS — 44px tall,
  ruled, in the column where the taps are — and a fact dressed as a row
  is a control that does nothing. This is a line of text.
-->
<script>
  /** @type {{ children: import("svelte").Snippet }} */
  let { children } = $props();
</script>

<p class="shell-provenance">{@render children()}</p>

<style>
  .shell-provenance {
    margin: 0 var(--space-4) var(--space-3);
    color: var(--ink-soft);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    line-height: var(--leading-xs);
    /* A trail name is the writer's own and can be long; the line wraps
       at the separators rather than leaving the band. */
    overflow-wrap: anywhere;
  }
</style>
