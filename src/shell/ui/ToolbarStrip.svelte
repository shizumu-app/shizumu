<!--
  One row of the bottom slot: whichever strip toolbar-model.js chose.

  The strip takes an already-decided button list rather than calling
  toolbarFor itself, so there is exactly one place that knows which strip
  is showing. Labels come from the model's own TOOLBAR_BUTTON_LABELS map
  for the same reason — a label defined here could drift from the button
  the model actually emits.

  It FITS when it can and scrolls when it cannot. Six controls or fewer
  share the band evenly, with no scroll and no edge mask: a strip that
  fits has nothing off screen for a fade to point at, and a mask over a
  strip that fits dims its first and last control for no reason. Seven or
  more scroll horizontally under the mask, which is what tells the user
  there is more strip than screen. The threshold is six because that is
  the block strip's width after the visual pass's Task 4 (`turn into ·
  bold · italic · insert · pin · undo`); it is decided here from the
  list's length rather than passed in, so no host can hand the strip a
  wide list and a `fits` it does not deserve. ToolbarStrip.test.js holds
  the boundary at six and seven.

  It must never wrap, in either state, since a two-row slot is chrome
  stacking vertically, which §1 forbids outright.
-->
<script>
  import ToolbarButton from "./ToolbarButton.svelte";
  import { TOOLBAR_BUTTON_LABELS } from "../toolbar-model.js";

  /** @type {{
    buttons?: string[],
    onPress?: (id: string) => void,
    activeIds?: string[],
    disabledIds?: string[],
  }} */
  let { buttons = [], onPress, activeIds = [], disabledIds = [] } = $props();
</script>

<!--
  THERE WAS A WAY OUT HERE, a quiet chevron that blurred the field, and it
  is gone on purpose rather than forgotten.

  It existed because this strip used to OWN the slot while the shell
  believed a keyboard was up, and on a Galaxy A34 that belief stuck true
  with the keyboard long gone — so page, memory and settings were
  unreachable until the app restarted, and the chevron was the one control
  that could return them without trusting a measurement.

  The band is two rows now (ShellRoot): this strip sits above a nav row that
  nothing can take away, so there is no lockout left to escape from. What
  remained was a control whose only jobs were dismissing a keyboard the
  system's own back button already dismisses, and clearing a stale belief —
  which goRoot now does on every root switch, with no pixels spent.

  A seventh control earning its place by handling a case that can no longer
  happen is how chrome accumulates. Removed 2026-10-05.
-->
<div class="shell-toolbar-strip" class:fits={buttons.length <= 6} role="toolbar">
  {#each buttons as id (id)}
    <ToolbarButton
      {id}
      label={TOOLBAR_BUTTON_LABELS[id] ?? id}
      active={activeIds.includes(id)}
      disabled={disabledIds.includes(id)}
      onPress={() => onPress?.(id)}
    />
  {/each}
</div>

<style>
  .shell-toolbar-strip {
    display: flex;
    align-items: center;
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    flex-wrap: nowrap;
    scrollbar-width: none;
    /* The edge fade tells the user there is more strip than screen. */
    mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 var(--space-4),
      #000 calc(100% - var(--space-4)),
      transparent 100%
    );
  }

  /* Six or fewer — see the header. Spread evenly, nothing to scroll to,
     nothing for a mask to fade. */
  .shell-toolbar-strip.fits {
    justify-content: space-evenly;
    mask-image: none;
    overflow-x: hidden;
    padding: 0 var(--space-2);
  }
</style>
