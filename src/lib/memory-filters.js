// Memory filter predicates + helpers, extracted from Memory.svelte so they
// can be tested in isolation and reused. Compose with AND.
//
// Filter shape (created via `emptyFilters()`):
// {
//   date: "all" | "today" | "week" | "month",
//   trails: Set<string>,         // lineage IDs (with descendants pre-expanded)
//   modes: Set<"discrete" | "continuous">,
//   pinned: boolean,             // has at least one open pin
//   hasBacklinks: boolean,
//   untrailedOnly: boolean,      // mutually exclusive with `trails`
// }
//
// `pinned`/`hasBacklinks` rely on PageSummary.pin_count / backlink_count
// populated by the Rust `get_thread` command.

import {
  getLocalDateStr,
  getYesterdayStr,
  getWeekAgoStr,
  getTwoWeeksAgoStr,
} from "./utils.js";
import { lineagePath } from "./trail-utils.js";

// Resolve a pin's day, falling back through the pages array when the
// API row lacks source_page_date. Mirrors the resolution done by
// daysWithActivity; pulled into a helper so all the trail-map helpers
// share the same logic.
function resolvePinDate(pin, pageById) {
  if (pin.source_page_date) return pin.source_page_date;
  if (pin.source_page_id && pageById.has(pin.source_page_id)) {
    return pageById.get(pin.source_page_id).date;
  }
  if (pin.created_at) return pin.created_at.slice(0, 10);
  return null;
}

function buildPageById(pages) {
  const m = new Map();
  for (const p of pages) if (p.id) m.set(p.id, p);
  return m;
}

export function emptyFilters() {
  return {
    date: "all",
    trails: new Set(),
    modes: new Set(),
    pinned: false,
    hasBacklinks: false,
    untrailedOnly: false,
  };
}

/**
 * Lower bound for the active date filter, or null when "all".
 * Returns a YYYY-MM-DD string; the predicate uses `page.date >= cutoff`.
 */
export function getDateCutoff(filter) {
  if (!filter || filter === "all") return null;
  if (filter === "today") return getLocalDateStr();
  if (filter === "week") return getWeekAgoStr();
  if (filter === "month") {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

/**
 * True when `page` passes every active filter. Predicates are AND-composed.
 * `lineageModeOf(lineageId) → "discrete" | "continuous" | null` lets us read
 * a page's mode without coupling this file to the lineage store shape.
 */
export function pageMatches(page, filters, lineageModeOf) {
  const cutoff = getDateCutoff(filters.date);
  if (cutoff && page.date < cutoff) return false;

  if (filters.untrailedOnly) {
    if (page.lineage_id != null) return false;
  } else if (filters.trails.size > 0) {
    if (!page.lineage_id || !filters.trails.has(page.lineage_id)) return false;
  }

  if (filters.modes.size > 0) {
    const mode = page.lineage_id ? lineageModeOf(page.lineage_id) : null;
    // "untrailed" cards have no mode and never match a mode chip.
    if (!mode || !filters.modes.has(mode)) return false;
  }

  if (filters.pinned && (page.pin_count ?? 0) === 0) return false;
  if (filters.hasBacklinks && (page.backlink_count ?? 0) === 0) return false;

  return true;
}

/**
 * Count how many filter dimensions are non-default. Used to know whether to
 * render the "clear all" button in the empty state.
 */
export function activeFilterCount(filters) {
  let n = 0;
  if (filters.date && filters.date !== "all") n++;
  if (filters.trails.size > 0) n++;
  if (filters.modes.size > 0) n++;
  if (filters.pinned) n++;
  if (filters.hasBacklinks) n++;
  if (filters.untrailedOnly) n++;
  return n;
}

/**
 * Toggling `untrailedOnly` on must clear any active trail selection (and vice
 * versa) — the two are conceptually exclusive. Returns a new filters object.
 */
export function toggleUntrailedOnly(filters) {
  const next = { ...filters, trails: new Set(filters.trails) };
  next.untrailedOnly = !filters.untrailedOnly;
  if (next.untrailedOnly) next.trails = new Set();
  return next;
}

// Applies a date filter to a list of items with .date (YYYY-MM-DD).
// `filter` is one of:
//   null | { kind: "all" }                     - pass-through
//   { kind: "today" }
//   { kind: "thisWeek" }                       - last 7 days inclusive
//   { kind: "thisMonth" }                      - last 30 days inclusive
//   { kind: "specific", date: "YYYY-MM-DD" }
//   { kind: "range", from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
// `todayStr` is the local today reference (passed in so the helper is pure).
export function applyDateFilter(items, filter, todayStr) {
  if (!filter || filter.kind === "all") return items;
  if (filter.kind === "today") {
    return items.filter((p) => p.date === todayStr);
  }
  if (filter.kind === "specific") {
    return items.filter((p) => p.date === filter.date);
  }
  if (filter.kind === "range") {
    return items.filter((p) => p.date >= filter.from && p.date <= filter.to);
  }
  if (filter.kind === "thisWeek" || filter.kind === "thisMonth") {
    const days = filter.kind === "thisWeek" ? 6 : 29; // inclusive: 7 or 30 days total
    const cutoff = isoDaysAgo(todayStr, days);
    return items.filter((p) => p.date >= cutoff && p.date <= todayStr);
  }
  return items;
}

// Apply trail scope to a list of items with .lineage_id.
// scope === null  → return everything (all trails).
// scope === "__untrailed__" → only items with lineage_id == null.
// scope is a string → only items whose lineage_id matches that one id.
// scope is a Set → only items whose lineage_id is in the set (used to
//   include a parent trail's descendants alongside the parent itself).
export function applyScopeFilter(items, scope) {
  if (scope == null) return items;
  if (scope === "__untrailed__") return items.filter((it) => it.lineage_id == null);
  if (scope instanceof Set) {
    if (scope.size === 0) return items;
    return items.filter((it) => it.lineage_id != null && scope.has(it.lineage_id));
  }
  return items.filter((it) => it.lineage_id === scope);
}

// Compute the trail chip's contents relative to the active sidebar
// selection. Returns an array of {id, name}:
//   - [] when the path is empty
//   - the full ancestor chain in all-trails view so the user can read
//     the hierarchy ("shizumu › v0.* › v0.3")
//   - just the leaf when a specific trail is active in the sidebar,
//     since the parent context is already established
//
// The helper never hides the chip — callers decide when to show the
// breadcrumb. Pin/page rows in memory always show it; trailmap's
// chrome-less blocks hide it for pages on the active trail (handled
// inline in TrailMap.svelte). `lineages` is unused now but kept for
// signature stability.
export function relativeLineagePath(path, activeLineageId, _lineages) {
  if (!Array.isArray(path) || path.length === 0) return [];
  if (!activeLineageId) return path;
  return [path[path.length - 1]];
}

// Expand a lineage id to a Set containing it and all of its descendants.
// `lineages` is the flat list (each with `id` and `parent_id`). Returns
// a Set with a single id when the trail has no children, or the larger
// transitive set when it does. Used by Memory's scope so selecting a
// parent surfaces pages/pins from every nested subtrail too.
export function descendantLineageIds(rootId, lineages) {
  if (!rootId || rootId === "__untrailed__") return rootId;
  const childrenByParent = new Map();
  for (const l of lineages || []) {
    if (!l || !l.parent_id) continue;
    if (!childrenByParent.has(l.parent_id)) childrenByParent.set(l.parent_id, []);
    childrenByParent.get(l.parent_id).push(l.id);
  }
  const out = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    const kids = childrenByParent.get(id);
    if (!kids) continue;
    for (const childId of kids) {
      if (out.has(childId)) continue; // defensive against malformed cycles
      out.add(childId);
      stack.push(childId);
    }
  }
  return out;
}

function isoDaysAgo(todayStr, days) {
  const d = new Date(todayStr + "T00:00:00");
  d.setDate(d.getDate() - days);
  // Format in local time to avoid TZ drift from toISOString().
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Group a date-sorted list of pages into labelled buckets for the memory
 * timeline. Labels are exact dates in the form "tue · 19 may" (current
 * year) or "tue · 19 may 2025" (other years). Consecutive pages sharing
 * the same date collapse into one bucket so multiple writes on one day
 * still group under a single header.
 */
export function groupByDate(list) {
  const today = getLocalDateStr();
  const dayNames = ["sun","mon","tue","wed","thu","fri","sat"];
  const monthNames = [
    "jan","feb","mar","apr","may","jun",
    "jul","aug","sep","oct","nov","dec",
  ];
  const todayYear = new Date(today + "T12:00:00").getFullYear();

  function labelFor(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    const weekday = dayNames[d.getDay()];
    const day = String(d.getDate());
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear();
    return year === todayYear
      ? `${weekday} · ${day} ${month}`
      : `${weekday} · ${day} ${month} ${year}`;
  }

  const out = [];
  let curLabel = null, arr = [];
  for (const p of list) {
    const label = labelFor(p.date);
    if (label !== curLabel) {
      if (curLabel) out.push({ label: curLabel, pages: arr });
      curLabel = label; arr = [p];
    } else arr.push(p);
  }
  if (curLabel) out.push({ label: curLabel, pages: arr });
  return out;
}

// Group pages and pins into one entry per date. Each entry has
// { date: "YYYY-MM-DD", pages: [...], pins: [...] }. Output is
// sorted by date descending (most recent first).
//
// Pins are bucketed by source_page_date (the day the pin was made
// on a page).
export function daysWithActivity(pages, pins) {
  const byDate = new Map();
  // Build a page-by-id index so pins without a denormalized
  // source_page_date can still resolve to their owning page's date.
  const pageById = new Map();
  for (const p of pages) {
    if (!p.date) continue;
    if (!byDate.has(p.date)) byDate.set(p.date, { date: p.date, pages: [], pins: [] });
    byDate.get(p.date).pages.push(p);
    if (p.id) pageById.set(p.id, p);
  }
  for (const pin of pins) {
    let d = pin.source_page_date;
    if (!d && pin.source_page_id && pageById.has(pin.source_page_id)) {
      d = pageById.get(pin.source_page_id).date;
    }
    if (!d && pin.created_at) d = pin.created_at.slice(0, 10);
    if (!d) continue;
    if (!byDate.has(d)) byDate.set(d, { date: d, pages: [], pins: [] });
    byDate.get(d).pins.push(pin);
  }
  const arr = Array.from(byDate.values());
  arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return arr;
}

// Like daysWithActivity, but enumerates every calendar day from the
// earliest active date through `todayStr` (inclusive). Empty days carry
// `pages: []` and `pins: []` so the trail-map can render a faint dot
// rather than collapsing the gap into a "{n} quiet days" label.
//
// Use this for the single-trail trail-map. The global variant should
// keep daysWithActivity — enumerating every day across all trails would
// balloon the list.
export function daysInRange(pages, pins, todayStr) {
  const sparse = daysWithActivity(pages, pins);
  if (sparse.length === 0) return [];
  // sparse is sorted desc; oldest is at the end, newest at the start.
  const oldest = sparse[sparse.length - 1].date;
  const newest = todayStr || sparse[0].date;
  if (newest < oldest) return sparse; // todayStr is somehow older — fall back.

  const byDate = new Map();
  for (const d of sparse) byDate.set(d.date, d);

  const out = [];
  const cur = new Date(newest + "T12:00:00");
  const end = new Date(oldest + "T12:00:00");
  while (cur >= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const day = String(cur.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${day}`;
    out.push(byDate.get(key) || { date: key, pages: [], pins: [] });
    cur.setDate(cur.getDate() - 1);
  }
  return out;
}

// Earliest date among the child trail's pages.
// Subtrails are spawned when their first page is created, so the spawn
// day is the minimum date across the child's page list.
export function subtrailSpawnDay(childPages) {
  if (!childPages || childPages.length === 0) return null;
  let min = childPages[0].date;
  for (const p of childPages) {
    if (p.date && p.date < min) min = p.date;
  }
  return min;
}

// Given a list of active dates in descending order, return the gap
// (in days) following each date until the next active date. Returns
// { afterDate, days } objects for each gap. The last entry never has
// a following gap.
export function gapRanges(activeDatesDesc) {
  const out = [];
  for (let i = 0; i < activeDatesDesc.length - 1; i++) {
    const a = activeDatesDesc[i];
    const b = activeDatesDesc[i + 1];
    const da = new Date(a + "T00:00:00");
    const db = new Date(b + "T00:00:00");
    const diff = Math.round((da - db) / 86400000) - 1;
    if (diff > 0) out.push({ afterDate: a, days: diff });
  }
  return out;
}

// Items for a single day, scoped to a trail (or "__untrailed__" for the
// untrailed bucket, or null for "all trails"). kind is "pages" or "pins".
// Pages are matched on `date`; pins on `source_page_date` if present, else
// derived from their `source_page_id`'s owning page date (caller supplies
// pre-resolved source_page_date, same shape daysWithActivity already uses).
export function dayItemsFor({ pages, pins, date, lineageId, kind }) {
  if (kind === "pages") {
    return pages.filter((p) => {
      if (p.date !== date) return false;
      if (lineageId == null) return true;
      if (lineageId === "__untrailed__") return p.lineage_id == null;
      return p.lineage_id === lineageId;
    });
  }
  if (kind === "pins") {
    const pageById = buildPageById(pages);
    return pins.filter((pin) => {
      const d = resolvePinDate(pin, pageById);
      if (d !== date) return false;
      if (lineageId == null) return true;
      if (lineageId === "__untrailed__") return pin.lineage_id == null;
      return pin.lineage_id === lineageId;
    });
  }
  return [];
}

// Per-trail breakdown for one day, used by DaySummaryPopover in global mode.
// Returns rows sorted by pin count desc, then page count desc, then name asc.
// Untrailed items collapse into a single row with name="untrailed" and path=[].
export function dayTrailBreakdownFor({ pages, pins, lineages, date }) {
  const byId = new Map();
  const bump = (lid) => {
    const key = lid || "__untrailed__";
    if (!byId.has(key)) byId.set(key, { lineageId: key, pageCount: 0, pinCount: 0 });
    return byId.get(key);
  };
  for (const p of pages) {
    if (p.date !== date) continue;
    bump(p.lineage_id).pageCount += 1;
  }
  const pageById = buildPageById(pages);
  for (const pin of pins) {
    if (resolvePinDate(pin, pageById) !== date) continue;
    bump(pin.lineage_id).pinCount += 1;
  }
  const rows = Array.from(byId.values()).map((r) => {
    if (r.lineageId === "__untrailed__") {
      return { ...r, name: "untrailed", path: [] };
    }
    const path = lineagePath(r.lineageId, lineages);
    const name = path.length > 0 ? path[path.length - 1].name : "(unknown)";
    return { ...r, name, path: path.map((l) => l.name) };
  });
  rows.sort((a, b) => {
    // Untrailed row always sinks to the bottom.
    const aU = a.lineageId === "__untrailed__";
    const bU = b.lineageId === "__untrailed__";
    if (aU !== bU) return aU ? 1 : -1;
    if (a.pinCount !== b.pinCount) return b.pinCount - a.pinCount;
    if (a.pageCount !== b.pageCount) return b.pageCount - a.pageCount;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

// Per-date trail groups for the redesigned trail map. Returns one entry
// per trail active on `date` (via pages OR pins), each with the trail's
// actual page list and pin list — not just counts. Sorted by page count
// desc, pin count desc, name asc.
//
// The trail map renders each entry as a block: pins chip + trail name
// header, then one clickable row per page showing its what_matters_now.
export function trailGroupsForDate({ pages, pins, lineages, date }) {
  const pageById = buildPageById(pages);
  const pagesByTrail = new Map();
  for (const p of pages) {
    if (p.date !== date) continue;
    const key = p.lineage_id || "__untrailed__";
    if (!pagesByTrail.has(key)) pagesByTrail.set(key, []);
    pagesByTrail.get(key).push(p);
  }
  const pinsByTrail = new Map();
  for (const pin of pins) {
    if (resolvePinDate(pin, pageById) !== date) continue;
    const key = pin.lineage_id || "__untrailed__";
    if (!pinsByTrail.has(key)) pinsByTrail.set(key, []);
    pinsByTrail.get(key).push(pin);
  }
  const allKeys = new Set([...pagesByTrail.keys(), ...pinsByTrail.keys()]);
  const groups = [];
  for (const key of allKeys) {
    const name = key === "__untrailed__"
      ? "untrailed"
      : (lineages.find((l) => l.id === key)?.name || "trail");
    const path = key === "__untrailed__" ? [] : lineagePath(key, lineages);
    groups.push({
      lineageId: key,
      name,
      // Raw {id, name}[] so callers can compute breadcrumbs relative to
      // the active sidebar trail (drop the ancestor chain that the user
      // is already viewing). Use group.path.map(l => l.name) when a
      // flat names array is needed.
      path,
      pages: pagesByTrail.get(key) || [],
      pins: pinsByTrail.get(key) || [],
    });
  }
  groups.sort((a, b) => {
    const aU = a.lineageId === "__untrailed__";
    const bU = b.lineageId === "__untrailed__";
    if (aU !== bU) return aU ? 1 : -1; // untrailed sinks
    if (b.pages.length !== a.pages.length) return b.pages.length - a.pages.length;
    if (b.pins.length !== a.pins.length) return b.pins.length - a.pins.length;
    return a.name.localeCompare(b.name);
  });
  return groups;
}

// One-line summary for the global-view spine per-day. Picks the dominant
// trail (most pins, then pages, then name asc — same rule as the breakdown),
// returns its first page's what_matters_now plus the day's roll-up counts.
// Returns null when the day has no activity.
export function dominantTrailSummary({ pages, pins, lineages, date }) {
  const breakdown = dayTrailBreakdownFor({ pages, pins, lineages, date });
  if (breakdown.length === 0) return null;
  const dominant = breakdown[0];
  let focusText = "no focus";
  if (dominant.lineageId !== "__untrailed__") {
    const dominantPage = pages.find(
      (p) => p.date === date && p.lineage_id === dominant.lineageId && p.what_matters_now,
    );
    if (dominantPage) focusText = dominantPage.what_matters_now;
  } else {
    const untrailedPage = pages.find(
      (p) => p.date === date && p.lineage_id == null && p.what_matters_now,
    );
    if (untrailedPage) focusText = untrailedPage.what_matters_now;
  }
  const pageCount = pages.filter((p) => p.date === date).length;
  const pageById = buildPageById(pages);
  const pinCount = pins.filter((pin) => resolvePinDate(pin, pageById) === date).length;
  return { focusText, trailCount: breakdown.length, pageCount, pinCount };
}
