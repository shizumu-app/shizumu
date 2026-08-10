<!--
  ThreadCard — Memory/Thread row, now composed on top of ui/Card.

  Continuous-trail variant keeps its dayMarker expander; the outer ui/Card is
  rendered without onClick so the inner head and expand button can each be
  independently clickable without nested-button issues.
  Discrete variant wires onClick directly into ui/Card.

  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component
  visual specs · `Card`.
-->
<script>
  import { getLocalDateStr, getYesterdayStr } from "../lib/utils.js";
  import { extractSnippetWithMatch } from "../lib/snippet.js";
  import Card from "../lib/ui/Card.svelte";
  import ProseHTML from "../lib/render/ProseHTML.svelte";
  import { cardCacheKey } from "../lib/render/doc-renderer.js";

  /** @type {{
   *   summary: any,
   *   dimmed?: boolean,
   *   focused?: boolean,
   *   lineageName?: string | null,
   *   lineageMode?: string | null,
   *   lineagePath?: Array<{ id: string, name: string }>,
   *   showTrailName?: boolean,
   *   searchQuery?: string,
   *   zoom?: "condensed" | "standard" | "expanded",
   *   onclick: () => void,
   * }} */
  let {
    summary,
    dimmed = false,
    focused = false,
    lineageName = null,
    lineageMode = null,
    lineagePath = [],
    showTrailName = true,
    searchQuery = "",
    zoom = "standard",
    onclick,
  } = $props();

  // Breadcrumb label: "shizumu" for a root trail, "shizumu › w" for a
  // Full chain so all-trails view reads the hierarchy ("a › b › c").
  // Specific-trail callers pass a 1-element path so the chip degrades
  // to just the leaf name without changes here.
  let trailBreadcrumb = $derived.by(() => {
    if (lineagePath && lineagePath.length > 0) {
      return lineagePath.map((l) => l.name).join(" › ");
    }
    return lineageName || null;
  });

  // Expanded zoom previews the doc inline. Memoized by (page_id, updated_at)
  // so scroll/sort/filter cycles don't re-parse every visible card's doc.
  const PREVIEW_MAX_NODES = 8;
  let previewCacheKey = $derived(cardCacheKey(summary, PREVIEW_MAX_NODES));

  let snippet = $derived(
    searchQuery && searchQuery.trim().length > 0
      ? extractSnippetWithMatch(summary.content_json, searchQuery)
      : null,
  );

  let isContinuous = $derived(lineageMode === "continuous");
  let expanded = $state(false);

  function formatDate(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    const today = getLocalDateStr();
    const yesterday = getYesterdayStr();
    if (dateStr === today) return "today";
    if (dateStr === yesterday) return "yesterday";
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  function extractDayMarkers(jsonStr) {
    if (!jsonStr) return [];
    try {
      const doc = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
      const out = [];
      walk(doc, out);
      return out;
    } catch {
      return [];
    }
  }

  function walk(node, out) {
    if (!node) return;
    if (node.type === "dayMarker") {
      out.push({
        date: node.attrs?.date || "",
        whatMatters: node.attrs?.whatMatters || "",
      });
    }
    if (Array.isArray(node.content)) {
      for (const c of node.content) walk(c, out);
    }
  }

  let dayMarkers = $derived(isContinuous ? extractDayMarkers(summary.content_json) : []);

  function toggleExpand(e) {
    e.stopPropagation();
    expanded = !expanded;
  }
</script>

<div class="thread-card zoom-{zoom}">
{#if isContinuous}
  <Card focused={focused} dimmed={dimmed} variant="boxed">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="card-grid cont-head" onclick={onclick}>
      <div class="title-col">
        <span class="title-line" class:empty={!lineageName}>
          {lineageName || "untitled"}
        </span>
        {#if showTrailName && trailBreadcrumb}
          <span class="trail-chip" class:nested={lineagePath.length > 1}>{trailBreadcrumb}</span>
        {/if}
      </div>
      <div class="side-col">
        {#if dayMarkers.length > 0 && zoom !== "condensed"}
          <button class="expand-btn" onclick={toggleExpand} aria-label="toggle day list">
            {expanded ? "collapse" : `${dayMarkers.length} day${dayMarkers.length !== 1 ? "s" : ""}`}
          </button>
        {/if}
        {#if summary.backlink_count > 0}
          <span class="backlink-badge" aria-label="{summary.backlink_count} backlink{summary.backlink_count === 1 ? '' : 's'}">↩ {summary.backlink_count}</span>
        {/if}
      </div>
    </div>

    {#if expanded && dayMarkers.length > 0 && zoom !== "condensed"}
      <ul class="marker-list">
        {#each [...dayMarkers].reverse() as m}
          <li class="marker-row">
            <span class="marker-date">{formatDate(m.date)}</span>
            <span class="marker-sep">·</span>
            <span class="marker-focus">{m.whatMatters || "no focus set"}</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if zoom === "expanded" && summary.content_json}
      <div class="zoom-preview">
        <ProseHTML doc={summary.content_json} maxNodes={PREVIEW_MAX_NODES} cacheKey={previewCacheKey} />
        <div class="zoom-fade" aria-hidden="true"></div>
      </div>
    {/if}

  </Card>
{:else}
  <Card focused={focused} dimmed={dimmed} onClick={onclick} variant="boxed">
    <div class="card-grid">
      <div class="title-col">
        <span class="title-line" class:empty={!summary.what_matters_now}>
          {summary.what_matters_now || "untitled page"}
        </span>
        {#if zoom !== "condensed"}
          {#if snippet}
            <span class="snippet-line"
              >{snippet.before}<mark>{snippet.match}</mark>{snippet.after}</span
            >
          {:else if summary.preview_lines && summary.preview_lines.length > 0}
            <span class="snippet-line">{summary.preview_lines[0]}</span>
          {/if}
        {/if}
        {#if showTrailName && trailBreadcrumb}
          <span class="trail-chip" class:nested={lineagePath.length > 1}>{trailBreadcrumb}</span>
        {/if}
      </div>
      <div class="side-col">
        {#if summary.backlink_count > 0}
          <span class="backlink-badge" aria-label="{summary.backlink_count} backlink{summary.backlink_count === 1 ? '' : 's'}">↩ {summary.backlink_count}</span>
        {/if}
      </div>
    </div>

    {#if zoom === "expanded" && summary.content_json}
      <div class="zoom-preview">
        <ProseHTML doc={summary.content_json} maxNodes={PREVIEW_MAX_NODES} cacheKey={previewCacheKey} />
        <div class="zoom-fade" aria-hidden="true"></div>
      </div>
    {/if}

  </Card>
{/if}
</div>

<style>
  /* Zoom density. Drives card padding + preview presence:
     - condensed: one-line stack; no preview/snippet
     - standard: today's card (focus + snippet/preview)
     - expanded: standard + inline ProseHTML preview, ellipsis fade */
  .thread-card { display: block; }
  .thread-card.zoom-condensed :global(.card) { padding: 0.375rem 0.25rem; }
  .thread-card.zoom-condensed .title-line {
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  /* Hairline two-column row. Card primitive supplies the bottom-border;
     no background, border, radius, or shadow on the body. */
  .card-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 0.75rem;
    align-items: start;
  }
  .cont-head { cursor: pointer; }

  .title-col {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .title-line {
    font-family: "Lora", Georgia, serif;
    font-size: 0.9375rem;
    color: var(--ink);
    opacity: 0.92;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .title-line.empty {
    opacity: 0.55;
  }
  :global(.card.clickable:hover) .title-line {
    color: var(--warm-accent);
  }

  .snippet-line {
    font-family: "Lora", Georgia, serif;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.55;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .snippet-line mark {
    background: color-mix(in srgb, var(--warm-accent) 25%, transparent);
    color: inherit;
    font-weight: 500;
    padding: 0 0.0625rem;
    border-radius: 0.125rem;
  }

  .side-col {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.125rem;
    font-family: "Inter", sans-serif;
    flex-shrink: 0;
  }
  .trail-chip {
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.625rem;
    color: var(--warm-accent);
    opacity: 0.92;
    padding: 0.0625rem 0.4375rem;
    border-radius: 0.625rem;
    background: var(--warm-accent-soft);
    border: 1px solid color-mix(in srgb, var(--warm-accent) 25%, transparent);
    align-self: flex-start;
    margin-top: 0.1875rem;
  }
  .backlink-badge {
    font-family: "Inter", sans-serif;
    font-size: 0.5625rem;
    color: var(--ink);
    opacity: 0.55;
    letter-spacing: 0.02em;
  }

  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .snippet-line { display: none; }
  }

  .zoom-preview {
    position: relative;
    margin-top: 0.5rem;
    max-height: 14rem;
    overflow: hidden;
  }
  .zoom-preview :global(.prose) {
    font-size: 0.875rem;
    line-height: 1.55;
    opacity: 0.75;
  }
  .zoom-fade {
    position: absolute;
    inset: auto 0 0 0;
    height: 2.5rem;
    pointer-events: none;
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--canvas-bg) 0%, transparent),
      var(--canvas-bg) 90%
    );
  }

  .expand-btn {
    background: none; border: none; cursor: pointer;
    font-family: "Inter", sans-serif; font-size: 0.625rem;
    color: var(--ink); opacity: 0.55;
    padding: 0.125rem 0.375rem; border-radius: 0.25rem;
    flex-shrink: 0;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .expand-btn:hover { opacity: 0.92; background: color-mix(in srgb, var(--ink) 6%, transparent); }

  .marker-list {
    list-style: none; padding: 0.625rem 0 0.375rem;
    margin: 0.625rem 0 0;
    border-top: 1px dashed color-mix(in srgb, var(--ink) 8%, transparent);
    max-height: 13.75rem; overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--ink) 10%, transparent) transparent;
  }

  .marker-row {
    display: flex; align-items: baseline; gap: 0.5rem;
    padding: 0.25rem 0;
  }

  .marker-date {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem; color: var(--ink); opacity: 0.55;
    min-width: 4.5rem; flex-shrink: 0;
  }

  .marker-sep {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem; opacity: 0.35;
  }

  .marker-focus {
    font-family: "Lora", serif; font-style: italic;
    font-size: 0.8125rem; color: var(--ink); opacity: 0.75;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1;
  }
</style>
