<!--
  The title of the thing on screen, set under the bar in the writer's own
  face: a pin's first line on the pin view, the day's focus line on the
  reading view.

  The desktop's `.modal-title-input` (PinArtifactModal) and `.pv-matters`
  (ThreadPageView) are both Lora at a size above the body, and both sit
  under the window's chrome rather than in it — the chrome names the
  screen, the title names the subject. The shell's NavBar keeps a one-line
  title for the screen; this is the subject's, and it is allowed to wrap.

  A PRIMITIVE, NOT A SHARED STYLESHEET. Two screens need this rule and a
  scoped Svelte style cannot be shared between components without
  `:global`, so the choice was one file both import or one rule in each.
  One file, for the reason Eyebrow, Note and Chip are one file: the pass's
  gate says no font-family on a title outside src/shell/ui/**, and a copy
  in each screen is exactly the drift that gate exists to end.

  An h1, so a reader moving by headings lands on the subject first; the
  weight is set to 400 on purpose (Eyebrow's argument — the UA bolds a
  heading, and a title in Lora reads as a heading by its size alone).
-->
<script>
  /** @type {{ children: import("svelte").Snippet }} */
  let { children } = $props();
</script>

<h1 class="shell-title">{@render children()}</h1>

<style>
  .shell-title {
    margin: var(--space-3) var(--space-4) var(--space-1);
    color: var(--ink);
    font-family: var(--font-prose);
    font-size: var(--text-xl);
    font-weight: 400;
    line-height: var(--leading-xl);
    /* A pin's title is the writer's own sentence and can run long; a
       focus line can too. It wraps at the band's edge rather than
       pushing the screen sideways, and a single long word breaks. */
    overflow-wrap: anywhere;
  }
</style>
