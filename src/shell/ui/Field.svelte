<!--
  A text field sized so the phone does not fight it.

  16px is not a taste choice: mobile Safari zooms the viewport whenever a
  focused input's font-size is below 16px, and once it has zoomed, every
  fixed element on the screen is the wrong size until the user pinches
  back. The 44px minimum is the same floor every control in this tree
  carries.

  Focus goes through focusField (src/lib/focus-field.js:10), which is
  idempotent per element per open-cycle — calling it twice on the same
  field does nothing the second time, which is what stops a re-render from
  stealing the caret back mid-typing.

  The clear control composes ToolbarButton rather than a raw button
  element: it is not on the rules test's button allowlist, and ToolbarButton's
  pointerdown+preventDefault is exactly the behaviour a field's clear
  control wants — tap clear, the field keeps focus, the user keeps typing.
  A clear button that blurs the field it just cleared is a real annoyance;
  the primitive that prevents it already exists, so this is composition,
  not a workaround.

  IT READS AS A FIELD NOW, and that is a fix rather than a polish. P2f-2's
  photographs found `title (optional)` reading as a HEADING at the top of
  the chart sheet: this component's only visual claim to being an input was
  `background: var(--surface)`, and at cream that tone is within a few
  percent of the sheet's own — so a field on a sheet looked like a line of
  text with a caret nobody expected. The hairline below is --hairline, the
  token for what contains (a folded nav bar's edge; at the time, the line
  under every Row as well), so the fix introduced no new colour and no new
  idea, and it holds at every canvas tone rather than at the two where the
  tones happened to differ. The pin editor sheet (P3 Task 2) is a
  field-first surface, so it is where inheriting that defect would have
  cost the most.

  `multiline` renders a <textarea> instead, and it is not a styling choice:
  an <input type="text"> runs the HTML value sanitization algorithm, which
  STRIPS every CR and LF from whatever is assigned to it. A three-line note
  pin put into one comes back with its lines run together and no separator
  at all, and a save writes that back over the writing the pin kept. jsdom
  implements the same rule, which is what makes the regression provable in
  Field.test.js rather than only on a device.

  The clear control is NOT rendered on a multiline field. On a search box a
  one-tap clear is a convenience; on a note pin's body it is a one-tap wipe
  of kept writing, sitting under the writer's thumb with no undo in the
  sheet. The desktop's own note textarea (PinNoteModal) offers none either.

  WHAT IS TYPED IS PROSE. The input is set in --font-prose, not the
  interface face: what goes into a field is the writer's — a search, a
  trail's name, a note pin's body, a passphrase — and it is read back the
  way the page is read. The shell's type roles give the interface face to
  what names a control and prose to what the writer wrote, and a field is
  the second kind even though it sits in the chrome. The label is not
  drawn at all (it is the aria-label), and the clear glyph is a
  ToolbarButton, which keeps its own face. The 16px floor is unchanged by
  this: `var(--text-input)` stays on the input, held by the rules test.

  All four states — empty, with a value, multiline, secure — are drawn in
  Gallery.svelte since the visual pass's Task 10; the last two were owed
  from P3 until every shell baseline was reborn under one cause.

  `value` is $bindable — this component is the single source of truth for
  what the input holds. Typing and clear() both write here, so a host that
  never echoes `onInput` back into a `value` prop still sees the clear
  affordance appear and disappear correctly, and a host that does bind it
  never sees the DOM and the prop disagree (they used to: clear() wrote
  straight to inputEl.value while the clear affordance was gated on the
  value prop, which a passive host never updated).
-->
<script>
  import { focusField } from "../../lib/focus-field.js";
  import ToolbarButton from "./ToolbarButton.svelte";

  /** @type {{
    label: string,
    value?: string,
    placeholder?: string,
    autofocus?: boolean,
    multiline?: boolean,
    secure?: boolean,
    onInput?: (value: string) => void,
  }} */
  let {
    label,
    value = $bindable(""),
    placeholder = "",
    autofocus = false,
    multiline = false,
    // A passphrase field, and the only caller is the lock gate. It changes
    // the input's `type` and nothing else — the 16px floor, the tap floor,
    // the hairline and the clear control all still apply, which is the
    // whole point of it being this component rather than a bare <input>
    // the gate declares its own sizing for.
    //
    // A DYNAMIC `type` IS ONLY LEGAL BECAUSE THIS INPUT IS NOT `bind:value`
    // — Svelte refuses `bind:value` on an input whose type it cannot see at
    // compile time. The value is set as a plain attribute and read back
    // through `oninput` (see handleInput), which is the arrangement this
    // component already had for its own reasons.
    //
    // Ignored by `multiline`: a <textarea> has no type, and a masked
    // multi-line field is not a thing any caller has asked for.
    secure = false,
    onInput,
    // Enter on a single-line field, with what it holds. Null for every
    // field that has no "first match" to run — the trail name, the pin
    // title, the passphrase (the lock gate's unlock is a strip button and
    // Enter there is its own concern). The insert sheet's finder is the
    // caller: type "tab", Enter, and the table builder opens without a
    // second tap on a row the keyboard half-covers. Not on a textarea,
    // where Enter is a line.
    onSubmit = null,
  } = $props();

  let inputEl = $state(null);

  $effect(() => {
    if (autofocus && inputEl) focusField(inputEl);
  });

  function handleInput(event) {
    value = event.currentTarget.value;
    onInput?.(value);
  }

  function clear() {
    value = "";
    onInput?.("");
  }

  function handleKeydown(event) {
    if (!onSubmit || event.key !== "Enter") return;
    event.preventDefault();
    onSubmit(value);
  }
</script>

<div class="shell-field" class:multiline>
  {#if multiline}
    <textarea
      class="shell-field-input shell-field-area"
      bind:this={inputEl}
      aria-label={label}
      {placeholder}
      {value}
      oninput={handleInput}
    ></textarea>
  {:else}
    <input
      class="shell-field-input"
      bind:this={inputEl}
      type={secure ? "password" : "text"}
      autocomplete={secure ? "current-password" : null}
      spellcheck={secure ? "false" : null}
      aria-label={label}
      {placeholder}
      {value}
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
    {#if value}
      <ToolbarButton label="clear" onPress={clear}>×</ToolbarButton>
    {/if}
  {/if}
</div>

<style>
  .shell-field {
    display: flex;
    align-items: center;
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface);
    /* The heading-vs-field fix — see the header. --hairline is the token
       for what CONTAINS — this border, a folded nav bar's edge. (It was
       also the line between rows until the visual pass's Task 2; that
       line is RowGroup's now and one step softer, --hairline-soft, since
       a group's surface already does the containing.) */
    border: 1px solid var(--hairline);
  }

  /* A textarea grows downward, so the row centring that suits one line
     would float a three-line note in the middle of its own box. */
  .shell-field.multiline {
    align-items: stretch;
    padding: var(--space-2) var(--space-3);
  }

  .shell-field-area {
    /* Three tap-heights, which is the note the sheet was given full detent
       for. Not `rows`, which is a character-grid unit that ignores the
       phone's --ui-scale. */
    min-height: calc(var(--tap) * 3);
    /* The sheet's height is the detent's; a drag handle that could grow the
       field past it would push the save row off the bottom. */
    resize: none;
  }

  .shell-field-input {
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--tap);
    background: none;
    border: none;
    color: var(--ink);
    /* Prose: what is typed is the writer's — see the header. */
    font-family: var(--font-prose);
    /* var(--text-input) — see the header. --text-base alone is 1rem, which
       is 14px at the phone's default --ui-scale, under the 16px floor this
       component's own header promises. */
    font-size: var(--text-input);
    line-height: var(--leading-base);
  }

  .shell-field-input:focus { outline: none; box-shadow: none; }
  /* The field's border is its focus mark: the accent while you type in it,
     where nothing showed before (visual pass, 2026-10-30). */
  .shell-field {
    transition: border-color var(--motion-fast);
  }
  .shell-field:focus-within {
    border-color: var(--warm-accent);
  }

  /* Restyle the composed ToolbarButton to read as the field's own clear
     glyph rather than a toolbar icon: softer colour, larger glyph. */
  .shell-field :global(.shell-toolbar-button) {
    color: var(--ink-soft);
    font-size: var(--text-lg);
  }
</style>
