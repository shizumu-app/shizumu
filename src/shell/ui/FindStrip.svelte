<!--
  Row 2 of the bottom slot: field · count · prev · next · close.

  WHY THIS IS A SECOND STRIP RENDERER rather than a `field` branch inside
  ToolbarStrip. Both were open (the plan's Known unknowns list it), and the
  argument that decided it is what ToolbarStrip's props would have had to
  become. Today it takes `buttons` and turns each id into a ToolbarButton;
  its whole contract is "ids in, buttons out, labels from one map". Teaching
  it `field` means adding a value, an input callback, an autofocus flag and
  a live match label — five inputs that are inert on the three strips that
  are only buttons, on the renderer every other strip shares. Two of those
  are not even controls: the count is chrome with no id in FIND_STRIP at
  all, so there is nowhere in a `{#each buttons}` for it to go without a
  second find-only prop deciding where it lands.

  The cost of the split is two renderers, and it is paid down where it
  would actually hurt: the ids and their labels still come from
  toolbar-model.js's own map, the order still comes from the `buttons`
  array toolbarFor emitted, and the three buttons are still ToolbarButtons,
  so the pointerdown+preventDefault rule that keeps the editor's selection
  alive is not re-derived here. What this file adds is only the shape a
  field needs and a button does not.

  THE FIELD AUTOFOCUSES, and that is load-bearing rather than polite. Find
  is opened from the page header, which is reachable with the keyboard
  DOWN — that is the point of putting it there — and the strip only exists
  in the slot while the slot is modal. A find mode whose field never takes
  focus is a strip you cannot type into, whose only exit is `close`. The
  focus goes through Field's `autofocus`, which routes to focusField (one
  rAF focus per element per open-cycle), and the keyboard rises as a
  consequence of the field existing. It is hardcoded here rather than
  taken as a prop because mounting this component IS opening find: there
  is no caller for whom the answer is false, and a prop would be a way to
  forget it.

  The count is `aria-live` because it is the only feedback a search gives:
  the highlights are on the page behind the keyboard, so on a phone the
  sentence beside the field is often the whole answer.
-->
<script>
  import Field from "./Field.svelte";
  import ToolbarButton from "./ToolbarButton.svelte";
  import { TOOLBAR_BUTTON_LABELS } from "../toolbar-model.js";

  /** @type {{
    buttons?: string[],
    label?: string,
    disabledIds?: string[],
    onQuery?: (value: string) => void,
    onPress?: (id: string) => void,
  }} */
  let { buttons = [], label = "", disabledIds = [], onQuery, onPress } = $props();
</script>

<div class="shell-find-strip" role="search">
  {#each buttons as id (id)}
    {#if id === "field"}
      <div class="shell-find-field">
        <Field
          label={TOOLBAR_BUTTON_LABELS[id] ?? id}
          placeholder={TOOLBAR_BUTTON_LABELS[id] ?? id}
          autofocus
          onInput={(value) => onQuery?.(value)}
        />
      </div>
      <!--
        Rendered inside the `field` branch, not appended after the loop:
        the count belongs to the field the way a caption belongs to a
        photo, and putting it here keeps its position tied to the id it
        describes rather than to the length of the button list.

        Deliberately NOT gated on `disabledIds` — findStripModel never
        disables `field`, and a field that could go dead is a query the
        user cannot correct out of.
      -->
      <span class="shell-find-count" aria-live="polite">{label}</span>
    {:else}
      <ToolbarButton
        {id}
        label={TOOLBAR_BUTTON_LABELS[id] ?? id}
        disabled={disabledIds.includes(id)}
        onPress={() => onPress?.(id)}
      />
    {/if}
  {/each}
</div>

<style>
  .shell-find-strip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    padding: 0 var(--space-2);
    /* No horizontal scroll, unlike the block strip: four controls fit at
       412px, and a field that scrolled out of the strip would take the
       only typable thing in the mode off screen. The field absorbs the
       width instead — see .shell-find-field. */
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .shell-find-field {
    flex: 1 1 auto;
    min-width: 0;
  }

  .shell-find-count {
    flex: 0 0 auto;
    color: var(--ink-soft);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    white-space: nowrap;
  }
</style>
