<!-- src/components/memory/MemoryFiltersPanel.svelte -->
<!--
  MemoryFiltersPanel — unified filter surface for Memory view. Renders
  the same content whether wrapped in a BottomSheet (phone) or a
  Popover (desktop). Per phase A spec:
  - trail picker (sectioned list)
  - date range (preset buttons + inline calendar via DatePopover inline)
  - sort (by date / by recently edited)
  - filters (pinned only; on page when scope allows)
-->
<script>
  import SidebarNavRow from "../../lib/ui/SidebarNavRow.svelte";
  import SectionHeader from "../../lib/ui/SectionHeader.svelte";
  import Chip from "../../lib/ui/Chip.svelte";
  import SegmentedControl from "../../lib/ui/SegmentedControl.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import DatePopover from "./DatePopover.svelte";

  /** @type {{
    lineageTree: any[],
    activeLineageId: string | null | "__untrailed__",
    setLineage: (id: string | null | "__untrailed__") => void,
    visibleLineageTree: any[],
    collapsedTrails: Set<string>,
    toggleTrailCollapse: (id: string) => void,
    dateFilter: any,
    todayStr: string,
    activityByDate: Record<string, { pages: number, pins: number }>,
    onDateChange: (f: any) => void,
    sort: "date" | "updated_at",
    onSortChange: (s: "date" | "updated_at") => void,
    pinned: boolean,
    togglePinned: () => void,
    showOnPage: boolean,
    onPageToggle?: () => void,
    onPageCount?: number,
    activeFilters: number,
    clearAll: () => void,
    untrailedSentinel: string,
    showTrailNav?: boolean,
  }} */
  let {
    lineageTree, activeLineageId, setLineage, visibleLineageTree,
    collapsedTrails, toggleTrailCollapse,
    dateFilter, todayStr, activityByDate, onDateChange,
    sort, onSortChange,
    pinned, togglePinned,
    showOnPage = false, onPageToggle, onPageCount,
    activeFilters, clearAll,
    untrailedSentinel,
    // Trail navigation lives in the permanent left sidebar on desktop, so the
    // desktop filters popover omits it (showTrailNav=false). On phone there is
    // no sidebar, so the filters bottom-sheet is its home (showTrailNav=true).
    showTrailNav = true,
  } = $props();
</script>

<div class="filters-panel">
  {#if showTrailNav}
    <SectionHeader label="trail" count={lineageTree.length} />
    <SidebarNavRow
      active={activeLineageId === null}
      accent={activeLineageId === null}
      onClick={() => setLineage(null)}
    >all trails</SidebarNavRow>
    {#each visibleLineageTree as trail (trail.id)}
      <SidebarNavRow
        active={activeLineageId === trail.id}
        accent={activeLineageId === trail.id}
        count={trail.pageCount}
        indent={trail.depth * 1.125}
        tag={trail.mode === "continuous" ? "continuous" : "discrete"}
        onClick={() => setLineage(trail.id)}
      >
        {#if trail.hasChildren}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="trail-chevron"
            onclick={(e) => { e.stopPropagation(); toggleTrailCollapse(trail.id); }}
          >{collapsedTrails.has(trail.id) ? "▸" : "▾"}</span>
        {:else if trail.depth > 0}
          <span class="trail-chevron-spacer" aria-hidden="true"></span>
        {/if}
        {trail.name}
      </SidebarNavRow>
    {/each}
    <SidebarNavRow
      active={activeLineageId === untrailedSentinel}
      accent={activeLineageId === untrailedSentinel}
      onClick={() => setLineage(untrailedSentinel)}
    >untrailed</SidebarNavRow>
  {/if}

  <SectionHeader label="date" />
  <div class="inline-date">
    <DatePopover
      anchor={null}
      open={true}
      inline={true}
      filter={dateFilter}
      {todayStr}
      {activityByDate}
      onChange={onDateChange}
      onClose={() => {}}
    />
  </div>

  <SectionHeader label="sort" />
  <div class="chip-row">
    <SegmentedControl
      options={[
        { value: "date", label: "date" },
        { value: "updated_at", label: "edited" },
      ]}
      value={sort}
      onChange={(v) => onSortChange(v)}
      ariaLabel="sort order"
    />
  </div>

  <SectionHeader label="filter" />
  <div class="chip-row">
    <Chip active={pinned} onClick={togglePinned}>pinned only</Chip>
    {#if onPageToggle}
      <Chip active={showOnPage} onClick={onPageToggle}>on page{typeof onPageCount === "number" ? ` (${onPageCount})` : ""}</Chip>
    {/if}
  </div>

  {#if activeFilters > 0}
    <div class="clear-row">
      <Button variant="subtle" onClick={clearAll}>clear all filters</Button>
    </div>
  {/if}
</div>

<style>
  .filters-panel {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0;
  }
  .inline-date {
    padding: 0.5rem 0;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.375rem 0.5rem;
  }
  .clear-row {
    margin-top: 0.75rem;
    padding: 0 0.5rem;
  }
  .trail-chevron {
    display: inline-block;
    width: 1rem;
    text-align: center;
    cursor: pointer;
    opacity: 0.55;
  }
  .trail-chevron-spacer {
    display: inline-block;
    width: 1rem;
  }
</style>
