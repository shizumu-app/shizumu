<!--
  Sync setup: level 3 of the sync stack, beside the pair screen, and the
  one path a phone with no other device has.

  ── ONE SCREEN, THREE STEPS ───────────────────────────────────────────

  `phrase` → `relay` → `done`, the desktop wizard's own order, on one
  `kind` in the host's push list rather than one screen per step. The
  three steps share everything that matters — the phrase, the relay
  choice, the label, the error sentence, the working flag — and a
  screen per step would put that state across three snippets and three
  pushes with the phrase travelling between them. Worse, it would put a
  step change on the STACK: backing out of the relay step to change one
  word of the phrase would be a pop, and a popped screen is gone, words
  and all. Here the step is a prop, the phrase stays where it was typed,
  and `change the phrase` is a row that sets the step back.

  ── THE NAV BAR'S BACK ALWAYS LEAVES ──────────────────────────────────

  Every door out of a pushed screen — the bar's button, the edge drag,
  the Android system button, a tab tap — converges on the host's
  `popScreen`, and this screen does not make one of them mean "previous
  step" while the others mean "leave". The desktop's `back` button on the
  relay step is `change the phrase` here, a row on the screen, so that a
  writer who has read the sentence "check the words" has a way back to
  the words that costs nothing they typed. `later` on the done step is
  the same shape: an act on the screen, not a second meaning for back.

  ── THE PRIMARY ACTION SITS IN THE CONTENT, NOT THE SLOT ──────────────

  `PrimaryAction` is the bottom slot's renderer for the gates, where it is
  the only control on the screen. A pushed screen has no slot (toolbarFor
  answers `none` under a push), and a step of this wizard is a short form
  whose one act belongs at the form's end, scrolling with it, under the
  fields it acts on. So the filled button is rendered inline — it is a
  div, and it carries its own floor — and the shell's slot machinery is
  not taught a new strip for one screen.

  ── WHAT IS TRANSCRIBED IS MONO AND WRAPS ─────────────────────────────

  The generated phrase and the hosted relay's name are strings to be
  copied down, not sentences to read, and they keep the pair screen's
  rule for its code: interface face, large, free to wrap, never
  ellipsised. The rule is restated here rather than shared because the
  two screens' styles are scoped, and a shared class would be a third
  file for one declaration.

  ── SCREENS RENDER; THEY DO NOT DECIDE ────────────────────────────────

  Every branch below reads a prop or asks sync-setup-model.js. Which
  step comes next, whether the typed phrase may go on, which url the
  choice means, which command connects, and what a failure says are all
  the host's and the model's — this file holds no `if` that a test
  cannot reach through the module.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import Row from "./ui/Row.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Note from "./ui/Note.svelte";
  import Field from "./ui/Field.svelte";
  import Segment from "./ui/Segment.svelte";
  import Eyebrow from "./ui/Eyebrow.svelte";
  import PrimaryAction from "./ui/PrimaryAction.svelte";
  import { syncStateLabel } from "./sync-model.js";
  import {
    CHANGE_THE_PHRASE,
    COPY_THE_PHRASE,
    DEFAULT_DEVICE_LABEL,
    HOSTED_RELAY_URL,
    LABEL_FIELD,
    LATER,
    PHRASE_FIELD,
    PHRASE_MODES,
    PHRASE_PLACEHOLDER,
    RELAY_FIELD,
    RELAY_PLACEHOLDER,
    SYNCS_TO,
    hostedRelayName,
    relayChoices,
    setupPrompt,
  } from "./sync-setup-model.js";

  /** @type {{
    step?: "phrase" | "relay" | "done",
    mode?: "generate" | "existing",
    phrase?: string,
    typed?: string,
    relayChoice?: "hosted" | "self",
    relayUrl?: string,
    label?: string,
    working?: boolean,
    error?: string,
    status?: object | null,
    onBack?: (() => void) | null,
    onMode?: ((mode: string) => void) | null,
    onTyped?: ((text: string) => void) | null,
    onCopy?: (() => void) | null,
    onNext?: (() => void) | null,
    onChangePhrase?: (() => void) | null,
    onRelayChoice?: ((choice: string) => void) | null,
    onRelayUrl?: ((url: string) => void) | null,
    onLabel?: ((label: string) => void) | null,
    onConnect?: (() => void) | null,
    onEnable?: (() => void) | null,
    onLater?: (() => void) | null,
  }} */
  let {
    step = "phrase",
    mode = "generate",
    phrase = "",
    typed = "",
    relayChoice = "hosted",
    relayUrl = "",
    label = "",
    working = false,
    error = "",
    status = null,
    onBack = null,
    onMode = null,
    onTyped = null,
    onCopy = null,
    onNext = null,
    onChangePhrase = null,
    onRelayChoice = null,
    onRelayUrl = null,
    onLabel = null,
    onConnect = null,
    onEnable = null,
    onLater = null,
  } = $props();

  const choices = relayChoices();
  const hosted = $derived(relayChoice === "hosted" && Boolean(HOSTED_RELAY_URL));
  const phrasePrompt = $derived(
    working && mode === "generate" && !phrase
      ? setupPrompt("phrase:working")
      : setupPrompt(`phrase:${mode}`),
  );
</script>

<Screen>
  {#snippet nav()}
    <NavBar title="set up" {onBack} />
  {/snippet}

  {#if step === "phrase"}
    <Segment
      options={PHRASE_MODES}
      value={mode}
      onChange={(next) => onMode?.(next)}
      ariaLabel="which phrase"
    />
    <Note>{phrasePrompt}</Note>

    {#if mode === "generate"}
      <!-- The words, or nothing: a phrase that failed to generate is the
           warm note below, not an empty box the writer might copy. -->
      {#if phrase}
        <p class="setup-words">{phrase}</p>
        <RowGroup flush>
          <Row label={COPY_THE_PHRASE} kind="action" onSelect={onCopy ? () => onCopy() : null} />
        </RowGroup>
      {/if}
    {:else}
      <!-- One multiline field, the phrase as words with spaces. Not an
           input per word: `Field` strips nothing from a textarea, and
           the model lowercases and collapses whatever the keyboard did
           before the count. -->
      <Field
        label={PHRASE_FIELD}
        placeholder={PHRASE_PLACEHOLDER}
        multiline
        value={typed}
        onInput={(next) => onTyped?.(next)}
      />
    {/if}

    {#if error}
      <Note tone="warm">{error}</Note>
    {/if}
    <PrimaryAction id="setup-next" disabled={working} onPress={() => onNext?.()} />
  {/if}

  {#if step === "relay"}
    <Note>{setupPrompt("relay")}</Note>
    {#if choices.length > 1}
      <Segment
        options={choices}
        value={relayChoice}
        onChange={(next) => onRelayChoice?.(next)}
        ariaLabel="relay"
      />
    {/if}

    {#if hosted}
      <Note>{setupPrompt("relay:hosted")}</Note>
      <!-- Named even though it is not editable — the desktop's reason:
           "where does this go" is the first question worth answering,
           and hiding it behind the easy path is how a sync toggle stops
           feeling trustworthy. -->
      <Eyebrow label={SYNCS_TO} />
      <p class="setup-words">{hostedRelayName()}</p>
    {:else}
      <Note>{setupPrompt("relay:self")}</Note>
      <Field
        label={RELAY_FIELD}
        placeholder={RELAY_PLACEHOLDER}
        value={relayUrl}
        onInput={(next) => onRelayUrl?.(next)}
      />
    {/if}

    <Field
      label={LABEL_FIELD}
      placeholder={DEFAULT_DEVICE_LABEL}
      value={label}
      onInput={(next) => onLabel?.(next)}
    />

    {#if working}
      <Note>{setupPrompt("relay:working")}</Note>
    {/if}
    {#if error}
      <Note tone="warm">{error}</Note>
    {/if}
    <PrimaryAction id="setup-connect" disabled={working} onPress={() => onConnect?.()} />
    <RowGroup flush>
      <Row
        label={CHANGE_THE_PHRASE}
        kind="action"
        onSelect={onChangePhrase ? () => onChangePhrase() : null}
      />
    </RowGroup>
  {/if}

  {#if step === "done"}
    <!-- The same inert state row the devices screen draws: `off`, because
         enrolling does not start the worker. `turn on` does, and pops to
         the devices screen, where the same row reads `on` — the writer
         sees the word change rather than being told it did. -->
    <RowGroup eyebrow="status">
      <Row label="sync" value={syncStateLabel(status)} />
    </RowGroup>
    <Note>{working ? setupPrompt("done:working") : setupPrompt("done")}</Note>
    {#if error}
      <Note tone="warm">{error}</Note>
    {/if}
    <PrimaryAction id="setup-turn-on" disabled={working} onPress={() => onEnable?.()} />
    <RowGroup flush>
      <Row label={LATER} kind="action" onSelect={onLater ? () => onLater() : null} />
    </RowGroup>
  {/if}
</Screen>

<style>
  /* The pair screen's rule for its code, restated — see the header. */
  .setup-words {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    font-family: var(--font-ui);
    font-size: var(--text-lg);
    line-height: var(--leading-lg);
    color: var(--ink);
    overflow-wrap: break-word;
  }
</style>
