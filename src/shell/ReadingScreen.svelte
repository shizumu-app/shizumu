<!--
  Reading a page: the writing as it was left, and the way on from it.

  §2: "Tapping a page pushes a reading view; 'continue' lives there."
  What continue MEANS, and why a read-only page is offered something else
  instead, is reading-view.js's decision and its header carries the whole
  argument — including where the word was read off the desktop.

  ── THIS IS THE SURFACE CLAUDE.md MEANS BY "OPEN YESTERDAY IN MEMORY" ──

  "Past pages are read-only: open yesterday in memory, write today on
  PAGE." Two halves, a rule and a route. P2f made the rule hold everywhere
  (`pageReadonly`), and its date sheet honoured the rule while taking the
  other route — it opens a past day on the page ROOT, and its header said
  so and called itself an interim, "when memory lands it pushes the same
  read-only view rather than a second one".

  IT IS A SECOND ONE, and that sentence is corrected where it stands
  rather than left to be read as a plan nobody followed. This screen is
  not the page root: it holds no editor, no gutter, no toolbar and no
  cursor, and it cannot be typed into by construction rather than by a
  gate answering false. §2 asks for a reading view precisely because
  "continue" has to have somewhere to live, and continue is meaningless on
  the surface it would take you to.

  THE DATE SHEET STAYS, and that is a decision rather than an omission.
  The two answer different questions. The date sheet is the page root's
  own day switcher, reached from its header, and its first row is TODAY —
  it is the way back to now for a phone left open across midnight, which
  the shell has no other version of yet. This screen is reached from a
  list of pages across every trail, and its subject is one page's writing.
  Deleting the sheet would take the day switcher and the way back with it
  and buy nothing: the rule the sheet was suspected of bending is
  `pageReadonly`, and the sheet has obeyed it since P2f.

  ── THE DESKTOP'S ANATOMY ─────────────────────────────────────────────

  ThreadPageView's, top to bottom: `.pv-date`, `.pv-matters`, `.pv-content
  prose`. Here: the bar names the DAY (the writer came from a list of
  days); under it the focus line is the title in Lora — the writer's own
  sentence about the day, where `.pv-matters` puts it — one mono line
  says the trail and when it was written and edited (provenance.js,
  `readingProvenance`), and the writing sits on the canvas. The bar's
  second line is empty on purpose; the trail is the line's first word,
  and `readingHeader` says why.

  NO CHIP AND NO CARD, since the second device pass ("similar to pin
  tap page on memory shows ugly page"). The chip named the trail and the
  provenance line's first word is the trail — one fact twice, one of them
  dressed as a control. The card boxed the writing on a raised surface,
  and on a phone a raised box inside a screen inside a frame reads as a
  quotation rather than as the page; the desktop's `.pv-content` is a box
  because it sits in a panel beside other things. The writing sits at the
  band's inset, where the page's own prose sits. PinArtifactScreen made
  the same two cuts for the same reasons.

  Two rules are shared with PinArtifactScreen and live where both reach
  them: `Title` and `Provenance` in src/shell/ui/, one file each for
  Eyebrow's reason. Both reference dates are derived from ONE clock read
  when the host passes neither — `yesterdayOf(today)`, memory-model.js's
  argument — and in the VR harness the host passes both off the frozen
  clock.

  ── THE WRITING IS RENDERED, NOT MOUNTED ──────────────────────────────

  `ProseHTML` (src/lib/render/) over the desktop's own READONLY_EXTENSIONS,
  not a second EditorCore. The desktop's ThreadPageView mounts a read-only
  TipTap instance and the desktop's memory cards render static HTML; both
  are the desktop's read-only rendering and both go through the same
  schema, so "unchanged in substance" is satisfied either way and the
  choice is free to be made on what a phone can afford.

  What it buys, in order:
    - Stack keeps the root and the top two entries alive, so this screen
      is mounted BESIDE the page root's live editor. A second ProseMirror
      is a second view, a second plugin set and a second set of DOM
      mutation observers, on the device with the least of all three.
      (PinArtifactScreen pays exactly that, on purpose: a pin is edited
      there. A past page is not, so this one does not.)
    - A static tree has no selection and no contenteditable host. The
      strongest form of "this page is read-only" is a surface with nothing
      to type into, rather than one with a cursor and a gate that says no.

  What it costs is named rather than hidden: no find, no block handles,
  and images arrive through `hydrateBlobImages` (ProseHTML's own effect)
  rather than through the editor's node views. None of the three is
  something a reading view offers.

  It costs one more thing, found on a phone: the editor's list rendering.
  Every list rule lives under `.ProseMirror`, so a static list drew the
  browser's own bullet beside the marker the schema emits. `StaticProse`
  (src/shell/ui/) is ProseHTML with the shell's own copy of those rules,
  and its header says why they cannot live where the desktop's do.

  ── THE ROWS ARE UNDER THE WRITING ────────────────────────────────────

  Not in the nav bar. The bar is capped at two actions by §4 and this
  screen already spends one on back; more to the point, `continue` is the
  thing the writer decides AFTER reading, so it sits at the end of what
  they read: a row at the end of the canvas that scrolls with the content
  rather than a bar the screen happens to have.

  Both rows are ACTIONS — they leave for the page root and open no screen
  of their own — so they take `kind="action"` and draw no chevron. On a
  read-only page the sentence that says why the offer is `write today`
  and not `continue` is a `Note` ABOVE the group, not a row in it: it was
  an inert `Row` once, a 44px control that did nothing, and a sentence
  inside the group's body would have a rule drawn against it as if it
  were a row (SettingsSectionScreen found the same and put its note under
  the group). Above, because it is the reason and the row is the offer,
  and a reader takes them in that order — the desktop's collision bar
  puts the sentence beside its action for the same reason.

  ── NOT THE CANVAS REGION ─────────────────────────────────────────────

  PinsScreen's call, for PinsScreen's reason: a swipe up at the bottom of
  a pushed screen must not leave for memory, because the writer is one
  back away from the list they came from. Screen defaults to no region,
  so this is a decision recorded rather than a prop omitted.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import Title from "./ui/Title.svelte";
  import Provenance from "./ui/Provenance.svelte";
  import Note from "./ui/Note.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Row from "./ui/Row.svelte";
  import Empty from "../lib/ui/Empty.svelte";
  import StaticProse from "./ui/StaticProse.svelte";
  import { readingHeader, readingRows } from "./reading-view.js";
  import { readingProvenance } from "./provenance.js";
  import { yesterdayOf } from "./memory-model.js";
  import { getLocalDateStr } from "../lib/utils.js";

  /** @type {{
    page?: any,
    trailName?: string | null,
    trailMode?: "discrete" | "continuous" | null,
    loading?: boolean,
    todayStr?: string,
    todayPageId?: string | null,
    yesterdayStr?: string,
    onBack?: (() => void) | null,
    onRow?: ((id: string) => void) | null,
  }} */
  let {
    page = null,
    trailName = null,
    trailMode = null,
    loading = false,
    todayStr = undefined,
    // The id of the page the backend handed out as today (ShellApp's
    // todayPageId); page-writable.js treats it as writable by identity.
    todayPageId = null,
    yesterdayStr = undefined,
    onBack = null,
    onRow = null,
  } = $props();

  /** One clock read, both dates — see the header, and memory-model.js's
   *  `yesterdayOf`, which is where the day the two drifted apart is
   *  written down. */
  const today = $derived(todayStr || getLocalDateStr());
  const yesterday = $derived(yesterdayStr || yesterdayOf(today));

  const header = $derived(
    readingHeader({ page, todayDateStr: today, yesterdayDateStr: yesterday }),
  );

  const rows = $derived(readingRows({ page, trailMode, todayDateStr: today, todayPageId }));
  const notes = $derived(rows.filter((r) => r.note));
  const actions = $derived(rows.filter((r) => !r.note));

  const provenance = $derived(
    readingProvenance(page, { trailName, todayDateStr: today, yesterdayDateStr: yesterday }),
  );

  /** The writer's own focus line, as the screen's title, where
   *  ThreadPageView puts it (`.pv-matters`). Absent rather than
   *  "untitled" here: memory's LIST needs a label on every row so the
   *  rows can be told apart, and this screen is one page — an empty line
   *  above the writing says nothing and a placeholder above it says
   *  something false. */
  const focus = $derived(
    typeof page?.what_matters_now === "string" && page.what_matters_now.trim()
      ? page.what_matters_now.trim()
      : "",
  );

  /** ProseHTML memoizes on this key. `cardCacheKey` is the desktop's
   *  builder for the same string and it is deliberately not used: it ends
   *  in the maxNodes it was called with, and this screen truncates
   *  nothing, so its key would claim a truncation it does not have.
   *  `updated_at` is in the key because a page re-read after an edit must
   *  not come back from the cache as the version before it. */
  const cacheKey = $derived(page?.id ? `reading:${page.id}:${page.updated_at ?? ""}` : undefined);
</script>

<Screen>
  {#snippet nav()}
    <NavBar title={header.title} {onBack} />
  {/snippet}

  {#if page}
    {#if focus}
      <Title>{focus}</Title>
    {/if}
    <div class="reading-provenance" class:untitled={!focus}>
      <Provenance>{provenance}</Provenance>
    </div>
    <div class="reading-body">
      <StaticProse doc={page.content_json ?? null} {cacheKey} />
    </div>
    {#each notes as row (row.id)}
      <Note>{row.label}</Note>
    {/each}
    {#if actions.length > 0}
      <RowGroup>
        {#each actions as row (row.id)}
          <Row label={row.label} kind="action" onSelect={onRow ? () => onRow(row.id) : null} />
        {/each}
      </RowGroup>
    {/if}
  {:else if loading}
    <!-- Two empty states, PinsScreen's rule: "not read yet" and "nothing
         here" are different facts, and the push renders before the fetch
         resolves, which is exactly this window. -->
    <Empty>
      {#snippet title()}reading the page{/snippet}
    </Empty>
  {:else}
    <!-- The read failed or the row addressed nothing. Said plainly rather
         than left as a blank screen: the writer tapped a row that memory
         listed, so an empty surface with no explanation reads as the app
         losing a page it had just shown them. -->
    <Empty>
      {#snippet title()}this page did not open{/snippet}
      {#snippet body()}go back and try it again.{/snippet}
    </Empty>
  {/if}
</Screen>

<style>
  /* When the page has no focus line there is no Title above the
     provenance line to hold the band's top margin, so the line takes it. */
  .reading-provenance.untitled {
    padding-top: var(--space-3);
  }

  /* The writing, on the canvas at the band's inset — the header says why
     there is no card around it. */
  .reading-body {
    padding: 0 var(--space-4) var(--space-4);
  }
</style>
