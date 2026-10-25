<!--
  A pin: the writing it kept, edited where it is read, and the way back
  to where it came from.

  ── WHAT CHANGED IN THE SECOND DEVICE PASS, AND WHY ───────────────────

  This screen was a READING surface with three paragraphs on why — a
  static tree over READONLY_EXTENSIONS, no second ProseMirror on the
  phone, "a pin is a frozen snapshot, so a cursor in it would be an offer
  the surface cannot keep". Its way in was a `read` row on the pin row's
  actions sheet, and the sheet's own header called that split "a
  measurement, not a redesign": if reading turned out to be what writers
  came for, the row should open the screen and the actions should move.

  The tester made the measurement twice. First: "click on row opens
  dropdown but how to see the content". Then, with the screen built:
  "pin page detail not well structured and ui clean … pins are not
  editable". So: a pin row pushes this screen; the actions are rows under
  the writing; the title is a field; and the writing is a live editor —
  PinEditor (src/shell/ui/), which is the desktop PinArtifactModal's own
  recipe and its own argument for a second instance beside the page's.
  The frozen-snapshot claim was never about editability: the desktop
  edits its pins in place and calls them snapshots too, because what the
  snapshot is frozen AGAINST is the source page, not the writer.

  ── THE ANATOMY, TOP TO BOTTOM ────────────────────────────────────────

  The bar names the KIND (`pinArtifactHeader`: text, tasks, table, image)
  — the one thing the field under it cannot say. Then TitleField, in
  Title's size (`--title-field-size: var(--text-xl)`), holding the pin's
  own name as the writer can change it; one mono line of provenance
  (`from the book · kept today`, `source removed · cached on friday`,
  `… · changed elsewhere`); the writing; the rows.

  NO CHIP AND NO CARD, both deliberate deletions. The chip named the
  trail, and the provenance line's first words are `from <trail>` — the
  same fact twice, one of them dressed as a control. The card boxed the
  writing in a raised surface, and on a 412px phone a raised box inside a
  screen inside a frame reads as a quote, not as the page the writing
  came from; the desktop's `.modal-editor` is a box because a modal is a
  box. The writing sits on the canvas at the band's inset, which is where
  the page's own prose sits.

  ── THE TWO BODIES ────────────────────────────────────────────────────

  pin-draft.js draws the fork the desktop draws: a NOTE (content that
  really is a string) edits in the multiline Field, newlines intact; an
  ARTIFACT (a doc) mounts PinEditor over `pinArtifactDoc`'s wrapped,
  migrated doc. A pin with nothing readable — no content, or a JSON-shaped
  string that will not parse — shows its empty state and edits only the
  title; pin-artifact-view.js refuses to print schema at the writer.

  ── WHAT GOES UP, AND WHEN IT IS WRITTEN ──────────────────────────────

  `onDraft({ title, content, contentDirty })` on every change: the title
  as the field holds it, the content as the body holds it (a string for a
  note, a doc for an artifact), and whether the BODY was touched at all.
  `contentDirty` is the desktop modal's `dirty` gate and it is not
  tidiness: a no-op open+close round-tripped through TipTap's serializer
  overwrote pins with the editor's normalized form, silently dropping
  what the reduced schema did not recognize. Nothing here persists. The
  host writes the draft once, when the screen is LEFT (ShellApp,
  `flushArtifactDraft`), so backing out with the system back, the bar's
  back or the edge gesture all save the same way, and there is no `save`
  row to miss.

  PinEditor is keyed on the pin's id and `updated_at`: a pin re-opened
  after a save is a fresh mount, not a setContent over a live instance.

  ── DATES ─────────────────────────────────────────────────────────────

  Both reference dates are derived from ONE clock read when the host
  passes neither — `yesterdayOf(today)`, memory-model.js's argument — and
  in the VR harness the host passes both off the frozen clock.

  ── THE BACKGROUND IS NOT DECORATION ──────────────────────────────────

  Nothing is set here, and that is correct rather than forgotten: Stack
  paints `--canvas-bg` on every entry (b2844d2f, held by
  shell-rules.test.js). A pushed screen that painted its own would be a
  second answer.

  ── NOT THE CANVAS REGION ─────────────────────────────────────────────

  PinsScreen's call, for PinsScreen's reason: a swipe up at the bottom of
  a pushed screen must not leave for memory. Screen defaults to no
  region, so this is a decision recorded rather than a prop omitted.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import TitleField from "./ui/TitleField.svelte";
  import Field from "./ui/Field.svelte";
  import Provenance from "./ui/Provenance.svelte";
  import PinEditor from "./ui/PinEditor.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Row from "./ui/Row.svelte";
  import Empty from "../lib/ui/Empty.svelte";
  import { pinArtifactDoc, pinArtifactHeader, pinArtifactRows } from "./pin-artifact-view.js";
  import { pinTitleDraft, pinNoteDraft } from "./pin-draft.js";
  import { pinProvenance } from "./provenance.js";
  import { yesterdayOf } from "./memory-model.js";
  import { getLocalDateStr } from "../lib/utils.js";

  /** @type {{
    pin?: any,
    trailName?: string | null,
    trailValue?: string | null,
    todayStr?: string,
    yesterdayStr?: string,
    onBack?: (() => void) | null,
    onRow?: ((id: string) => void) | null,
    onDraft?: ((draft: {title: string, content: string | object | null, contentDirty: boolean}) => void) | null,
    onEditor?: ((editor: any | null) => void) | null,
  }} */
  let {
    pin = null,
    trailName = null,
    // The `trail` row's value — the pin's trail as the row shows it. Null
    // withholds the row: only a host that holds the trails list can open
    // the picker behind it (pin-artifact-view.js).
    trailValue = null,
    todayStr = undefined,
    yesterdayStr = undefined,
    onBack = null,
    onRow = null,
    onDraft = null,
    // PinEditor's instance, passed straight through — EditorCore's shape.
    // No caller in the shell decides anything with it; it is how a test
    // types into the editor, and how a host that wants the caret placed
    // will reach it.
    onEditor = null,
  } = $props();

  const header = $derived(pinArtifactHeader(pin));
  const rows = $derived(pinArtifactRows(pin, { trail: trailValue }));

  /** The two fields' starting text — writable deriveds, PageScreen's
   *  focus line's reason: typing overrides until the pin changes, and the
   *  seed is synchronous rather than one microtask late. */
  let title = $derived(pinTitleDraft(pin));
  const noteText = $derived(pinNoteDraft(pin));
  let text = $derived(noteText ?? "");
  /** The doc, only for a pin whose body is not text. */
  const doc = $derived(noteText === null ? pinArtifactDoc(pin) : null);

  /** What the body holds now, and whether it has been touched. Plain
   *  lets: they are read only inside `report`, never rendered. */
  let content = null;
  let contentDirty = false;

  function report() {
    onDraft?.({ title, content: contentDirty ? content : (noteText ?? doc), contentDirty });
  }

  function commitTitle() {
    report();
  }

  function commitText(next) {
    content = next;
    contentDirty = true;
    report();
  }

  function commitDoc(next) {
    content = next;
    contentDirty = true;
    report();
  }

  /** One clock read, both dates — see the header. */
  const today = $derived(todayStr || getLocalDateStr());
  const yesterday = $derived(yesterdayStr || yesterdayOf(today));
  const provenance = $derived(
    pinProvenance(pin, { trailName, todayDateStr: today, yesterdayDateStr: yesterday }),
  );

  /** PinEditor's mount key — see the header. */
  const editorKey = $derived(pin?.id ? `pin:${pin.id}:${pin.updated_at ?? ""}` : "none");
</script>

<Screen>
  {#snippet nav()}
    <NavBar title={header.title} {onBack} />
  {/snippet}

  {#if pin}
    <div class="pin-artifact-title">
      <TitleField
        label="pin title"
        placeholder="name this pin"
        bind:value={title}
        onCommit={commitTitle}
      />
    </div>
    <Provenance>{provenance}</Provenance>

    {#if noteText !== null}
      <div class="pin-artifact-note">
        <Field label="pin text" multiline={true} bind:value={text} onInput={commitText} />
      </div>
    {:else if doc}
      {#key editorKey}
        <div class="pin-artifact-body">
          <PinEditor {doc} onChange={commitDoc} {onEditor} />
        </div>
      {/key}
    {:else}
      <!-- A pin with nothing readable cached: no content, or content that
           is JSON-shaped and will not parse. pin-artifact-view.js refuses
           to print a serializer's braces at the writer and call it their
           writing; the honest result is a screen that says there is
           nothing to show. The title field, the provenance line and the
           rows still render. -->
      <Empty>
        {#snippet title()}nothing readable kept here{/snippet}
        {#snippet body()}the pin has a title and no content behind it.{/snippet}
      </Empty>
    {/if}
  {:else}
    <!-- No pin at all. Only reachable if the host pushed this screen
         without freezing a row into it, which `openPinArtifact` cannot do
         — it guards on the pin first. -->
    <Empty>
      {#snippet title()}this pin did not open{/snippet}
      {#snippet body()}go back and try it again.{/snippet}
    </Empty>
  {/if}

  {#if rows.length > 0}
    <RowGroup>
      {#each rows as row (row.id)}
        <Row
          label={row.label}
          value={row.value ?? ""}
          kind={row.kind}
          onSelect={onRow ? () => onRow(row.id) : null}
        />
      {/each}
    </RowGroup>
  {/if}
</Screen>

<style>
  /* Title's box (src/shell/ui/Title.svelte): the band's inset, a step
     above the body. The size is handed to TitleField through the token it
     reads; the field floors it at 16px itself. */
  .pin-artifact-title {
    --title-field-size: var(--text-xl);
    margin: var(--space-3) var(--space-4) 0;
  }

  /* The writing, on the canvas at the band's inset — see the header for
     why there is no card around it. */
  .pin-artifact-body {
    padding: 0 var(--space-4);
  }

  .pin-artifact-note {
    margin: 0 var(--space-4) var(--space-4);
  }
</style>
