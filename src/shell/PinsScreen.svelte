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
  and gave every row somewhere to go.

  0.8.2 (spec 2026-11-01 §4, rulings 5 and 6) REPLACED THE SEGMENT with
  the desktop panel's search and chip row — this trail / all trails,
  carries forward, on this page, kind — decided in pin-filter.js over the
  desktop's own module, so a chip counts the same thing on both. Each row
  now says what it does in words under the pin: `open`, `put on page`,
  `more` (carry forward, the moves, unpin with a question first; the
  host's sheet, pin-more-sheet.js). The empty states are the desktop's:
  an untrailed page is told to choose a trail, a trail with nothing on it
  is told how to pin, and only a list a filter emptied says "nothing
  matches", with `clear filters`. The old comment below about there being
  no third empty state was true of the segment; with a search there is
  one.

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

  THE ROWS SIT IN `RowGroup`s, one per section (`on this trail · 3`, `from
  parent trails · 1`, or a trail path per group under `all trails`), the
  section's line as the group's eyebrow. The group is where the line
  between rows lives — Row draws none of its own — and the status wrapper
  around each row (the row, then its worded actions) is a direct child of
  the group, which rules between whatever it is handed, so the dimming and
  the actions cost the group nothing. The chips and the row actions are
  ToolbarButton, the shell's pressable that carries the 44px floor; the
  segment this screen used to have is gone with the axis it filtered on.

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
  import Field from "./ui/Field.svelte";
  import ToolbarButton from "./ui/ToolbarButton.svelte";
  import Empty from "../lib/ui/Empty.svelte";
  import { pinRowLabel } from "./pin-label.js";
  import { pinRowActions } from "../lib/pin-row-actions.js";
  import {
    clearPanelFilters,
    defaultPanelFilter,
    pinsScreenModel,
    setKind,
    tapChip,
  } from "./pin-filter.js";

  /** @type {{
    pins?: any[],
    allPins?: any[] | null,
    allCount?: number | null,
    loading?: boolean,
    lineageId?: string | null,
    pageId?: string | null,
    lineages?: any[],
    canPutOnPage?: boolean,
    onBack?: (() => void) | null,
    onPin?: ((pin: any) => void) | null,
    onPutOnPage?: ((pin: any) => void) | null,
    onMore?: ((pin: any) => void) | null,
    onChooseTrail?: (() => void) | null,
    onNeedAllPins?: (() => void) | null,
  }} */
  let {
    pins = [],
    allPins = null,
    allCount = null,
    loading = false,
    lineageId = null,
    pageId = null,
    lineages = [],
    canPutOnPage = false,
    onBack = null,
    onPin = null,
    onPutOnPage = null,
    onMore = null,
    onChooseTrail = null,
    onNeedAllPins = null,
  } = $props();

  // View state, here for the reason the segment's was: nothing outside
  // this screen reads it, and a re-pushed pins screen is a new instance,
  // so it resets on every push for free.
  let filter = $state(defaultPanelFilter());
  let kindOpen = $state(false);

  const model = $derived(
    pinsScreenModel({
      trailPins: pins,
      allPins,
      allCount,
      loading,
      lineageId,
      pageId,
      lineages,
      filter,
      kindOpen,
    }),
  );

  // `all trails` is read when it is first asked for, not on every push —
  // the host fans out over every trail to answer it (see openPins there).
  $effect(() => {
    if (model.needsAllPins) onNeedAllPins?.();
  });

  function pressChip(id) {
    const next = tapChip({ filter, kindOpen }, id);
    filter = next.filter;
    kindOpen = next.kindOpen;
  }

  function pressKind(kind) {
    filter = setKind(filter, kind);
  }

  function actionsFor(pin) {
    return pinRowActions(pin, {
      lineages,
      title: pinRowLabel(pin),
      canPutOnPage: canPutOnPage && !!onPutOnPage,
      canRename: false,
    }).primary;
  }

  function runAction(id, pin) {
    if (id === "open") onPin?.(pin);
    else if (id === "putOnPage") onPutOnPage?.(pin);
  }
</script>

<Screen>
  {#snippet nav()}
    <NavBar title="pins" {onBack} />
  {/snippet}

  <div class="pins-find">
    <Field
      label="search pins"
      placeholder={model.placeholder}
      value={filter.query}
      onInput={(next) => (filter = { ...filter, query: next })}
    />
  </div>

  <!-- One row of chips; it scrolls sideways when it is wider than the
       phone, the toolbar strip's own shape. Each chip is a ToolbarButton,
       the shell's pressable with the 44px floor, and says its count. -->
  <div class="pins-chips" role="toolbar" aria-label="filter pins">
    {#each model.chips as chip (chip.id)}
      <span class="pins-chip" data-chip={chip.id} data-active={chip.active ? "true" : null}>
        <ToolbarButton
          label={chip.ariaLabel}
          active={chip.active}
          activateOn="click"
          onPress={() => pressChip(chip.id)}
        >
          {chip.label}{#if chip.count != null}{" "}<span class="pins-chip-count">{chip.count}</span>{/if}
        </ToolbarButton>
      </span>
    {/each}
  </div>
  {#if model.kinds.length > 0}
    <div class="pins-chips pins-kinds" role="toolbar" aria-label="pin kind">
      {#each model.kinds as kind (kind.id)}
        <span class="pins-chip" data-kind={kind.id} data-active={kind.active ? "true" : null}>
          <ToolbarButton
            label={kind.ariaLabel}
            active={kind.active}
            activateOn="click"
            onPress={() => pressKind(kind.id)}
          >
            {kind.label}{" "}<span class="pins-chip-count">{kind.count}</span>
          </ToolbarButton>
        </span>
      {/each}
    </div>
  {/if}

  {#if model.reading}
    <!-- "Nothing kept here" and "not read yet" are different facts, and
         showing the first while the fetch is in flight tells a writer with
         fifty pins that they have none. -->
    <Empty>
      {#snippet title()}reading the pins{/snippet}
    </Empty>
  {:else if model.empty}
    <Empty hasActiveFilters={!!model.empty.action}>
      {#snippet title()}{model.empty.title}{/snippet}
      {#snippet body()}{model.empty.body}{/snippet}
      {#snippet actions()}
        {#if model.empty.action === "clearFilters"}
          <span class="pins-empty-action">
            <ToolbarButton label="clear filters" activateOn="click" onPress={() => (filter = clearPanelFilters(filter))} />
          </span>
        {:else if model.empty.action === "chooseTrail" && onChooseTrail}
          <span class="pins-empty-action">
            <ToolbarButton label="choose a trail" activateOn="click" onPress={onChooseTrail} />
          </span>
        {/if}
      {/snippet}
    </Empty>
  {:else}
    {#each model.sections as section (section.key)}
      <RowGroup eyebrow={section.label}>
        {#each section.pins as item (item.pin.id)}
          <div class="pins-row" data-pin-status={item.pin.status ?? "open"}>
            <Row
              label={pinRowLabel(item.pin)}
              detail={item.detail ?? ""}
              onSelect={onPin ? () => onPin(item.pin) : null}
            />
            <div class="pins-row-actions">
              {#each actionsFor(item.pin) as action (action.id)}
                <ToolbarButton
                  label={action.ariaLabel ?? action.label}
                  activateOn="click"
                  onPress={() => runAction(action.id, item.pin)}
                >{action.label}</ToolbarButton>
              {/each}
              {#if onMore}
                <ToolbarButton
                  label={`more for ${pinRowLabel(item.pin)}`}
                  activateOn="click"
                  onPress={() => onMore(item.pin)}
                >more</ToolbarButton>
              {/if}
            </div>
          </div>
        {/each}
      </RowGroup>
    {/each}
  {/if}
</Screen>

<style>
  /* The search and the chips scroll with the list rather than riding the
     nav bar. §2 gives a bar-riding control to MEMORY's search field only,
     and a second fixed band above a list is the shape that eats the top
     of the first row on a short phone. */
  .pins-find {
    padding: var(--space-3) var(--space-4) 0;
  }

  .pins-chips {
    display: flex;
    flex-wrap: nowrap;
    gap: var(--space-2);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    padding: var(--space-2) var(--space-4);
  }

  .pins-kinds {
    padding-top: 0;
  }

  /* A chip is the shell's pressable drawn as a pill: hairline outline,
     accent tint when on — the Chip primitive's two tones. */
  .pins-chip {
    flex: 0 0 auto;
  }

  .pins-chip :global(.shell-toolbar-button) {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    color: var(--ink-soft);
    font-size: var(--text-xs);
    padding: 0 var(--space-3);
    white-space: nowrap;
  }

  .pins-chip[data-active="true"] :global(.shell-toolbar-button) {
    color: var(--accent-text);
    background: var(--warm-accent-soft);
    border-color: transparent;
  }

  .pins-chip-count {
    opacity: 0.8;
  }

  /* The row's worded actions sit under it, left-aligned with the title,
     quieter than the title. */
  .pins-row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    /* Up under the title: the row's own bottom padding and the buttons'
       44px floor would otherwise leave the actions floating a line away
       from the pin they act on. */
    margin-top: calc(-1 * var(--space-3));
    padding: 0 var(--space-2) var(--space-1);
  }

  .pins-empty-action :global(.shell-toolbar-button) {
    color: var(--accent-text);
  }

  .pins-row-actions :global(.shell-toolbar-button) {
    color: var(--accent-text);
    font-size: var(--text-xs);
  }

  /* The status mark is the wrapper's, not the Row's. Row is the shell's
     most reused primitive and a pin's status is this screen's fact about
     its own rows; a `muted` prop there would put a pins concept into every
     settings list. Quiet by colour, as the desktop's PinRow is: the
     label takes --ink-soft at full strength. The 0.35 and 0.55 opacities
     put a closed pin's title at 2.4 to 3.4:1 in every tone
     (scripts/clarity/visual-phone.mjs, 2026-10-31). */
  .pins-row[data-pin-status="closed"] :global(.shell-row-label),
  .pins-row[data-pin-status="orphaned"] :global(.shell-row-label) {
    color: var(--ink-soft);
  }
</style>
