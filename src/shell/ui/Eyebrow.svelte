<!--
  A small mono label above a group: the name of the group, said once,
  above the surface that holds it.

  It is the style Gallery.svelte drew for its own section labels,
  promoted to a primitive because three screens were drawing it by hand
  — settings' groups, memory's date headings, the filter sheet's "date"
  and "sort" — each a few declarations apart from the others. One file
  now owns the face, the size, the tracking and the inset; RowGroup renders
  it above its body, and a screen that needs a heading over anything else
  renders it directly.

  An h3, so a reader moving by headings lands on each group's name.
  The weight is set to 400 on purpose: an h3 is bold by the browser's
  default, and every heading the shell draws in this role today is a
  plain div at the regular weight — promoting them to a real heading
  must not embolden them.
-->
<script>
  /** @type {{ label: string }} */
  let { label } = $props();
</script>

<h3 class="shell-eyebrow">{label}</h3>

<style>
  .shell-eyebrow {
    margin: 0 var(--space-4) var(--space-1);
    color: var(--ink-soft);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 400;
    line-height: var(--leading-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
</style>
