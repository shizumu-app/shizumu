<!--
  A title the writer types: the page's focus line, a pin's name.

  Not a Field. Field is a control in the chrome — boxed, hairlined, with a
  clear glyph — and what it holds is a query, a trail's name, a passphrase.
  This is the SUBJECT'S own line, sitting where Title puts a title (under
  the bar, in the prose face, a step above the body) and typed in place.
  The desktop draws both of its titles this way: WhatMattersNow's input
  has no border and no background, and PinArtifactModal's
  `.modal-title-input` is the same idea over a pin. A box around either
  would make the title read as a form.

  ── ONE FILE, TWO SCREENS ─────────────────────────────────────────────

  The page's focus line and the pin screen's title are the same control
  and used to be two: PageScreen carried the one font-family exemption
  for its `.ps-wmn`, and the pin editor sheet put the name in a Field.
  Title.svelte's argument applies unchanged — the pass's gate puts every
  font-family on a title inside src/shell/ui/**, and a copy in each screen
  is the drift that gate ends.

  ── WHEN IT WRITES ────────────────────────────────────────────────────

  `onCommit(text)` fires on blur and on Enter, with the field's text as
  typed; whether that text is a CHANGE is not decided here. focus-line.js
  (`focusLineWrite`) holds that rule for the page and the host applies it;
  a blur is not an edit, and this component does not know what the row
  says. `onEnter` fires after an Enter's commit, so the page can hand the
  caret to the prose the way the desktop's WhatMattersNow does — the
  title is the first thing typed on a fresh page and the writing is the
  second, and Enter is the way down.

  Enter blurs the input BEFORE committing, in the desktop's order and for
  its reason: "without this, ProseMirror's view.focus() can race the
  input's own keydown→keyup cycle and the caret never lands in the
  editor." The blur fires `onCommit` through the blur handler; the keydown
  handler then only calls `onEnter`, so one Enter is one commit.

  ── THE 16px FLOOR ────────────────────────────────────────────────────

  Field's rule, kept here for Field's reason: an input under 16px makes
  mobile Safari zoom the viewport on focus, and every fixed surface is the
  wrong size until a pinch. The host chooses the size (`--title-field-size`
  on a wrapper) and this file max()'s it against the floor rather than
  trusting it — --text-base is 1rem, which at the phone's --ui-scale lands
  under 16px.

  `value` is $bindable for Field's reason: the component is the one
  source of what the input holds, so a host that binds never sees the DOM
  and the prop disagree.
-->
<script>
  /** @type {{
    label: string,
    value?: string,
    placeholder?: string,
    tone?: "ink" | "accent",
    onCommit?: ((text: string) => void) | null,
    onEnter?: (() => void) | null,
  }} */
  let {
    label,
    value = $bindable(""),
    placeholder = "",
    // Which of the desktop's two titles this is — see the style block.
    // `ink` is the pin's name; `accent` is the page's focus line.
    tone = "ink",
    onCommit = null,
    onEnter = null,
  } = $props();

  function handleInput(event) {
    value = event.currentTarget.value;
  }

  function handleBlur() {
    onCommit?.(value);
  }

  function handleKeydown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    // Blur first — the desktop's order (WhatMattersNow.svelte's
    // handleKeydown), and the blur is what commits.
    event.currentTarget.blur();
    onEnter?.();
  }
</script>

<input
  class="shell-title-field"
  data-tone={tone}
  type="text"
  aria-label={label}
  {placeholder}
  {value}
  spellcheck="false"
  oninput={handleInput}
  onblur={handleBlur}
  onkeydown={handleKeydown}
/>

<style>
  .shell-title-field {
    display: block;
    width: 100%;
    /* Title.svelte's box, so the typed line sits exactly where a set one
       would. The host may override the inset — PageScreen does, to the
       canvas's gutter column — through the wrapper it places this in. */
    box-sizing: border-box;
    min-height: var(--tap);
    margin: 0;
    padding: var(--space-2) 0;
    border: none;
    border-radius: 0;
    outline: none;
    background: none;
    color: var(--ink);
    font-family: var(--font-prose);
    /* ITALIC, LIKE BOTH OF THE DESKTOP'S TITLES — WhatMattersNow's input
       and PinArtifactModal's `.modal-title-input` are each Lora italic.
       The fourth device pass photographed a focus line in upright ink
       directly over the prose it names, where the two read as one
       paragraph broken in half; the slant is what says this line is
       ABOUT the writing rather than part of it. */
    font-style: italic;
    /* The host names the size through --title-field-size on any wrapper
       (the page leaves it at --text-base, a step under the prose it sits
       over; the pin screen sets Title's --text-xl); the floor applies to
       either. `max()` rather than trusting the token: --text-base is 1rem
       and lands under 16px at the phone's --ui-scale. */
    font-size: max(var(--title-field-size, var(--text-base)), var(--text-input));
    line-height: var(--leading-base);
    /* A long title scrolls inside the input while focused and clips with
       an ellipsis when not — WhatMattersNow's own call, made after a 360px
       store screenshot hard-cut a glyph. */
    text-overflow: ellipsis;
  }

  /* THE ACCENT IS THE FOCUS LINE'S ALONE, and the desktop draws the same
     line: `.filled .what-matters-input` takes --warm-accent once there is
     something in it, while the pin modal's title stays ink. So the tone
     is the host's to name, and only when the field HOLDS something —
     an empty field showing its placeholder is the interface asking, not
     the writer answering. */
  .shell-title-field[data-tone="accent"]:not(:placeholder-shown) {
    color: var(--warm-accent);
  }

  .shell-title-field::placeholder {
    color: var(--ink-soft);
    opacity: var(--ink-tertiary);
    font-style: italic;
  }
</style>
