<!--
  Memory: the search that rides the bar, the modes, and the timeline.

  §2: "Nav bar `memory` with a search field that rides in the bar and
  collapses on scroll; a segmented control for the existing modes; filters
  in a sheet. Content is the timeline (day blocks + spine, unchanged in
  substance)." Everything this file decides that is not layout lives in
  memory-model.js, including what "unchanged in substance" turned out to
  mean — the spec names two components (`memory/DayBlock.svelte`,
  `memory/TimelineSpine.svelte`) that nothing in the tree renders, and the
  timeline that actually ships is TrailMap's inline spine over
  `daysWithActivity` + `trailGroupsForDate`.

  ── THE BAND HAS TWO LINES AND THE SECOND ONE IS THE FIELD ─────────────

  NavBar's own shape is one line and its header says so; the field is a
  sibling below it in the nav snippet rather than a third thing inside it.
  PageScreen set that precedent — its nav snippet holds the header AND the
  pin toast — and it is what keeps NavBar's two-action cap from being bent
  into a place to smuggle a control.

  THE MODE SEGMENT IS `Segment`, the shell's wrapper over
  `src/lib/ui/SegmentedControl.svelte`. P3 asked whether the segmented
  control was a shell primitive or a memory-local component and answered
  neither — the leaf is one of the five opinion-free leaves the rules test
  lets the shell import, and this screen used it bare, inheriting the
  leaf's own coarse-pointer floor, four pixels under --tap. That was the
  P3 handoff's "the memory mode segment is 40px" debt, and the visual pass
  closed it from outside the leaf: Segment reaches the leaf's segments
  through :global and floors them at --tap, and spreads the three modes
  across the band so "trail map", the widest, no longer needs the row to
  scroll sideways. This screen changed one import and nothing else, which
  is the wrapper's whole promise (its header).

  The collapse is `navCollapsed`, this file being its second caller. The
  hysteresis is NOT re-derived: `bandMemory` is the last answer fed back
  in, exactly as PageScreen does it, because handing the module a literal
  degrades the band to a single threshold that flips on every frame a
  scroll position hovers on the line.

  WHAT IS DELIBERATELY NOT PASSED IS `keyboardOpen`, and it is the one
  thing this screen could not inherit. On the page root the keyboard's
  field is in the CONTENT band, so collapsing the bar under it gives that
  field room. Here the keyboard has exactly one cause — this field, inside
  the bar — so honouring the same clause would take the field away from the
  writer the moment they tapped it, drop focus, and take the keyboard down
  with it. `navCollapsed` defaults the parameter to false, which is the
  module's own way of saying a screen has no keyboard trigger, so declining
  it costs the scroll rule nothing. See `searchRowShowing`, which carries
  the argument and the second half of it: a live query keeps the row on
  screen however far the writer has scrolled, because search FILTERS this
  list and a short list with no visible cause is not something anyone can
  undo.

  ── THE THREE MODES, ON THE SYSTEM (visual pass, Task 9) ──────────────

  PAGES is one `RowGroup` per date, the date as the group's eyebrow. The
  screen used to draw its own heading div in the interface face; the
  eyebrow is that heading promoted to the primitive every other grouped
  list uses, and the group's surface is what separates one day's rows
  from the next.

  TRAIL MAP keeps its DAY-FIRST shape and is drawn with the trail index's
  parts. The two are different views on purpose — day → trail here,
  trail → day on the index — so the index's per-trail block, its scope
  group and its page-count chip are not here: a page count is a fact
  about a trail across all its days, which this view never lists, and a
  scope is what the index is FOR. What is shared is the grammar of the
  spine: one line down the left at the shell's --hairline, a --warm-accent
  dot with a canvas halo on every day (today adds the desktop's soft
  accent ring — the only day that needs telling apart), the day named by
  an `Eyebrow` beside the dot, then per trail a header `Row` (the name in
  Lora, inert — nothing here changes the scope; the index does that), a
  `<n> pins` chip in accent on a line of its own under the header, and
  the day's pages as push rows in a flush group. The dot, spine and chips
  rules are the index's own declarations, and MemoryScreen.test.js reads
  both files to hold them equal: a scoped style cannot cross two screens,
  so the test is what stops this from becoming a third drawing.

  PINS is one `RowGroup`. The status dimming stays on the wrapper div
  around each row and not on `Row` — PinsScreen's reasoning, repeated in
  its markup comment below.

  ── THE REGION IS THE CANVAS, and on this screen that is half a pair ────

  §1's row is "canvas, vertical drag | scroll; swipe up at scroll bottom →
  memory; swipe down at memory's top → page". The page root marks the first
  half. This is the second: without the region on THIS scroller, the
  gesture that brought the writer here has no return, and gestureOwner's
  `atScrollTop && space === "memory"` branch has no producer at all. The
  attribute goes on Screen's scroller for the same reason it does there —
  where the finger landed and whether the scroller is at its end have to
  describe one element.

  Which is also why the edges are reported upward rather than used here.

  ── THE ROWS GO SOMEWHERE NOW (Task 4) ────────────────────────────────

  §2's next sentence — "tapping a page pushes a reading view; 'continue'
  lives there. Trails are a pushed index" — landed, and it cost this file
  exactly what Task 3 predicted: `onPage` and `onPin` were already
  declared and defaulted to null, so the host wired them and no row
  changed. A `Row` with no `onSelect` still renders as inert markup with
  no chevron and no tab stop (Row's own header), which is what a host that
  passes neither still gets.

  THE TRAIL SCOPE ARRIVED WITH THE INDEX, and the shape is worth naming
  because it is not the shape the other filters have. The desktop narrows
  memory by trail from its sidebar; §2 replaces that sidebar with a pushed
  screen, so the CONTROL is on the bar (the second action, whose label is
  the scope) and the STATE is the host's `trailScope`, while the three
  sheet filters keep theirs there too. What this screen decides from it is
  one derivation — `trailScope()` expands a parent to its descendants —
  handed to the same `memoryPages` / `memoryPins` the other filters go
  through, so the timeline scopes for free and `memoryDays` never learns
  the scope exists.

  THE SCOPE IS NOT IN THE FILTER COUNT and IS in the "nothing matches"
  summary. memory-model.js's `memoryFilterSummary` carries the argument:
  the count labels a sheet with no trail control in it, and the summary is
  the only thing on screen that can say why an empty list is empty.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import Row from "./ui/Row.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Eyebrow from "./ui/Eyebrow.svelte";
  import Chip from "./ui/Chip.svelte";
  import Segment from "./ui/Segment.svelte";
  import Field from "./ui/Field.svelte";
  import Empty from "../lib/ui/Empty.svelte";
  import { navCollapsed } from "./nav-collapse.js";
  import { dayLabel } from "./page-model.js";
  import { pinRowLabel } from "./pin-label.js";
  import {
    DEFAULT_MODE,
    DEFAULT_SORT,
    MEMORY_MODES,
    memoryDays,
    memoryFilterCount,
    memoryFilterSummary,
    memoryGroups,
  memoryPinGroups,
    memoryPages,
    memoryPins,
    pageRowLabel,
    searchRowShowing,
    yesterdayOf,
  } from "./memory-model.js";
  import { trailActionLabel, trailScope, trailScopeLabel } from "./trail-index.js";

  /** @type {{
    pages?: any[],
    pins?: any[],
    lineages?: any[],
    loading?: boolean,
    todayStr: string,
    query?: string,
    matchingIds?: Set<string> | null,
    dateFilter?: {kind: string} | null,
    sort?: string,
    pinned?: boolean,
    trailScopeId?: string | null,
    onSearch?: ((query: string) => void) | null,
    onFilters?: (() => void) | null,
    onTrails?: (() => void) | null,
    onScrollEdges?: ((edges: {atTop: boolean, atBottom: boolean}) => void) | null,
    onPage?: ((page: any) => void) | null,
    onPin?: ((pin: any) => void) | null,
  }} */
  let {
    pages = [],
    pins = [],
    lineages = [],
    loading = false,
    todayStr,
    query = "",
    matchingIds = null,
    dateFilter = null,
    sort = DEFAULT_SORT,
    pinned = false,
    trailScopeId = null,
    onSearch = null,
    onFilters = null,
    onTrails = null,
    onScrollEdges = null,
    onPage = null,
    onPin = null,
  } = $props();

  /** Which of the desktop's three modes is showing. View state, so it
   *  lives here rather than in the host: nothing outside this screen reads
   *  it, and a root switch replaces the whole component (Stack keys the
   *  root entry by `active`), so it resets when memory is left. */
  let mode = $state(DEFAULT_MODE);

  let scrollTop = $state(0);
  /** navCollapsed's `collapsed` argument — the answer that was on screen at
   *  the previous scroll position, and nothing else may write it. */
  let bandMemory = $state(false);

  const collapsed = $derived(navCollapsed({ scrollTop, collapsed: bandMemory }));
  const searchShowing = $derived(searchRowShowing({ collapsed, query }));

  /** @param {{scrollTop: number, atTop: boolean, atBottom: boolean}} state */
  function handleScroll(state) {
    bandMemory = collapsed;
    scrollTop = state.scrollTop;
    onScrollEdges?.({ atTop: state.atTop, atBottom: state.atBottom });
  }

  const filterCount = $derived(memoryFilterCount({ dateFilter, sort, pinned }));
  const filtersLabel = $derived(filterCount > 0 ? `filters · ${filterCount}` : "filters");

  /** The scope, three ways: the filter it applies, the name that goes in
   *  the "nothing matches" body, and the label on the bar. All three come
   *  from trail-index.js so the control and the list cannot disagree about
   *  which trail is on. */
  const scope = $derived(trailScope({ lineages, selectedId: trailScopeId }));
  const scopeName = $derived(trailScopeLabel({ lineages, selectedId: trailScopeId }));
  const trailsLabel = $derived(trailActionLabel({ lineages, selectedId: trailScopeId }));

  /** Filters FIRST, and the order is not arbitrary: NavBar caps the bar at
   *  two and renders them left to right, so this is also which control
   *  survives if a third ever arrives. The sheet is the older, broader one
   *  — three axes at once — and the trail action beside it is the one whose
   *  label changes, which reads better at the end of the row than in the
   *  middle of it. */
  const actions = $derived([
    ...(onFilters ? [{ id: "filters", label: filtersLabel, onSelect: onFilters }] : []),
    ...(onTrails ? [{ id: "trails", label: trailsLabel, onSelect: onTrails }] : []),
  ]);

  const visiblePages = $derived(
    memoryPages({ pages, dateFilter, todayStr, pinned, scope, matchingIds }),
  );
  const visiblePins = $derived(memoryPins({ pins, dateFilter, todayStr, scope, query }));
  const groups = $derived(memoryGroups({ pages: visiblePages, sort }));
  const pinGroups = $derived(memoryPinGroups({ pins: visiblePins, lineages, scope }));
  const days = $derived(memoryDays({ pages: visiblePages, pins: visiblePins, lineages }));

  /** Whether the account has anything at all, before any control here
   *  narrowed it. It separates the two empty states — "nothing written
   *  yet" from "nothing matches" — and it is also what decides whether the
   *  mode segment is offered: three modes over an account with no writing
   *  are three ways to look at the same empty screen. */
  const hasAnything = $derived(pages.length > 0 || pins.length > 0);

  const trailNames = $derived(new Map(lineages.map((l) => [l.id, l.name])));
  const trailNameOf = (id) => (id ? trailNames.get(id) ?? "" : "");

  /** Both of dayLabel's reference dates come from this screen's one
   *  `todayStr`. Passing it only the first lets the second default to the
   *  real clock — see yesterdayOf, and the day header that read
   *  "yesterday" against a today it was not adjacent to. */
  const yesterday = $derived(yesterdayOf(todayStr));

  const summary = $derived(
    memoryFilterSummary({ query, trail: scopeName, dateFilter, sort, pinned }),
  );

  /** The two counts every empty state has to tell apart, per mode: how many
   *  rows this mode is showing, and whether it had any before the controls
   *  ran. "Nothing matches" over an account that has never had a pin is a
   *  lie about the filters; "no pins yet" over a filtered-out list is a lie
   *  about the account.
   *
   *  The timeline's pair is the whole list rather than the pages, and that
   *  is not laziness: `daysWithActivity` buckets pins as well as pages, so
   *  a day whose only writing was pinned still has a row there. */
  const modeRows = $derived(
    mode === "pins" ? visiblePins.length : mode === "pages" ? visiblePages.length : days.length,
  );
  const modeHasAny = $derived(
    mode === "pins" ? pins.length > 0 : mode === "pages" ? pages.length > 0 : hasAnything,
  );

  /** One vocabulary for a count of what was kept — the trail index's chip
   *  says it in the same words (`pinsChip` there), and the desktop's
   *  `.pins-chip` before either. */
  const pinsChip = (n) => `${n} ${n === 1 ? "pin" : "pins"}`;
</script>

<Screen region="canvas" onScroll={handleScroll}>
  {#snippet nav()}
    <NavBar title="memory" {collapsed} {actions} />
    {#if searchShowing}
      <div class="memory-search">
        <Field
          label="search"
          placeholder="search your writing…"
          value={query}
          onInput={(next) => onSearch?.(next)}
        />
      </div>
    {/if}
  {/snippet}

  {#if hasAnything}
    <div class="memory-modes">
      <Segment
        options={MEMORY_MODES}
        value={mode}
        onChange={(next) => (mode = next)}
        ariaLabel="memory mode"
      />
    </div>
  {/if}

  {#if loading && !hasAnything}
    <!-- "Nothing here" and "not read yet" are different facts, and a writer
         with two years of pages must not be told they have none while the
         read is in flight. PinsScreen's rule, with its guard: this state
         belongs to an EMPTY screen only. A re-read — the sort changing,
         memory being re-entered — keeps the list that is already on screen
         rather than blanking it for a round trip, which is the same call
         the host makes about its own lists on a failed read. -->
    <Empty>
      {#snippet title()}reading memory{/snippet}
    </Empty>
  {:else if !hasAnything}
    <Empty>
      {#snippet title()}no writing yet{/snippet}
      {#snippet body()}your pages appear here.{/snippet}
    </Empty>
  {:else if !modeHasAny}
    <!-- The desktop's own words for each of these. -->
    {#if mode === "pins"}
      <Empty>
        {#snippet title()}no pins yet{/snippet}
        {#snippet body()}what matters lives here. pin a line from the page to see it.{/snippet}
      </Empty>
    {:else}
      <Empty>
        {#snippet title()}no writing yet{/snippet}
        {#snippet body()}your pages appear here.{/snippet}
      </Empty>
    {/if}
  {:else if modeRows === 0}
    <!-- `hasActiveFilters` is not passed, and its absence is the honest
         reading of what that prop does: it gates the `actions` snippet and
         nothing else (Empty's own header). The way out of this state is the
         filters sheet the bar already offers, so there is no second control
         to put here — and passing a flag that renders nothing would say
         there is. The body names what is on instead. -->
    <Empty>
      {#snippet title()}nothing matches{/snippet}
      {#snippet body()}{summary}{/snippet}
    </Empty>
  {:else if mode === "pages"}
    <!-- KEYED ON THE GROUP'S FIRST PAGE, not on its heading. Measured on a
         device as a thrown `each_key_duplicate` that stopped the whole
         screen re-rendering: `clear filters` resets the sort to `date` and
         re-reads, so for one turn the screen holds an updated_at-ordered
         list while believing it is date-ordered — and `groupByDate` is
         run-length, so an interleaved list emits the same heading twice.
         A page id is unique whatever order the rows arrive in, which is
         what a key has to be; the heading is a label, and a label is not
         an identity. -->
    {#each groups as group (group.pages[0]?.id ?? group.label)}
      <RowGroup eyebrow={group.label}>
        {#each group.pages as p (p.id)}
          <Row
            label={pageRowLabel(p)}
            value={trailNameOf(p.lineage_id)}
            onSelect={onPage ? () => onPage(p) : null}
          />
        {/each}
      </RowGroup>
    {/each}
  {:else if mode === "trailmap"}
    <div class="memory-spine">
      {#each days as day (day.date)}
        <section class="memory-day" data-day={day.date}>
          <div class="memory-day-head">
            <span class="memory-day-dot" class:today={day.date === todayStr} aria-hidden="true"></span>
            <Eyebrow label={dayLabel(day.date, { todayDateStr: todayStr, yesterdayDateStr: yesterday })} />
          </div>
          {#each day.groups as group (group.lineageId)}
            <div class="memory-trail">
              <!--
                THE TRAIL'S NAME IS A LABEL, NOT A ROW. It was an inert
                `Row` — Lora, 44px, in the column where the taps are — so
                on a day with two trails the photograph showed four
                identical lines and nothing saying which two were pages
                (the fourth device pass: "the trail map needs to show
                clean, and separation between one day items"). The name
                is the interface naming a container, so it takes the
                interface's face, and the pages under it sit in a group
                with a surface and a line between them. Label, then card:
                the same distinction the rest of the shell already draws,
                rather than a new one invented here.

                Choosing a trail is still the index's job, one tap away on
                the bar. A control here would be the same choice offered
                from two places with two different results.
              -->
              <div class="memory-trail-head">
                <span class="memory-trail-name">{group.name}</span>
              </div>
              {#if group.pins.length > 0}
                <div class="memory-trail-chips">
                  <Chip tone="accent">{pinsChip(group.pins.length)}</Chip>
                </div>
              {/if}
              {#if group.pages.length > 0}
                <RowGroup>
                  {#each group.pages as p (p.id)}
                    <Row label={pageRowLabel(p)} onSelect={onPage ? () => onPage(p) : null} />
                  {/each}
                </RowGroup>
              {/if}
            </div>
          {/each}
        </section>
      {/each}
    </div>
  {:else}
    <!-- ONE GROUP PER TRAIL, when nothing is scoped. memoryPinGroups decides
         which groups there are and in what order; an empty label is its
         answer for a list that is already one trail's, and RowGroup draws no
         eyebrow for one — so the scoped screen renders exactly as it did. -->
    {#each pinGroups as group (group.id)}
      <RowGroup eyebrow={group.label}>
        {#each group.pins as pin (pin.id)}
          <!-- The status mark is PinsScreen's, for its reasons: a pin whose
               source page is gone survives orphaned with its cache intact
               (CLAUDE.md's pin pointer clause), so the row stays and the
               dimming is what says it is not whole. On the wrapper, not the
               Row: RowGroup rules between its direct children whatever they
               are, so the wrapper costs the group nothing. -->
          <div class="memory-pin" data-pin-status={pin.status ?? "open"}>
            <Row label={pinRowLabel(pin)} onSelect={onPin ? () => onPin(pin) : null} />
          </div>
        {/each}
      </RowGroup>
    {/each}
  {/if}
</Screen>

<style>
  /* The field's own row, under the bar and inside the nav band, so it
     scrolls with neither the list nor off the top of it. */
  .memory-search {
    padding: 0 var(--space-4) var(--space-2);
  }

  /* The segment scrolls with the list, as the pins screen's does. §2 gives
     the bar to the search field and names the segment beside the content;
     a second fixed band would eat the top of the first row on a short
     phone. Segment spreads the three modes across the band, so the row
     neither wraps nor scrolls sideways. */
  .memory-modes {
    padding: var(--space-3) var(--space-4);
  }

  /* THE SPINE, THE DOT AND THE CHIPS LINE. These were declared here and
     in TrailIndexScreen, declaration for declaration, with a test holding
     the pairs equal — a scoped style cannot be shared between two
     screens, and the pairing was what kept them one drawing. The index
     is gone (the fifth device pass made its one job a sheet) and this is
     the surviving copy; the test holds the grammar instead, which is
     what the pairing was protecting.

     The spine is a line at the hairline token, inset one column past the
     band so the dots sit on it. A dot is the accent with a three-pixel
     canvas halo, so the line does not run through it. */
  .memory-spine {
    margin-left: calc(var(--space-4) + var(--space-2));
    border-left: 1px solid var(--hairline);
  }

  .memory-day-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--space-6);
    padding: var(--space-1) 0;
  }

  /* Eyebrow's own inset and bottom gap are for a label ABOVE a group's
     surface; beside a dot the dot is the inset and the head's flex does
     the centring, so both are zeroed here. */
  .memory-day-head :global(.shell-eyebrow) {
    margin: 0;
  }

  .memory-day-dot {
    flex: 0 0 auto;
    width: 0.5rem;
    height: 0.5rem;
    margin-left: calc(-0.25rem - 0.5px);
    border-radius: 50%;
    background: var(--warm-accent);
    box-shadow: 0 0 0 3px var(--canvas-bg);
  }

  /* Today, the one day that needs telling apart now every dot is accent:
     the desktop's `.day-dot.today` ring (TrailMap.svelte) — the canvas
     halo, then a soft accent ring outside it. The index has no today
     rule because it lists days per trail, where which one is today is
     the label's job. */
  .memory-day-dot.today {
    box-shadow: 0 0 0 3px var(--canvas-bg), 0 0 0 4px color-mix(in srgb, var(--warm-accent) 35%, transparent);
  }

  /* The trail's name, in the interface face: this is the interface
     naming a container, and the pages under it are the writing. --ink
     rather than --ink-soft because it is still the writer's own word for
     the trail, not a caption — the tone the header's trail label takes
     for the same reason. */
  .memory-trail-name {
    display: block;
    padding: 0 var(--space-4);
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A day is a block of trails, and the eye needs to see where one ends.
     The spine carries the days' order; this carries their separation. */
  .memory-day + .memory-day {
    margin-top: var(--space-5);
  }

  .memory-trail + .memory-trail {
    margin-top: var(--space-4);
  }

  .memory-trail-head {
    min-height: var(--space-6);
    display: flex;
    align-items: center;
  }

  .memory-trail-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-2);
  }

  .memory-pin[data-pin-status="closed"] { opacity: 0.35; }
  .memory-pin[data-pin-status="orphaned"] { opacity: 0.55; }
</style>
