// What memory shows, and what its two controls choose between.
//
// §2 gives memory four things: a search field that rides in the nav bar and
// collapses on scroll, a segmented control "for the existing modes",
// filters in a sheet, and content that is "the timeline (day blocks +
// spine, unchanged in substance)". Three of those four name something that
// already exists on the desktop, so almost nothing here is invented — the
// modes, their labels, their default, the date ranges and the sort are read
// off `src/components/Memory.svelte` and the panel it opens.
//
// WHAT THE TIMELINE ACTUALLY IS, because the spec's own words point at two
// files that render nothing. `src/components/memory/DayBlock.svelte` and
// `src/components/memory/TimelineSpine.svelte` exist and no surface imports
// either of them — checked with a tree-wide grep, which finds each named
// only in its own header. The timeline that ships is `TrailMap.svelte`,
// which draws its own spine inline (`.spine-track`, `.day-row`, `.day-dot`)
// over `daysWithActivity` + `trailGroupsForDate`. So "unchanged in
// substance" means those two helpers and the shape they produce — one row
// per day that has writing, and inside it one block per trail that wrote
// that day, with its pin count and its pages — and NOT the two orphaned
// components whose names the spec borrowed.
//
// The helpers are imported from `src/lib/memory-filters.js` rather than
// re-derived here. They are the desktop's, they are unit-tested there, and
// a second implementation of "which days have writing" is exactly the
// drift this file exists to avoid.
//
// ── the resting date range is `all`, and the desktop's is not ──────────
//
// `Memory.svelte` opens on `{ kind: "thisMonth" }`. That is right on a
// desktop, where the chip, the calendar and the "N pages" count are all on
// screen saying so at once. On a phone none of them are: the filters live
// behind a sheet, so a list silently cut at thirty days would be a filter
// the writer cannot see, applied before they have chosen anything. The
// canon's own sentence for this surface is "everything else lives in
// memory: search it, or open one trail, one date, pages, or pins" — a
// resting state that already hides last month does not say that.
//
// The list is capped anyway, by `getThread(limit)` at the host. That is a
// cap on how much was READ, which the writer can feel by scrolling to the
// end; a date filter is a cap on what is SHOWN out of what was read, which
// they cannot.

import {
  applyDateFilter,
  applyScopeFilter,
  daysWithActivity,
  groupByDate,
  trailGroupsForDate,
} from "../lib/memory-filters.js";
import { pinSearchText } from "../lib/pin-display.js";
// The summary names a picked day in the words the timeline's own
// headings use — see memoryFilterSummary.
import { dayLabel } from "./page-model.js";

/** The desktop's three modes, its labels, its order (Memory.svelte's own
 *  SegmentedControl). "trail map" is the desktop's word for the timeline
 *  §2 describes; renaming it here would give one surface two names for the
 *  view the writer switches between on both. */
export const MEMORY_MODES = Object.freeze([
  Object.freeze({ value: "pages", label: "pages" }),
  Object.freeze({ value: "trailmap", label: "trail map" }),
  Object.freeze({ value: "pins", label: "pins" }),
]);

/** Memory.svelte's own default. The timeline is what §2 calls the content
 *  of this screen, so it is what memory opens on. */
export const DEFAULT_MODE = "trailmap";

/** The date ranges, with the desktop's labels and kinds — DatePopover's
 *  four presets (:167-170), in its order.
 *
 *  The calendar underneath them was "deliberately absent" here for three
 *  phases, on the grounds that a month grid is its own primitive with its
 *  own baseline and §2 asked for a sheet rather than a date picker. The
 *  fourth device pass asked for the picker in as many words ("the filters
 *  does not show date picker similar to desktop"), and the sentence had
 *  already named what it would take: the primitive is `Calendar`
 *  (src/shell/ui/) over calendar-month.js, and it hands back a day the
 *  filter carries as `{kind: "specific", date}` — the kind
 *  `applyDateFilter` has understood all along. These four stay: a preset
 *  is one tap where a grid is two, and `today` is what a writer asks for
 *  most. */
export const DATE_RANGES = Object.freeze([
  Object.freeze({ value: "all", label: "all" }),
  Object.freeze({ value: "today", label: "today" }),
  Object.freeze({ value: "thisWeek", label: "this week" }),
  Object.freeze({ value: "thisMonth", label: "this month" }),
]);

/** See the header: `all`, not the desktop's `thisMonth`. */
export const DEFAULT_RANGE = "all";

/** MemoryFiltersPanel's sort segment, its labels and its values. The value
 *  is passed straight to `getThread(limit, 0, orderBy)`, so these two
 *  strings are the backend's vocabulary and not a display choice. */
export const SORTS = Object.freeze([
  Object.freeze({ value: "date", label: "date" }),
  Object.freeze({ value: "updated_at", label: "edited" }),
]);

export const DEFAULT_SORT = "date";

/** How long the field waits before it asks. Memory.svelte's own 200ms,
 *  exported so a test can assert against the number the app uses rather
 *  than against a second copy of it — PIN_TOAST_MS's precedent. */
export const SEARCH_DEBOUNCE_MS = 200;

/**
 * Whether the search row is on screen.
 *
 * The row rides in the nav band and collapses with it — `navCollapsed`
 * decides `collapsed`, and this adds the one exception that module cannot
 * know about, because the page root (its only other caller) has no field
 * in its bar.
 *
 * THE EXCEPTION: a live query. Search FILTERS the list here, as it does on
 * the desktop — non-matching pages leave the timeline entirely. Scrolling
 * those results past the collapse threshold with the row gone would leave
 * a writer looking at a short list with no visible cause and nothing to
 * clear. So while there is a query, the row stays and the query stays
 * legible.
 *
 * WHAT IS NOT AN EXCEPTION, and why: nothing here consults `keyboardOpen`.
 * `navCollapsed`'s keyboard clause is right for the page — the field the
 * keyboard came up for is in the CONTENT band there, so collapsing the bar
 * gives it room. On memory the keyboard's only cause is this row, inside
 * the bar, so honouring that clause would unmount the field the writer
 * just tapped, drop focus, and take the keyboard back down with it. The
 * host therefore passes `navCollapsed` no keyboard at all (its parameter
 * defaults to false), which is the module's own way of saying a screen has
 * no keyboard trigger, and the scroll hysteresis is left untouched.
 *
 * @param {object} state
 * @param {boolean} state.collapsed  navCollapsed's answer for the bar
 * @param {string} [state.query]
 * @returns {boolean}
 */
export function searchRowShowing({ collapsed, query = "" }) {
  if (!collapsed) return true;
  return query.trim() !== "";
}

/**
 * One list out of many `getPins` calls, deduped by id.
 *
 * "All trails" has to mean all: `getPins(lineageId)` walks ancestors
 * UPWARD from one trail, and `getPins(null)` returns only the global rows,
 * so no single call can answer for a whole account. The desktop fans out
 * across every lineage for exactly this reason (Memory.svelte's loadPins)
 * and dedupes, because the ancestor walk surfaces a parent's pin once per
 * descendant that asked.
 *
 * @param {any[][]} lists
 * @returns {any[]}
 */
export function mergePinRows(lists) {
  const seen = new Set();
  const out = [];
  for (const list of Array.isArray(lists) ? lists : []) {
    for (const row of Array.isArray(list) ? list : []) {
      if (!row || row.id == null || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/**
 * The pages the screen shows: trail scope, then date range, then
 * pinned-only, then search.
 *
 * `matchingIds` is the FTS5 answer (`search_pages`), narrowed to a Set by
 * the host. Null means no query — NOT "no results". An empty Set is a
 * query that matched nothing, and the two have to be told apart or a
 * screen with no query renders an empty list.
 *
 * `scope` is what the pushed trail index picked, already expanded to a
 * trail and its descendants (trail-index.js's `trailScope`). Null is "all
 * trails", which is what this screen opened on before the index existed.
 * The expansion happens THERE rather than here, because `applyScopeFilter`
 * takes either a Set or the untrailed sentinel and re-deriving which one
 * this is would be a second copy of that fork.
 *
 * @param {object} input
 * @param {any[]} [input.pages]
 * @param {{kind: string, date?: string, from?: string, to?: string}|null} [input.dateFilter]
 * @param {string} input.todayStr
 * @param {boolean} [input.pinned]
 * @param {Set<string>|string|null} [input.scope]
 * @param {Set<string>|null} [input.matchingIds]
 * @returns {any[]}
 */
export function memoryPages({
  pages = [],
  dateFilter = null,
  todayStr,
  pinned = false,
  scope = null,
  matchingIds = null,
}) {
  let rows = Array.isArray(pages) ? pages : [];
  rows = applyScopeFilter(rows, scope);
  rows = applyDateFilter(rows, dateFilter, todayStr);
  if (pinned) rows = rows.filter((p) => (p?.pin_count ?? 0) > 0);
  if (matchingIds) rows = rows.filter((p) => matchingIds.has(p?.id));
  return rows;
}

/**
 * The pins the screen shows.
 *
 * Two differences from the pages above, both the desktop's. A pin is
 * bucketed by `source_page_date` — the day it was made on a page — so the
 * date range stays the same question for both lists ("when"), and it falls
 * back to `created_at`'s day for a row that carries no source date.
 *
 * And the query is matched HERE rather than by FTS5: `pages_fts` indexes
 * pages, not pins, so the ids it returns can say nothing about a pin.
 * `pinSearchText` is the desktop's haystack, and its own comment records
 * why a local walk is not good enough — it missed a block's title (a node
 * attribute, not a text node) and returned raw JSON for anything it did
 * not classify as a board, so "paragraph" matched schema keys nobody
 * wrote.
 *
 * The trail scope is the pin's OWN `lineage_id` — the trail it belongs to
 * — and not the trail of the page it was taken on, which is the desktop's
 * call and its reason: "the pin's current scope rather than its birth
 * trail, so reassigned pins" follow where they were moved to
 * (Memory.svelte:439). `applyScopeFilter` reads that field for both lists,
 * which is what keeps one selection meaning one thing on both.
 *
 * @param {object} input
 * @param {any[]} [input.pins]
 * @param {{kind: string, date?: string, from?: string, to?: string}|null} [input.dateFilter]
 * @param {string} input.todayStr
 * @param {Set<string>|string|null} [input.scope]
 * @param {string} [input.query]
 * @returns {any[]}
 */
export function memoryPins({ pins = [], dateFilter = null, todayStr, scope = null, query = "" }) {
  const stamped = (Array.isArray(pins) ? pins : []).map((pin) => ({
    ...pin,
    date: pin?.source_page_date || (pin?.created_at ? pin.created_at.slice(0, 10) : ""),
  }));
  let rows = applyScopeFilter(stamped, scope);
  rows = applyDateFilter(rows, dateFilter, todayStr);
  const needle = query.trim().toLowerCase();
  if (needle) {
    rows = rows.filter((pin) => pinSearchText(pin).toLowerCase().includes(needle));
  }
  return rows;
}

/** What the heading says for pins that belong to no trail. Last in the list
 *  and named: a group with no heading, under a list of headed ones, reads as
 *  a rendering fault rather than as a category. */
export const UNTRAILED_PINS_LABEL = "no trail";

/** And for a pin whose trail this screen cannot name — deleted on another
 *  device, or a lineage list that has not re-read yet. The pin is still the
 *  writer's, so it is shown and the heading says what is known. */
export const UNKNOWN_TRAIL_LABEL = "a trail that is no longer listed";

/**
 * The pins mode's buckets: one per trail, in the trail list's own order.
 *
 * ASKED FOR, from a phone: "when all trails selected the pins tab: pins
 * should be grouped by trails to have clear vision". Across an account with
 * several trails the flat list is every pin ever kept in one column, with
 * nothing saying which project each belongs to — which is the opposite of
 * what pin × trail is for. The canon calls that cross-product the six-month
 * executive summary; a summary that does not say what it is summarising is
 * a list.
 *
 * ONLY WHEN NOTHING IS SCOPED. With one trail selected the screen is already
 * showing one trail's pins and the heading would repeat the control above
 * it, so the single unlabelled group is kept — which is exactly what the
 * screen renders today, and why the scoped case needs no change at the call
 * site.
 *
 * THE TRAIL LIST'S ORDER, not the pins'. `getPins` comes back ordered by
 * when each pin was made, so grouping by first sighting would reshuffle the
 * headings whenever a pin was added — under a reader who is scanning for
 * one of them. The lineage list is stable, so the headings are.
 *
 * A trail with no pins gets no heading: an empty group is a heading over
 * nothing, and the writer did not ask which trails exist (the trail index
 * answers that) but where their pins are.
 *
 * EACH GROUP CARRIES AN `id`, AND IT IS NOT THE LABEL. Two trails may be
 * named the same thing — nothing stops a writer calling two projects `the
 * book` — and a caller keying its markup on the heading would throw
 * `each_key_duplicate` and stop re-rendering the screen. That is not
 * hypothetical: it is what the pages mode did on a device, keyed on
 * `groupByDate`'s heading, and it took the filters sheet down with it. A
 * label is a label; an identity is an id.
 *
 * THIS DECISION EXISTS TWICE RIGHT NOW. `groupPinsByTrail` in
 * src/lib/memory-filters.js on `main` is the same function, written the
 * same day against the same report, because the desktop needed it too and
 * the two trees are several hundred commits apart — the shared module this
 * belongs in would not reach the phone until a merge. When this branch next
 * takes main, THIS copy goes and the import comes from there; the
 * duplication is a dated thing to undo, not a second opinion to keep.
 *
 * @param {object} input
 * @param {any[]} [input.pins]  already filtered — memoryPins ran first
 * @param {any[]} [input.lineages]
 * @param {Set<string>|string|null} [input.scope]  null is "all trails"
 * @returns {{label: string, pins: any[]}[]}
 */
export function memoryPinGroups({ pins = [], lineages = [], scope = null } = {}) {
  const rows = Array.isArray(pins) ? pins : [];
  if (rows.length === 0) return [];
  if (scope) return [{ id: "scoped", label: "", pins: rows }];

  const known = Array.isArray(lineages) ? lineages : [];
  const byTrail = new Map();
  for (const pin of rows) {
    const id = pin?.lineage_id ?? null;
    if (!byTrail.has(id)) byTrail.set(id, []);
    byTrail.get(id).push(pin);
  }

  const groups = [];
  for (const lineage of known) {
    const held = byTrail.get(lineage.id);
    if (!held) continue;
    groups.push({ id: lineage.id, label: lineage.name || UNKNOWN_TRAIL_LABEL, pins: held });
    byTrail.delete(lineage.id);
  }
  // Whatever is left names a trail the list does not carry. Gathered into
  // one group rather than one per missing id: the writer cannot tell two
  // trails apart when neither has a name, and several identical headings
  // would say less than one.
  const orphanTrails = [];
  for (const [id, held] of byTrail) {
    if (id === null) continue;
    orphanTrails.push(...held);
  }
  if (orphanTrails.length > 0) {
    groups.push({ id: "__unknown__", label: UNKNOWN_TRAIL_LABEL, pins: orphanTrails });
  }
  const loose = byTrail.get(null);
  if (loose) groups.push({ id: "__untrailed__", label: UNTRAILED_PINS_LABEL, pins: loose });
  return groups;
}

/**
 * The pages mode's buckets.
 *
 * `groupByDate` labels by date, which is only meaningful while the list IS
 * in date order. Sorted by `updated_at` the same grouping would print date
 * headers over a list that ignores them, so the desktop collapses to one
 * bucket there and names it — its words, kept.
 *
 * @param {object} input
 * @param {any[]} [input.pages]
 * @param {string} [input.sort]
 * @returns {{label: string, pages: any[]}[]}
 */
export function memoryGroups({ pages = [], sort = DEFAULT_SORT }) {
  const rows = Array.isArray(pages) ? pages : [];
  if (sort === "updated_at") {
    return rows.length > 0 ? [{ label: "recently edited", pages: rows }] : [];
  }
  return groupByDate(rows);
}

/**
 * The timeline: one entry per day that has writing, each carrying the
 * trail blocks for that day.
 *
 * Days with no writing are absent rather than drawn faint. `daysInRange`
 * is the other helper in that file and it enumerates every calendar day
 * between the oldest and today — which the desktop reserves for the
 * single-trail view and explicitly warns against across all trails
 * ("enumerating every day across all trails would balloon the list").
 *
 * MEMORY HAS A TRAIL SCOPE NOW — the pushed index landed in Task 4 — and
 * the warning still decides this, which is why the sentence is rewritten
 * rather than deleted. The lists this receives are already scoped
 * (`memoryPages` / `memoryPins` apply it first), so a single-trail view
 * IS reachable here; what is not reachable is knowing that the scope is a
 * single trail rather than a parent and every trail nested under it, which
 * is what `trailScope` hands the filters. `daysInRange` over a parent
 * scope is the all-trails balloon again, just with fewer trails in it. A
 * gapless calendar therefore stays out until something needs it and can
 * say which scope it is safe for.
 *
 * @param {object} input
 * @param {any[]} [input.pages]
 * @param {any[]} [input.pins]
 * @param {any[]} [input.lineages]
 * @returns {{date: string, groups: any[]}[]}
 */
export function memoryDays({ pages = [], pins = [], lineages = [] }) {
  return daysWithActivity(pages, pins).map((day) => ({
    date: day.date,
    groups: trailGroupsForDate({ pages, pins, lineages, date: day.date }),
  }));
}

/**
 * The day before this one, derived rather than read off the clock.
 *
 * `dayLabel` (page-model.js) takes BOTH reference dates and defaults each
 * to the real clock independently. Passing it only `todayDateStr` is a
 * trap: its `yesterdayDateStr` then comes from `getYesterdayStr()`, so a
 * screen handed any today but the real one gets two reference dates that
 * are not adjacent — the day before its own today reads as a month-day
 * label, and whatever the machine's clock calls yesterday reads as
 * "yesterday" wherever it appears in the list. Production passes the real
 * today and never sees it; a test fixture, a device whose clock is being
 * corrected, and a session left open across midnight all do.
 *
 * Noon-anchored, like `isoDaysAgo` in memory-filters.js, so a DST boundary
 * cannot land the arithmetic on the wrong calendar day.
 *
 * @param {string} todayStr  YYYY-MM-DD, local
 * @returns {string}
 */
export function yesterdayOf(todayStr) {
  const d = new Date(`${todayStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return todayStr;
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The writer's own focus line, which is what both the timeline and the
 *  pages list label a page with (TrailMap's `.page-row`, and the desktop
 *  card's title). A page with none has not been given one — "untitled" is
 *  the desktop's word for that and it is honest: the row exists, it just
 *  has no name yet. */
export function pageRowLabel(page) {
  const focus = page?.what_matters_now;
  return typeof focus === "string" && focus.trim() ? focus.trim() : "untitled";
}

/**
 * How many filters are on, for the label on the bar's one action.
 *
 * Counted against THIS screen's resting state, not against
 * `activeFilterCount`'s. That helper counts `date !== "all"` over a
 * different filters object (a legacy string field, plus trails, modes and
 * backlinks this screen does not offer), and it would report the desktop's
 * opening state as one filter deep. Here the count answers exactly one
 * question: has the writer changed anything from what the screen opened
 * with. The search box is not in it — the field is visible whenever a
 * query is live (searchRowShowing above), so counting it would put the
 * same fact in two places.
 *
 * @param {object} state
 * @param {{kind: string}|null} [state.dateFilter]
 * @param {string} [state.sort]
 * @param {boolean} [state.pinned]
 * @returns {number}
 */
export function memoryFilterCount({ dateFilter = null, sort = DEFAULT_SORT, pinned = false }) {
  let n = 0;
  const kind = dateFilter?.kind ?? DEFAULT_RANGE;
  if (kind !== DEFAULT_RANGE) n++;
  if (sort !== DEFAULT_SORT) n++;
  if (pinned) n++;
  return n;
}

/**
 * What is narrowing the list, in the writer's own vocabulary.
 *
 * This is the body of the "nothing matches" state, and it exists because
 * the alternative is a screen that has hidden everything and will not say
 * why. The desktop's `fmtFilterSummary` only ever returns "pinned" or the
 * word "filters", which is the version of this that says nothing; this one
 * names each thing that is on, in the same words its control uses.
 *
 * THE TRAIL SCOPE IS IN HERE AND NOT IN THE COUNT ABOVE, which is the one
 * asymmetry in this pair and it is deliberate. That count labels the
 * `filters` action, and the sheet that action opens has no trail control
 * in it — counting the scope there would offer a way to clear a filter
 * the sheet cannot see. This string is the body of "nothing matches",
 * whose whole job is to say what narrowed the list, and a trail scope that
 * hid everything without naming itself is exactly the screen that has
 * hidden everything and will not say why. Its control is the other action
 * on the same bar, which is where the writer clears it.
 *
 * @param {object} state
 * @param {string} [state.query]
 * @param {string|null} [state.trail]  the scope's name, or null when off
 * @param {{kind: string}|null} [state.dateFilter]
 * @param {string} [state.sort]
 * @param {boolean} [state.pinned]
 * @returns {string}
 */
export function memoryFilterSummary({
  query = "",
  trail = null,
  dateFilter = null,
  sort = DEFAULT_SORT,
  pinned = false,
  todayDateStr = undefined,
  yesterdayDateStr = undefined,
}) {
  const parts = [];
  if (typeof trail === "string" && trail.trim()) parts.push(trail.trim());
  const q = query.trim();
  if (q) parts.push(`“${q}”`);
  const kind = dateFilter?.kind ?? DEFAULT_RANGE;
  if (kind !== DEFAULT_RANGE) {
    // A day picked off the calendar says the day, not the word
    // `specific` — the summary is the body of "nothing matches", and the
    // writer needs to read which day they are looking at. `dayLabel`
    // gives it the same words the timeline's own headings use.
    if (kind === "specific" && dateFilter?.date) {
      parts.push(dayLabel(dateFilter.date, { todayDateStr, yesterdayDateStr }));
    } else {
      const range = DATE_RANGES.find((r) => r.value === kind);
      parts.push(range ? range.label : kind);
    }
  }
  if (sort !== DEFAULT_SORT) {
    const order = SORTS.find((s) => s.value === sort);
    if (order) parts.push(order.label);
  }
  if (pinned) parts.push("pinned only");
  return parts.join(" · ");
}
