<!--
  Row 4 of the bottom slot: the slash menu, laid flat as chips.

  WHY A THIRD RENDERER rather than ToolbarStrip with the chip titles fed
  through it. ToolbarStrip would very nearly work — a chip IS a button, so
  FindStrip's argument (a text field is not) does not apply, and its
  `TOOLBAR_BUTTON_LABELS[id] ?? id` fallback would print every title
  correctly today. The `?? id` is exactly the problem. A chip's id is a
  slash-command TITLE, so any title that ever collides with a strip button
  id silently renders that button's label instead of itself; `code` already
  collides (both spell "code", which is why it reads as fine) and the next
  one would not announce itself. Here the label IS the id, with no map to
  fall out of, so the collision cannot happen rather than being caught.

  The second reason is what the chips do NOT take. No `activeIds`: a chip
  is not a toggle, and nothing about it can be "on". No `disabledIds`: no
  chip can be dead, because the list is derived from the same command table
  the tap runs (suggestion-strip-model.js), so a chip exists exactly when
  its command does — the property INSERT_ROWS has for the same reason.
  Passing either through would be two inputs that mean nothing here, and
  ShellApp's `disabledIds` derivation, which reads a strip button id
  against COMMANDS, would mark every one of these permanently dead.

  ToolbarButton is still the control. Its pointerdown+preventDefault is
  what keeps the editor's selection alive, and that matters more on this
  strip than on any other: the chip acts on the `/query` the writer has
  typed, and a tap that blurred the editor would take that query away
  before the command could consume it.
-->
<script>
  import ToolbarButton from "./ToolbarButton.svelte";

  /** @type {{
    chips?: string[],
    labels?: Record<string, string> | null,
    onPick?: (title: string) => void,
  }} */
  // `labels`: what a chip SAYS when its id is not its words. A slash chip's
  // id is its title; a mention chip's id is `page:<id>` or `pin:<id>`, and
  // what it says is the page's or pin's label (mention-chips.js).
  let { chips = [], labels = null, onPick } = $props();
</script>

<div class="shell-suggestion-strip" role="toolbar">
  {#each chips as title (title)}
    <ToolbarButton id={title} label={labels?.[title] ?? title} onPress={() => onPick?.(title)} />
  {/each}
</div>

<style>
  /* The same scroll-and-fade the block strip had before it went to six
     controls and learned to fit (ToolbarStrip's `fits`), kept here for a
     sharper version of the old reason: `/` on its own resolves to every
     command there is, and that list never fits. Repeated rather than
     shared because the alternative was teaching ToolbarStrip a second
     label source (see the header) — the ten lines are the cheaper half of
     that trade. It must never wrap: a two-row slot is chrome stacking
     vertically, which §1 forbids outright. */
  .shell-suggestion-strip {
    display: flex;
    align-items: center;
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    flex-wrap: nowrap;
    scrollbar-width: none;
    mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 var(--space-4),
      #000 calc(100% - var(--space-4)),
      transparent 100%
    );
  }
</style>
