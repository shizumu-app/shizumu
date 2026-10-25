<!--
  The bottom slot's seventh shape: one control, and it is the only one on
  the screen.

  §2 gives onboarding and lock the same three bands every screen has, with
  "nav bar hidden, content centred, bottom slot holds the primary action".
  This is that slot's renderer, and it is a sibling of ToolbarStrip rather
  than a `buttons.length === 1` branch inside it: a strip is a scrolling row
  of peers with a mask fade at both edges, and a fade over the single control
  that gets a user past a lock screen would be reading the wrong thing to
  them entirely.

  It composes ToolbarButton, as Field's clear control does, for the reason
  the rules test's allowlist implies: a bare button element here would opt
  out of the 44px floor silently, and the primitive that carries it already
  exists. (Said without spelling the tag — that scan is a plain substring
  check over every file in src/shell/, so the literal in this comment would
  make this file its first offender. ShellRoot's header records the same
  accepted property: those guards fail closed on prose.)
  ToolbarButton's pointerdown + preventDefault is also right here rather
  than merely harmless — lock's field is focused when the writer reaches for
  this button, and a control that blurred it would drop the soft keyboard
  over the passphrase they just typed.

  ── WHICH IS WHY `activateOn` IS A PROP AND NOT A DECISION MADE HERE ──

  That paragraph is true of LOCK. It is not true of onboarding, which has no
  field, and on onboarding the pointerdown costs a screen: the press
  dismisses the gate, the tab bar mounts into this very band, and the finger
  lifts onto a tab. A new writer tapping `begin` landed on an empty memory
  list — "no writing yet" — instead of the page. Measured on an SM-A065F:
  the same four taps with only the last one moved along the button land on
  `memory` from the centre and `page` from the left end, so the landing
  screen follows the X of the tap and nothing about onboarding chose it.

  So the caller decides, because only the caller knows whether a field is
  focused behind this button. The default stays pointerdown — the choice
  that is safe next to live text — and ShellGate passes "click" for
  onboarding alone.

  LOCK HAS THE SAME SHAPE AND KEEPS pointerdown, deliberately. A successful
  unlock mounts the shell under the finger exactly as the gate does, so the
  hazard is probably there too — but it is UNVERIFIED (reproducing it needs
  a passphrase-locked database on the device, which this pass did not set
  up), and the trade is genuinely different: on lock there is a focused
  field and a soft keyboard to lose, and losing them on a failed attempt is
  a cost onboarding does not have. Changing it on a guess would be trading a
  measured defect for an unmeasured one. It wants its own device pass.

  It takes an ID and reads its label from TOOLBAR_BUTTON_LABELS, exactly as
  ToolbarStrip does. A `label` prop would be the second place a button's
  words could be written, and toolbar-state.js's header records what that
  costs: an id the map does not carry renders as the raw id, silently.

  IT IS A FILLED BUTTON. Until the visual pass it was accent-coloured text
  spanning the band with no fill, and on the lock screen that read as a
  link someone forgot to style rather than the one thing to do. Now the
  composed ToolbarButton is restyled from here into a block of
  --warm-accent with the canvas tone for its label, rounded at
  --radius-md, floored at --tap and stretched across the band. No new
  colour: the accent and the canvas are two tones every theme already
  has, so the fill inverts correctly on cream, white and dark. Disabled
  keeps ToolbarButton's own opacity rule, so a not-yet-ready unlock is
  the same button dimmed rather than a different one.
-->
<script>
  import ToolbarButton from "./ToolbarButton.svelte";
  import { TOOLBAR_BUTTON_LABELS } from "../toolbar-model.js";

  /** @type {{
    id: string,
    disabled?: boolean,
    activateOn?: "pointerdown" | "click",
    onPress?: (id: string) => void,
  }} */
  let { id, disabled = false, activateOn = "pointerdown", onPress } = $props();
</script>

<div class="shell-primary-action">
  <ToolbarButton
    {id}
    {disabled}
    {activateOn}
    label={TOOLBAR_BUTTON_LABELS[id] ?? id}
    onPress={() => onPress?.(id)}
  />
</div>

<style>
  .shell-primary-action {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--space-2) var(--space-4);
  }

  /* The filled button — see the header. It spans the band: `flex: 1 1
     auto` overrides ToolbarButton's own `flex: 0 0 auto`, which is sized
     for a strip of peers, and this is not one. `min-height: var(--tap)`
     is restated here rather than inherited on trust, and
     PrimaryAction.test.js holds it by reading this file: the fill makes
     the button's box visible, so a box that fell under the floor would be
     seen as well as missed. */
  .shell-primary-action :global(.shell-toolbar-button) {
    flex: 1 1 auto;
    min-height: var(--tap);
    background: var(--warm-accent);
    color: var(--canvas-bg);
    border-radius: var(--radius-md);
    font-family: var(--font-ui);
    font-size: var(--text-base);
  }
</style>
