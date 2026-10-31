<!--
  A control that cannot take focus away from the editor.

  Acting on `click` means the browser has already moved focus by the time
  the handler runs, so the editor's selection is gone and the command
  applies to nothing. The desktop tree's answer was to reason about
  getting focus back — shouldDismissOnBlur, isAffordanceTarget, a blur
  that had to ask whether the thing being tapped was one of its own
  affordances. Acting on pointerdown and calling preventDefault means the
  focus never moves in the first place, and none of that reasoning has to
  exist in the shell.

  There is no click handler at all, and that absence is what stops the
  double fire: a real tap fires pointerdown AND click, and if both were
  wired to press(), every command would apply twice.

  ── EXCEPT WHEN THERE IS NO EDITOR TO PROTECT ────────────────────────

  All of the above is about a control sitting beside live text. A control
  that is NOT — a gate's one button, a setup wizard's — has no selection to
  keep, and acting on pointerdown there is not free: the press dismisses
  the surface, whatever mounts in its place lands under the still-pressed
  finger, and the click that follows goes to THAT. Onboarding shipped it.
  Tapping `begin` left a brand-new writer on an empty memory list instead
  of the page, because the tab bar mounts into the band the button vacated.

  Measured on an SM-A065F rather than argued. The same four taps, with only
  the last one moved along the full-width button, land on two screens:

      begin tapped at its CENTRE  ->  memory, no editor
      begin tapped at its LEFT    ->  page, editor mounted

  The landing screen follows the X of the final tap, which is the proof
  that nothing about onboarding chose it. The gesture did.

  So `activateOn` exists, and it defaults to the safe-for-editors choice.
  A caller outside the editor passes "click" and gets the ordinary
  behaviour: one event, fired at lift, on the element the finger is still
  over. PrimaryAction is the only caller that does, and it is used on
  exactly the surfaces that have no editor — see its header.
-->
<script>
  /** @type {{
    label: string,
    onPress?: () => void,
    disabled?: boolean,
    active?: boolean,
    id?: string | null,
    activateOn?: "pointerdown" | "click",
    children?: import("svelte").Snippet,
  }} */
  let {
    label,
    onPress,
    disabled = false,
    active = false,
    id = null,
    activateOn = "pointerdown",
    children
  } = $props();

  function press(event) {
    // preventDefault is what keeps the editor's selection alive; it must
    // happen even when disabled, or a disabled control still blurs. On the
    // click path there is no focus to protect and nothing to suppress.
    if (activateOn === "pointerdown") event.preventDefault();
    if (disabled) return;
    onPress?.();
  }
</script>

<button
  class="shell-toolbar-button"
  class:active
  type="button"
  data-button-id={id}
  aria-label={label}
  aria-pressed={active ? "true" : null}
  {disabled}
  onpointerdown={activateOn === "pointerdown" ? press : undefined}
  onclick={activateOn === "click" ? press : undefined}
>
  {#if children}{@render children()}{:else}{label}{/if}
</button>

<style>
  .shell-toolbar-button {
    /* min-width sizes the TAP TARGET; padding separates the LABEL. Two
       jobs, and for two phases this rule did only the first — so any
       label wider than 44px ran straight into its neighbour with no gap
       at all. Three recorded defects, one cause: the suggestion strip
       read "heading 1heading 2heading 3", one string across three tap
       targets; the find strip ran "1 of 1" into "previous"; and P2d's
       block strip rested scrolled with its first label reading "urn
       into". Every model assertion passed over all three — right ids,
       right order, none dead, nothing overflowing its box — because none
       of them can see two words touching. Only the photograph could.

       Padding on the control rather than a `gap` on each strip: the
       space belongs to the button, so a strip that never sets one cannot
       forget it, and the widened box IS the tap target rather than dead
       space beside it. Short labels are unaffected — min-width already
       exceeds their padded width. */
    min-width: var(--tap);
    min-height: var(--tap);
    padding: 0 var(--space-2);
    flex: 0 0 auto;
    background: none;
    border: none;
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    cursor: pointer;
    touch-action: manipulation;
  }

  /* Visual pass (2026-10-30): the button answers a press with a soft
     tint inside a rounded touch area, the way the rows do. */
  .shell-toolbar-button {
    border-radius: var(--radius-md);
    transition: background-color var(--motion-fast);
  }
  .shell-toolbar-button:not(:disabled):active { background: var(--press-tint); }
  @media (hover: hover) {
    .shell-toolbar-button:not(:disabled):hover { background: var(--hover-tint); }
  }

  .shell-toolbar-button.active {
    color: var(--accent-text);
  }

  .shell-toolbar-button:disabled {
    opacity: var(--ink-tertiary);
    cursor: default;
  }
</style>
