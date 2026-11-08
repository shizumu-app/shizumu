// memory-filter-bar.js — what memory says about the filters it applied
// (spec 2026-11-01 §2: the active-filters bar and the count line).
//
// THE BUG. Memory opens on `dateFilter: {kind: "thisMonth"}`. The pins tab
// showed 1 pin of 4 and nothing on screen said a filter was on; the counter
// beside it read "8 pages" on the pins tab. A filter that hides something
// has to be visible where its results are, removable there, and counted.
//
// Two answers, one per piece of chrome:
// - `activeFilterPills` — one removable pill per filter in force on this
//   tab (trail, date range, a non-default sort, pinned only, on page).
// - `memoryCountLine` — `N pages` / `N pins` for the tab on screen, or
//   `1 of 4 pins · 3 hidden by "this month"` when the pills hide some.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** `2026-01-15` → `15 jan`. */
export function shortDate(iso) {
  const [, m, d] = String(iso || "").split("-").map(Number);
  if (!m || !d) return String(iso || "");
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * The words for a date filter, or null when it filters nothing.
 * @param {{ kind: string, date?: string, from?: string, to?: string } | null} f
 */
export function dateFilterLabel(f) {
  if (!f || f.kind === "all") return null;
  if (f.kind === "today") return "today";
  if (f.kind === "thisWeek") return "this week";
  if (f.kind === "thisMonth") return "this month";
  if (f.kind === "specific") return shortDate(f.date);
  if (f.kind === "range") return `${shortDate(f.from)} – ${shortDate(f.to)}`;
  return null;
}

/** What memory's non-default sort is called on its pill. */
export const SORT_LABELS = { updated_at: "recently edited" };

/** Which filters act on which tab. A pill for a filter that does nothing
 *  on the tab in view would be a second silent lie: pinned only, on page
 *  and the edited order act on the page list (and the map built from it),
 *  never on the pins list. */
const TAB_FILTERS = {
  pages: ["trail", "date", "sort", "pinned", "onPage"],
  trailmap: ["trail", "date", "pinned", "onPage"],
  pins: ["trail", "date"],
};

/**
 * @typedef {{ id: "trail"|"date"|"sort"|"pinned"|"onPage", label: string, removeLabel: string, hides: boolean }} FilterPill
 */

/**
 * @param {object} state
 * @param {"pages"|"trailmap"|"pins"} state.tab
 * @param {string|null} [state.trailLabel]  the selected trail's name, "untrailed", or null for all trails
 * @param {object|null} [state.dateFilter]  the date filter IN FORCE (after searchDateFilter)
 * @param {"date"|"updated_at"} [state.sort]
 * @param {boolean} [state.pinnedOnly]
 * @param {boolean} [state.onPage]
 * @returns {FilterPill[]}
 */
export function activeFilterPills({ tab = "pages", trailLabel = null, dateFilter = null, sort = "date", pinnedOnly = false, onPage = false } = {}) {
  const allowed = new Set(TAB_FILTERS[tab] || TAB_FILTERS.pages);
  /** @type {FilterPill[]} */
  const out = [];
  const add = (id, label, hides) => {
    if (allowed.has(id)) out.push({ id, label, removeLabel: `remove ${label}`, hides });
  };
  // The trail is what you chose to look at, not a filter hiding things from
  // that view, so it is shown and removable but never named as the reason
  // something is hidden.
  if (trailLabel) add("trail", trailLabel, false);
  const date = dateFilterLabel(dateFilter);
  if (date) add("date", date, true);
  if (sort && sort !== "date") add("sort", SORT_LABELS[sort] || sort, false);
  if (pinnedOnly) add("pinned", "pinned only", true);
  if (onPage) add("onPage", "on page", true);
  return out;
}

/**
 * The count line for the tab on screen.
 *
 * @param {object} input
 * @param {"pages"|"trailmap"|"pins"} input.tab
 * @param {number} input.shown  what the list shows
 * @param {number} input.total  what it would show without the hiding pills (same trail, same search)
 * @param {FilterPill[]} [input.pills]  activeFilterPills for this tab
 * @param {{cap: number, trailTotal: number}|null} [input.capped]  see
 *   trailPoolCap: the pages loaded stop at `cap`, and the chosen trail holds
 *   `trailTotal`; named only when the trail holds more than the line counts
 * @returns {string}
 */
export function memoryCountLine({ tab, shown, total, pills = [], capped = null }) {
  const pinsTab = tab === "pins";
  const noun = (n) => (pinsTab ? (n === 1 ? "pin" : "pins") : (n === 1 ? "page" : "pages"));
  const hidden = Math.max(0, (total ?? shown) - shown);
  const hiders = pills.filter((p) => p.hides).map((p) => `"${p.label}"`);
  let line;
  if (hidden === 0 || hiders.length === 0) {
    line = `${shown} ${noun(shown)}`;
  } else {
    const by = hiders.length === 1
      ? hiders[0]
      : `${hiders.slice(0, -1).join(", ")} and ${hiders[hiders.length - 1]}`;
    line = `${shown} of ${total} ${noun(total)} · ${hidden} hidden by ${by}`;
  }
  if (!pinsTab && capped && capped.trailTotal > (total ?? shown)) {
    const sep = line.includes(" · ") ? " · " : " ";
    line += `${sep}from the newest ${capped.cap} · ${capped.trailTotal} on this trail`;
  }
  return line;
}

/**
 * Whether memory's count line must say its pages stop at the cap. Memory
 * loads only the newest `cap` pages, and a chosen trail is filtered out of
 * those, while the trail's row beside it counts every page in SQL
 * (get_trail_page_counts). Once the pool is full, the two can disagree, and
 * the line says so instead of a smaller number that reads as the whole.
 *
 * @param {object} input
 * @param {number} input.poolSize  pages memory loaded
 * @param {number} input.cap  the limit it asked for
 * @param {boolean} input.searching  a search's results are their own pool
 * @param {Set<string>|string|null} input.scope  descendantLineageIds of the
 *   chosen trail (the trail and its nested trails), or null / "__untrailed__"
 * @param {Map<string, number>} input.pageCounts  lineage id → own pages
 * @returns {{cap: number, trailTotal: number}|null}
 */
export function trailPoolCap({ poolSize, cap, searching, scope, pageCounts }) {
  if (searching || poolSize < cap || !(scope instanceof Set)) return null;
  let trailTotal = 0;
  for (const id of scope) trailTotal += pageCounts?.get(id) ?? 0;
  return { cap, trailTotal };
}
