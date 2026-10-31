<!--
  A sentence of explanation under something: a group's caveat, a sheet's
  greeting, the line that says why a field is wrong.

  It is one primitive because five screens were each drawing their own —
  SettingsSectionScreen, SyncDevicesScreen, SyncPairScreen, SyncScanScreen
  and ShellApp's sheet note — a few declarations apart from one another,
  and the visual pass (Tasks 5–6) replaces every one of those rules with
  this file. One place now owns the face, the size, the leading and the
  inset.

  It is set in --font-prose, not the interface face, because it is a
  SENTENCE — words addressed to the writer, read the way a page is read —
  and the shell's type roles give prose to what is read and mono to what
  is operated (a label on a control, a value in a column, an eyebrow).

  `size="base"` is for a sheet's greeting, which is the first thing on
  the surface rather than a caption under one. `tone="warm"` is for an
  error — the wrong-passphrase line under the gate's field — and it is
  --warm-accent rather than a new red because the shell adds no colours;
  warmth beside a field the writer just used is enough to be read as
  "this one".

  A <p>, inert, no role: a note is never a control and never a heading.
-->
<script>
  /** @type {{
    size?: "sm" | "base",
    tone?: "ink" | "warm",
    children: import("svelte").Snippet,
  }} */
  let { size = "sm", tone = "ink", children } = $props();
</script>

<p class="shell-note" data-size={size} data-tone={tone}>{@render children()}</p>

<style>
  .shell-note {
    margin: 0;
    padding: var(--space-2) var(--space-4) var(--space-3);
    color: var(--ink-soft);
    font-family: var(--font-prose);
    font-size: var(--text-sm);
    line-height: var(--leading-base);
  }

  .shell-note[data-size="base"] {
    font-size: var(--text-base);
  }

  .shell-note[data-tone="warm"] {
    color: var(--accent-text);
  }
</style>
