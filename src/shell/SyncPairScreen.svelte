<!--
  Pairing: level 3 of the sync stack, and the only screen that pushes the
  scanner.

  ── ONE SCREEN, TWO SIDES ─────────────────────────────────────────────

  A device already on the account SHOWS a code; a device that is not JOINS
  by reading one. `pairSide` decides which, from `status.configured`, and
  everything on this screen follows from it. Two screens would have been
  the alternative, and it would have been the wrong cut: the two sides
  share the phase machine, the digits, the confirm row and every error
  sentence, and differ only in what fills the middle. One `kind` in the
  host's push list, one snippet, one back.

  ── SENTENCES ARE NOTES, ROWS ARE ACTIONS ─────────────────────────────

  The prompt and the error go through `Note` — the prompt in the note's
  own ink, the error `tone="warm"`, which is the shell's one colour for
  "this one" beside a thing the writer just did. The two rows, `scan a
  code` and `the codes match`, are `kind="action"`: each does something
  and stays on this screen (opens the lens, sends the confirm), and
  neither opens a screen for a chevron to point at. They sit in flush
  groups, the shape the devices screen gives its pair row, so every act in
  the sync stack reads the same way — accent, no chevron, no surface. The
  code and the digits are neither: they keep the large mono rule below,
  because they are read across two devices rather than scanned as labels.

  ── THE DIGITS ARE THE WHOLE SECURITY STORY ───────────────────────────

  A malicious relay can substitute its own ephemeral key, and the only
  thing that catches it is a person comparing the short authentication
  string on both screens (SyncSettings.svelte:697-701 says so at the
  desktop's own confirm). So nothing is exchanged before `verify`, and
  `verify` is a row the reader presses, never a step that advances itself.
  Going back instead of pressing it is the refusal, and it costs nothing:
  the host cancels the exchange when this screen leaves the stack.

  ── A LABEL FIELD ON THE SHOWING SIDE ONLY ────────────────────────────

  Both of the desktop's halves take a device label and only one is read:
  `pair_new_complete` discards its `device_label` argument on the
  new-device side (`let _ = device_label;`, commands.rs:6477 — "the
  existing device sent the label to the relay's pair_finalize"). A field
  on the joining side would write nothing, which is Task 1's own reason
  for dropping a toggle nothing on this tree reads. On the showing side
  the field is the only thing that names the row every other device's list
  will read, so it is here.

  ── NO TYPED-CODE PATH ────────────────────────────────────────────────

  The desktop's joining device can also paste or type the pairing block
  (three fields and `parsePairingInfo`), and it defaults to that rather
  than to the camera. §2 gives the phone the scanner instead, and this
  screen ships only the scanner. The cost is real and is written down
  rather than hidden: with the camera refused or absent, this device
  cannot join from here, and the sentence the scanner shows says what to
  do about the first of those. The desktop keeps the typed path.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import Row from "./ui/Row.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Note from "./ui/Note.svelte";
  import Field from "./ui/Field.svelte";
  import { CODES_MATCH, PAIR_ADDED, PAIR_DONE, SCAN_A_CODE, UNNAMED_NEW_DEVICE, pairDone, pairPrompt } from "./sync-model.js";

  /** @type {{
    side?: "show" | "join",
    phase?: string,
    words?: string,
    qr?: string,
    sas?: string,
    error?: string,
    label?: string,
    onBack?: (() => void) | null,
    onScan?: (() => void) | null,
    onLabel?: ((value: string) => void) | null,
    onConfirm?: (() => void) | null,
    doneDevice?: string,
    doneEnabled?: boolean,
    onDone?: (() => void) | null,
  }} */
  let {
    side = "join",
    phase = "waiting",
    words = "",
    qr = "",
    sas = "",
    error = "",
    label = "",
    onBack = null,
    onScan = null,
    onLabel = null,
    onConfirm = null,
    doneDevice = "",
    doneEnabled = false,
    onDone = null,
  } = $props();

  const finished = $derived(pairDone(side, { label: doneDevice, enabled: doneEnabled }));
  const prompt = $derived(phase === "done" ? finished.line : pairPrompt(side, phase));
</script>

<Screen>
  {#snippet nav()}
    <NavBar title="pair" {onBack} />
  {/snippet}

  {#if prompt}
    <Note>{prompt}</Note>
  {/if}

  {#if phase === "waiting" && side === "show"}
    <!-- The image is a convenience and the words are the contract: the
         other device can read either, and a QR that failed to render (the
         encoder is imported on demand) leaves a code that still works by
         hand. That is why the words are not inside an `{:else}`. -->
    {#if qr}
      <img class="pair-qr" src={qr} alt="pairing code" />
    {/if}
    {#if words}
      <p class="pair-words">{words}</p>
    {/if}
    <Field
      label="a name for the other device"
      placeholder={UNNAMED_NEW_DEVICE}
      value={label}
      onInput={(next) => onLabel?.(next)}
    />
  {/if}

  {#if phase === "waiting" && side === "join"}
    <RowGroup flush>
      <Row label={SCAN_A_CODE} kind="action" onSelect={onScan ? () => onScan() : null} />
    </RowGroup>
  {/if}

  {#if phase === "verify"}
    <p class="pair-sas">{sas}</p>
    <RowGroup flush>
      <Row label={CODES_MATCH} kind="action" onSelect={onConfirm ? () => onConfirm() : null} />
    </RowGroup>
  {/if}

  {#if phase === "done"}
    <!-- The end of a pairing, drawn like the step before it: what was
         added, in its own group, and one act. `done` is an action, not a
         push — it hands back to the sync screen, which now lists the
         device, rather than opening something new. -->
    <RowGroup eyebrow={PAIR_ADDED}>
      <Row label={finished.device} value={finished.value} />
    </RowGroup>
    <RowGroup flush>
      <Row label={PAIR_DONE} kind="action" onSelect={onDone ? () => onDone() : null} />
    </RowGroup>
  {/if}

  {#if error}
    <Note tone="warm">{error}</Note>
  {/if}
</Screen>

<style>
  /* The code, and the digits: monospace, large, and free to WRAP. Both are
     read aloud or compared character by character across two devices held
     side by side, which is the one place in this shell where the interface
     face's tight tracking is the wrong answer. `break-word` rather than an
     ellipsis because a truncated code is a code that cannot be typed —
     Row's value column ellipsises for the opposite reason, and neither of
     these is a Row. Nor is either a Note: a note is a sentence in the
     prose face, and these are strings to be transcribed. */
  .pair-words,
  .pair-sas {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    font-family: var(--font-ui);
    font-size: var(--text-lg);
    line-height: var(--leading-lg);
    color: var(--ink);
    overflow-wrap: break-word;
  }

  /* Centred and capped so a code stays square on a wide phone and still
     fills a narrow one. `height: auto` with `max-width` keeps the aspect
     ratio whatever the encoder produced. */
  .pair-qr {
    display: block;
    width: 100%;
    max-width: 17.5rem;
    height: auto;
    margin: var(--space-4) auto 0;
  }
</style>
