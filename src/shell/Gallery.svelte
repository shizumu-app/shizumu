<!--
  The catalogue. Not a developer convenience — the VR harness has no other
  view of the primitives under src/shell/ui/ than the screens that happen
  to host them, so whatever this file renders is the artefact the
  shell-gallery baselines are shot from, and every future visual diff on
  a primitive is measured against those shots. A state left out here is a
  state no regression test will ever notice change.

  Sixteen primitives are drawn, in twelve sections: NavBar, TabBar,
  ToolbarStrip (and the ToolbarButton it is made of), PrimaryAction,
  RowGroup with Row and Eyebrow, Field, Segment, Chip, Card (holding
  StaticProse), Note, Title with Provenance, Toast — and Sheet in the
  second scene. The header used to say "ten", from the phase that wrote
  it; count the imports, not the adjective. Not here, on purpose: the
  page's own bands (PageHeader, FindStrip, SuggestionStrip), the two
  builders' parts (TableSizeGrid, ChartForm) and Stack, each photographed
  on the screen that hosts it under a VR state, because what they show
  depends on an editor or a stack behind them that this catalogue does
  not have.

  Two base scenes, per this gate's own scope decision: the in-flow
  primitives (this file's default), and the same catalogue with the one
  overlay primitive open over it at its half detent (`sheetOpen`). Anything
  a gesture would reveal — a strip mid-switch, a sheet mid-drag, a stack
  mid-back — needs a driver in tests/vr/states.js; that is a screen's
  scene, not an omission here.

  Nothing below is hand-drawn where the app has a model for it. The two
  strips come through toolbarFor and stripPresence, the functions the real
  editor chrome calls — the block strip with a caret in a paragraph, the
  selection strip with `link` dropped the way ShellApp drops it (no
  command in the shell to type a URL into) — so the catalogue cannot
  quietly drift from the strip it exists to illustrate. The provenance
  line comes from pinProvenance against a fixed clock, for the same
  reason. The section labels are Eyebrow itself: this file used to draw
  its own copy of that style, which is what Eyebrow was promoted from.
-->
<script>
  import ShellRoot from "./ShellRoot.svelte";
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import TabBar from "./ui/TabBar.svelte";
  import ToolbarStrip from "./ui/ToolbarStrip.svelte";
  import PrimaryAction from "./ui/PrimaryAction.svelte";
  import Sheet from "./ui/Sheet.svelte";
  import Row from "./ui/Row.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Eyebrow from "./ui/Eyebrow.svelte";
  import Field from "./ui/Field.svelte";
  import Segment from "./ui/Segment.svelte";
  import Chip from "./ui/Chip.svelte";
  import Card from "./ui/Card.svelte";
  import StaticProse from "./ui/StaticProse.svelte";
  import Note from "./ui/Note.svelte";
  import Title from "./ui/Title.svelte";
  import Provenance from "./ui/Provenance.svelte";
  import Toast from "./ui/Toast.svelte";
  import { toolbarFor } from "./toolbar-model.js";
  import { stripPresence } from "./toolbar-state.js";
  import { pinProvenance } from "./provenance.js";
  import { ROOTS } from "./roots.js";

  /** @type {{ sheetOpen?: boolean }} */
  let { sheetOpen = false } = $props();

  // A caret in a paragraph: `type` leads, six wide, and the strip fits.
  // `keyboardOpen` because the strip now needs both (toolbar-model.js) — a
  // gallery of what a writer sees must stand where the writer stands.
  const blockStrip = toolbarFor({
    editing: true,
    keyboardOpen: true,
    selectionEmpty: true,
    activeBlock: { type: "paragraph" },
  });
  // A range selected. `link` is on the model's list and off every real
  // strip — ShellApp's `unavailableIds` names it, for want of a URL field —
  // and dropping it here through the same function keeps this strip six
  // wide and honest about what a writer sees.
  const selectionStrip = stripPresence({
    buttons: toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: false }).buttons,
    unavailable: ["link"],
  });

  // Fixed dates, so the line reads the same on every run whatever the
  // harness's clock says: kept yesterday, edited today.
  const provenance = pinProvenance(
    { created_at: "2026-05-19", updated_at: "2026-05-20", status: "open" },
    { trailName: "the book", todayDateStr: "2026-05-20", yesterdayDateStr: "2026-05-19" },
  );

  // Three paragraphs, for Card: the reading view's shape, prose in a frame.
  const CARD_DOC = {
    type: "doc",
    content: [
      "the page is where the thinking gets done.",
      "you write to think. the pins are where you left it.",
      "everything else stays in memory, searchable.",
    ].map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };

  const SEGMENT_OPTIONS = [
    { value: "pages", label: "pages" },
    { value: "trails", label: "trails" },
    { value: "pins", label: "pins" },
  ];

  let fieldValue = $state("a line already typed");
  let noteValue = $state("a note pin's body.\nthree lines of it,\nkept as typed.");
  let secretValue = $state("a passphrase");
  let segmentValue = $state("pages");
</script>

<div class="shell-gallery">
  <ShellRoot>
    <Screen>
      <section class="shell-gallery-section">
        <Eyebrow label="NavBar" />
        <NavBar
          title="the page"
          subtitle="what matters now"
          onBack={() => {}}
          actions={[
            { id: "search", label: "search", onSelect: () => {} },
            { id: "more", label: "more", onSelect: () => {} },
          ]}
        />
        <NavBar title="the page" collapsed={true} />
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="TabBar" />
        <TabBar tabs={ROOTS} active="memory" onSelect={() => {}} />
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="ToolbarStrip" />
        <ToolbarStrip
          buttons={blockStrip.buttons}
          activeIds={[]}
          disabledIds={[]}
          onPress={() => {}}
        />
        <ToolbarStrip
          buttons={selectionStrip.shown}
          activeIds={["bold"]}
          disabledIds={[]}
          onPress={() => {}}
        />
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="PrimaryAction" />
        <PrimaryAction id="unlock" onPress={() => {}} />
        <PrimaryAction id="gate-next" disabled={true} onPress={() => {}} />
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="RowGroup" />
        <RowGroup eyebrow="a group">
          <Row label="jump to trail" value="book" onSelect={() => {}} />
          <Row label="pages written" value="42" />
          <Row label="cream" value="in use" kind="choice" onSelect={() => {}} />
          <Row label="save" kind="action" onSelect={() => {}} />
          <Row label="delete this trail" destructive={true} onSelect={() => {}} />
          <Row label="wide gutter" toggle={true} checked={true} onToggle={() => {}} />
          <Row label="show word count" toggle={true} checked={false} onToggle={() => {}} />
        </RowGroup>
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="Field" />
        <Field label="find" placeholder="search pages" value="" />
        <Field label="find" bind:value={fieldValue} />
        <Field label="note" multiline={true} bind:value={noteValue} />
        <Field label="passphrase" secure={true} bind:value={secretValue} />
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="Segment" />
        <Segment options={SEGMENT_OPTIONS} bind:value={segmentValue} ariaLabel="mode" />
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="Chip" />
        <div class="shell-gallery-inline">
          <Chip>untrailed</Chip>
          <Chip tone="accent">3 pins</Chip>
        </div>
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="Card" />
        <Card><StaticProse doc={CARD_DOC} /></Card>
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="Note" />
        <Note>every page starts empty. what you pin comes back when you need it.</Note>
        <Note tone="warm">wrong passphrase</Note>
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="Title" />
        <Title>the shape of the argument, not the word count</Title>
        <Provenance>{provenance}</Provenance>
      </section>

      <section class="shell-gallery-section">
        <Eyebrow label="Toast" />
        <Toast message="joins 11 pins on the book trail" />
      </section>
    </Screen>
  </ShellRoot>

  {#if sheetOpen}
    <Sheet open={true} detent="half">
      <RowGroup flush={true}>
        <Row label="discrete" value="in use" kind="choice" onSelect={() => {}} />
        <Row label="continuous" kind="choice" onSelect={() => {}} />
        <Row label="save" kind="action" onSelect={() => {}} />
      </RowGroup>
    </Sheet>
  {/if}
</div>

<style>
  /* The gallery is the only place this scroll can legitimately grow past a
     phone viewport — it stacks every state of every primitive in one
     column. Screen's own scroll container carries that height; nothing
     here re-declares a scroll rule of its own. The VR scene raises the
     viewport to the column's height instead (scenes.js, `viewportHeight`
     on the two gallery scenes), so the photograph is the whole catalogue
     and not its first screenful. */
  .shell-gallery {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .shell-gallery-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4) 0;
    border-bottom: 1px solid var(--hairline);
  }

  /* Chips are inline spans with no inset of their own — a screen sets
     them beside a title or under a header row — so the catalogue gives
     them the band's inset and a gap, and nothing else. */
  .shell-gallery-inline {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-4);
  }
</style>
