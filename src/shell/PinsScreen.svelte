<!--
  The pins, on a screen the page pushes.

  It is here because §2 says pins is a PUSH — "pushed from the page nav
  bar… filter segment · pin rows; a row opens an actions sheet" — and
  because P3 Task 1 needed one real screen to prove the stack with. P2f
  left `onPins` deliberately unwired and wrote down why: opening pins as a
  sheet to have something behind the control would have built the wrong
  surface and then had to unbuild it. This is the surface it was waiting
  for, not a placeholder standing in for it.

  Task 1 built the list and the way back; Task 2 added the filter segment
  and gave every row somewhere to go. What is still absent is the desktop's
  scope menu (share up / make global / restore to the birth trail), which
  needs the lineage tree and lands as a second sheet §2 does not describe —
  named here so the gap reads as a boundary rather than as an oversight.

  IT TAKES ITS ROWS, it does not fetch them. The host fetches on the push,
  which is also the answer to the staleness P2f Task 2 found in
  EditorCore's own getPins call: that one runs from an effect keyed on
  `lineageId !== prevLineageId`, so its cached list is one pin behind from
  the second pin onward. A screen that read the same store would inherit
  the same lag. A fetch tied to the push cannot be stale, because the push
  is the event.

  IT TAKES THE LINEAGE THE ROWS WERE READ FOR, not the page's current one,
  and the host freezes the two together for that reason. Every label on the
  segment is a statement about which trail a pin belongs to relative to
  THIS list; a lineage that moved on underneath would re-caption rows the
  fetch never re-read.

  The filter lives here rather than in the host because it is view state
  and nothing outside this screen reads it, and it resets on every push for
  free: Stack keys its entries by id, ids are minted per push, so a popped
  and re-pushed pins screen is a new component instance.

  ORPHANED AND CLOSED PINS ARE SHOWN, dimmed, exactly as the desktop's
  PinRow shows them (`.pin-row-wrap.closed` 0.35, `.orphaned` 0.55). Two
  reasons, and neither is symmetry for its own sake. CLAUDE.md's pin
  pointer clause: a pin caches its content and keeps a reference to its
  source page, and when the page is deleted the pin survives orphaned with
  its cache intact — so the writing is still reachable and a row that
  vanished would say it was not. And pin-toast.js's header states the
  count's half of the same contract: the breadcrumb is "a POINTER at a
  list, and the list it points at shows the same rows… A count that
  disagreed with the list it names would be worse than no count." Hiding a
  status here would break that agreement silently.

  The dimming is visual and says nothing to assistive tech, which is why
  the WORDS are on the screen the row opens — the provenance line's first
  words, `source removed`, the desktop's own phrase (provenance.js) —
  rather than in the row.

  The rows are `Row`, which is where the 44px floor and any button element
  live — this file renders neither, and shell-rules.test.js forbids the
  alternative. A row's `onSelect` pushes the pin's own screen
  (PinArtifactScreen, the host's `openPinArtifact`): it used to open an
  actions sheet with `read` on it, and the second device pass took the
  sheet away because a tester tapped a row, got a menu, and asked how to
  see the pin.

  THE ROWS SIT IN ONE `RowGroup` AND THE FILTER IS `Segment` (visual pass,
  Task 9). The group is where the line between rows lives now — Row draws
  none of its own — and its surface is what bounds the list; the status
  wrapper around each row is a direct child of the group, which rules
  between whatever it is handed, so the dimming costs the group nothing.
  The segment used to be the bare leaf, `src/lib/ui/SegmentedControl`,
  with the leaf's own coarse-pointer floor four pixels under --tap — the
  same shortfall memory's mode segment shipped with. Segment closes it
  from outside the leaf and spreads the scopes across the band; this
  file changed one import.

  NOT the region the content band carries on the page root. A pushed
  screen's list is not the canvas: a swipe up at its bottom must not
  leave for memory, because the writer is one back away from the page
  they took these pins on. Screen defaults to no region, so this is a
  decision recorded rather than a prop omitted — see Screen's header.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import Row from "./ui/Row.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Segment from "./ui/Segment.svelte";
  import Empty from "../lib/ui/Empty.svelte";
  import { pinRowLabel } from "./pin-label.js";
  import { ALL, filterPins, pinFilterOptions, pinFilterValue } from "./pin-filter.js";

  /** @type {{
    pins?: any[],
    loading?: boolean,
    lineageId?: string | null,
    onBack?: (() => void) | null,
    onPin?: ((pin: any) => void) | null,
  }} */
  let {
    pins = [],
    loading = false,
    lineageId = null,
    onBack = null,
    onPin = null,
  } = $props();

  let filter = $state(ALL);

  const options = $derived(pinFilterOptions(pins, lineageId));
  // What the control is really showing: unpinning the last row of a scope
  // takes that scope's option away, and a selection naming an option that
  // is gone would leave an empty list under a segment with nothing lit.
  const value = $derived(pinFilterValue(options, filter));
  const rows = $derived(filterPins(pins, lineageId, value));

  // Title first, snippet as the fallback, the kind as the last resort —
  // pin-label.js, which is where it moved when memory's pins mode needed
  // the same answer. Its header carries the reasoning this comment used to.
</script>

<Screen>
  {#snippet nav()}
    <NavBar title="pins" {onBack} />
  {/snippet}

  {#if pins.length > 0}
    {#if options.length > 0}
      <div class="pins-filter">
        <Segment
          {options}
          {value}
          onChange={(next) => (filter = next)}
          ariaLabel="which pins"
        />
      </div>
    {/if}
    <RowGroup>
      {#each rows as pin (pin.id)}
        <div class="pins-row" data-pin-status={pin.status ?? "open"}>
          <Row label={pinRowLabel(pin)} onSelect={onPin ? () => onPin(pin) : null} />
        </div>
      {/each}
    </RowGroup>
  {:else if loading}
    <!-- Two empty states, not one. "Nothing kept here" and "not read yet"
         are different facts, and showing the first while the fetch is in
         flight tells a writer with fifty pins that they have none.

         There is no THIRD state for "the filter matched nothing", and that
         is a property of pinFilterOptions rather than an omission: every
         option it offers names a scope some row carries, so a filtered
         list is never empty. -->
    <Empty>
      {#snippet title()}reading the pins{/snippet}
    </Empty>
  {:else}
    <Empty>
      {#snippet title()}nothing pinned on this trail{/snippet}
      {#snippet body()}pin what matters and it comes back here.{/snippet}
    </Empty>
  {/if}
</Screen>

<style>
  /* The segment scrolls with the list rather than riding the nav bar. §2
     gives a bar-riding, collapse-on-scroll control to MEMORY's search
     field and describes the pins segment as content — and a second fixed
     band above a list is the shape that eats the top of the first row on
     a short phone. Segment spreads the scopes across the band itself. */
  .pins-filter {
    padding: var(--space-3) var(--space-4);
  }

  /* The status mark is the wrapper's, not the Row's. Row is the shell's
     most reused primitive and a pin's status is this screen's fact about
     its own rows; a `muted` prop there would put a pins concept into every
     settings list, and would owe a gallery swatch and a VR baseline this
     task cannot record. Quiet by colour, as the desktop's PinRow is: the
     label takes --ink-soft at full strength. The 0.35 and 0.55 opacities
     put a closed pin's title at 2.4 to 3.4:1 in every tone
     (scripts/clarity/visual-phone.mjs, 2026-10-31). */
  .pins-row[data-pin-status="closed"] :global(.shell-row-label),
  .pins-row[data-pin-status="orphaned"] :global(.shell-row-label) {
    color: var(--ink-soft);
  }
</style>
