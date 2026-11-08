// The index of trails: what it lists, and what picking one scopes.
//
// §2: "Trails are a **pushed index**, not a drawer — the shell has no
// drawers." What the index REPLACES is the desktop's memory sidebar
// (Memory.svelte:635 and the SidebarNavRow list under it), which is the
// only place on the desktop where memory is narrowed to one trail — and
// MemoryScreen's own header records that the scope was missing until this
// screen landed, so this file is the second half of that sentence rather
// than a new idea.
//
// The canon it serves is one line: "everything else lives in memory:
// search it, or open one trail, one date, pages, or pins."
//
// ── THE SENTINEL IS THE DESKTOP'S, SPELLED OUT ────────────────────────
//
// `applyScopeFilter` (memory-filters.js:159) tests the literal string
// "__untrailed__" rather than a constant it exports, and Memory.svelte
// declares its own `const UNTRAILED = "__untrailed__"` beside it. So does
// this file, and the duplication is the shape of the seam rather than a
// choice: `descendantLineageIds` reads the same literal (:192) and
// changing any one of the three in isolation makes the untrailed scope
// silently select nothing. Named here so the shell has one place to look,
// and asserted against the helpers' real behaviour in the tests rather
// than trusted.
//
// ── THE ROWS CARRY NO COUNT; THE MAP FETCHES A REAL ONE ──────────────
//
// The obvious row is "the book · 12 pages". Tallying `lineage_id` over
// the list memory holds would be wrong for exactly the reason
// `getTrailPageCounts` exists: that list is `getThread(100)`, capped, so
// the tally undercounts any trail whose pages fall outside the window and
// says nothing about a trail with none in it at all (api.js says so in as
// many words where the command is defined). A wrong count on a screen
// whose whole job is telling trails apart is worse than none, so these
// rows carry none — and that stays true.
//
// The visual pass (Task 8) drew the index as a MAP and bought the count
// with that fetch. Both are gone with the index itself (the fifth device
// pass turned its one job into a sheet), so these rows carry no count
// again, which is where they started and for the reason above.
//
// What each row DOES carry is the trail's mode, which is free — it is a
// column on the lineage row the index already has — and true, and it is
// where a writer meets CLAUDE.md's trail exception: `continuous` names the
// one trail whose page keeps growing.
//
// ── NESTING IS SHOWN, NOT FLATTENED ──────────────────────────────────
//
// Lineages nest to any depth (CLAUDE.md's data model), and a flat list of
// names loses the one thing the hierarchy says — that `v0.3` is under
// `shizumu`. Rows carry a `depth` and the screen indents on it. A row
// whose `parent_id` names a lineage that is not in the list is treated as
// a root rather than dropped: the list is what memory read, and a page
// belonging to a trail whose parent went missing must still be reachable.
//
// Cycles cannot be produced by the app (`create_lineage` takes a parent
// that already exists) but a malformed row set could, and a depth-first
// walk over one does not terminate. `seen` bounds it, the same defence
// `descendantLineageIds` carries for the same reason.

import { descendantLineageIds } from "../lib/memory-filters.js";
import { filterTrailTree } from "../lib/memory-trails.js";
import { lineagePath } from "../lib/trail-utils.js";

// ── 0.8.2: COUNTS AND A SEARCH, after all (spec 2026-11-01 §4) ────────
//
// The header above refuses a count tallied from memory's capped list, and
// that refusal stands: the counts here are not tallied. They come from two
// read-only aggregates over the whole database — `getTrailPageCounts` and
// `getTrailPinCounts` (ruling 1: the pages and pins each trail ITSELF owns,
// not its subtree's, the rule carry-forward uses) — handed in as Maps. With
// no Maps handed in, a row carries no count, exactly as before.
//
// The one figure that cannot come from a query is the untrailed pages:
// `get_trail_page_counts` leaves them out. It is counted from memory's list
// while that list is under its cap (`untrailedPageCount`), and is unknown —
// the row says only its pins — once it is not.
//
// `find a trail…` keeps a match AND its ancestors (`filterTrailTree`, the
// desktop sidebar's rule), so a nested match is never shown without the
// path that leads to it. `all trails` and `untrailed` stay while searching:
// they are the way back out of a scope, not trails a name could match.

/** `4 pages · 2 pins`, or `2 pins` when the pages are unknown, or "" when
 *  no counts were read at all. */
export function trailCountValue(counts) {
  if (!counts) return "";
  const { pages = null, pins = 0 } = counts;
  const pinText = `${pins} ${pins === 1 ? "pin" : "pins"}`;
  if (pages == null) return pinText;
  return `${pages} ${pages === 1 ? "page" : "pages"} · ${pinText}`;
}

/** One trail's own counts, or null when no counts were read. */
export function trailCounts(id, { pageCounts = null, pinCounts = null } = {}) {
  if (!pageCounts && !pinCounts) return null;
  return {
    pages: pageCounts ? (pageCounts.get(id) ?? 0) : null,
    pins: pinCounts ? (pinCounts.get(id) ?? 0) : 0,
  };
}

/** The trails a `find a trail…` query keeps, in tree order: every match
 *  and every ancestor of one. All of them for an empty query. */
export function trailsMatching(lineages = [], query = "") {
  const rows = orderedTrails(lineages).map((l) => ({ ...l, name: nameOf(l) }));
  return filterTrailTree(rows, query);
}

/** Did a non-empty query match no trail at all? The sheet says so, rather
 *  than showing only its two scope rows as if they were the answer. */
export function noTrailMatches(lineages = [], query = "") {
  return String(query ?? "").trim() !== "" && trailsMatching(lineages, query).length === 0;
}

/** Where a trail lives — its ancestors joined, "" for a root. */
export function trailParentPath(lineage, lineages = []) {
  return lineagePath(lineage.id, lineages)
    .filter((l) => l.id !== lineage.id)
    .map((l) => nameOf(l))
    .join(" › ");
}

/** The scope string `applyScopeFilter` and `descendantLineageIds` both
 *  test for. See the header — three copies of one literal, and this is
 *  the shell's. */
export const UNTRAILED = "__untrailed__";

/** How long a trail's name may be in the nav bar's action, before it is
 *  cut. The bar is one line with a title and up to two actions on a phone
 *  (NavBar), and it has no ellipsis of its own — a long name pushes the
 *  other action off the edge instead of truncating. Cut here so the
 *  decision is testable rather than a CSS property nothing in jsdom can
 *  read. The character is the ellipsis, not three periods, so the cut
 *  costs one column rather than three. */
export const ACTION_NAME_MAX = 18;

/**
 * The index's rows, in order: all trails, untrailed, then the tree.
 *
 * The first two are scopes rather than trails, which is why they are not
 * derived from `lineages` — "all trails" is the resting state the screen
 * has to offer a way back to, and "untrailed" names the heap that has no
 * row of its own anywhere else. Both are the desktop sidebar's own
 * entries (Memory.svelte:635).
 *
 * @param {object} input
 * @param {any[]} [input.lineages]  flat rows: {id, name, parent_id, mode}
 * @param {string|null} [input.selectedId]  null, UNTRAILED, or a lineage id
 * @returns {{id: string|null, label: string, depth: number, mode: string|null,
 *            selected: boolean}[]}
 */
/**
 * Every trail, parent before child, siblings by name, each with its depth.
 *
 * THE SHELL HAD TWO OF THESE. `buildTreeList` (lib/trail-utils.js) is the
 * desktop's, and the page's trail sheet used it; this one is the index's.
 * They disagree on three things, and this one is right about all three:
 * siblings are sorted by name rather than left in the backend's
 * recency order, a row whose parent is outside the list stays a root
 * rather than being dropped from the tree entirely, and a cycle is bounded
 * instead of recursed. The header above argues each. Two walks meant the
 * same trails could come back in two orders on two phone surfaces, so the
 * walk is here, once, and the row shapes are built from it.
 *
 * @param {any[]} lineages  flat rows: {id, name, parent_id, mode}
 * @returns {Array<object>} the same rows, in tree order, each with `depth`
 */
export function orderedTrails(lineages = []) {
  const rows = Array.isArray(lineages) ? lineages.filter((l) => l && l.id) : [];

  const byParent = new Map();
  const ids = new Set(rows.map((l) => l.id));
  for (const l of rows) {
    // A parent outside the list is no parent — see the header.
    const parent = l.parent_id && ids.has(l.parent_id) ? l.parent_id : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(l);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }

  const out = [];
  const seen = new Set();
  const walk = (parent, depth) => {
    for (const l of byParent.get(parent) ?? []) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push({ ...l, depth });
      walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function trailIndexRows({
  lineages = [],
  selectedId = null,
  query = "",
  pageCounts = null,
  pinCounts = null,
  untrailedPages = null,
} = {}) {
  const counted = !!(pageCounts || pinCounts);
  const sum = (map) => {
    let n = 0;
    for (const v of map?.values?.() ?? []) n += Number(v) || 0;
    return n;
  };
  const allCounts = counted
    ? {
        // Every page needs the untrailed figure too; unknown makes it unknown.
        pages: pageCounts && untrailedPages != null ? sum(pageCounts) + untrailedPages : null,
        pins: sum(pinCounts),
      }
    : null;
  const untrailedCounts = counted
    ? { pages: untrailedPages, pins: pinCounts?.get(null) ?? 0 }
    : null;

  const out = [
    {
      id: null,
      label: "all trails",
      depth: 0,
      mode: null,
      selected: selectedId == null,
      detail: selectedId == null ? "showing" : "",
      value: trailCountValue(allCounts),
    },
    {
      id: UNTRAILED,
      label: "untrailed",
      depth: 0,
      mode: null,
      selected: selectedId === UNTRAILED,
      detail: selectedId === UNTRAILED ? "showing" : "",
      value: trailCountValue(untrailedCounts),
    },
  ];

  const rows = Array.isArray(lineages) ? lineages : [];
  for (const l of trailsMatching(rows, query)) {
    const mode = typeof l.mode === "string" && l.mode ? l.mode : null;
    const selected = selectedId === l.id;
    out.push({
      id: l.id,
      label: nameOf(l),
      depth: l.depth,
      mode,
      selected,
      // Only a continuous trail is marked — discrete is the default and
      // says nothing (the desktop sidebar's rule, spec §2). `one doc` is
      // what the trail IS, in the writer's words.
      detail: [selected ? "showing" : "", trailParentPath(l, rows), mode === "continuous" ? "one doc" : ""]
        .filter(Boolean)
        .join(" · "),
      value: trailCountValue(trailCounts(l.id, { pageCounts, pinCounts })),
    });
  }

  return out;
}

/** A trail with no name is a row the writer cannot tell from another one,
 *  so it says what it is. `untitled` is memory's own word for the same
 *  hole on a page row (memory-model.js's `pageRowLabel`) — one vocabulary
 *  for "this exists and has not been named". */
function nameOf(lineage) {
  const name = typeof lineage?.name === "string" ? lineage.name.trim() : "";
  return name || "untitled";
}

/**
 * What memory is scoped to, in the writer's own words — or null when it
 * is scoped to nothing.
 *
 * Null and "trail" are different answers and both are reachable: null is
 * "no scope is on", and `trail` is "a scope is on and the list memory
 * read does not name it", which happens for a page whose lineage arrived
 * after the read or whose read failed. Collapsing the second into the
 * first would take the scope off the bar while it was still filtering the
 * list.
 *
 * @param {object} input
 * @param {any[]} [input.lineages]
 * @param {string|null} [input.selectedId]
 * @returns {string|null}
 */
export function trailScopeLabel({ lineages = [], selectedId = null } = {}) {
  if (selectedId == null) return null;
  if (selectedId === UNTRAILED) return "untrailed";
  const row = (Array.isArray(lineages) ? lineages : []).find((l) => l?.id === selectedId);
  return row ? nameOf(row) : "trail";
}

/**
 * The label on memory's nav-bar action.
 *
 * The action IS the scope: unscoped it says what it opens, scoped it says
 * what is on. One control rather than a control plus an indicator, which
 * is the same call `filters · 2` already makes on the bar beside it —
 * except that this one names the scope instead of counting it, because
 * there is only ever one and its name is the useful half.
 *
 * @param {object} input
 * @param {any[]} [input.lineages]
 * @param {string|null} [input.selectedId]
 * @returns {string}
 */
export function trailActionLabel({ lineages = [], selectedId = null } = {}) {
  const label = trailScopeLabel({ lineages, selectedId });
  if (label === null) return "trails";
  if (label.length <= ACTION_NAME_MAX) return label;
  return `${label.slice(0, ACTION_NAME_MAX - 1).trimEnd()}…`;
}

/**
 * What `applyScopeFilter` should be handed for this selection.
 *
 * A parent's scope includes its descendants — selecting `shizumu` shows
 * the pages written on `v0.3` under it, which is the desktop's own rule
 * (Memory.svelte:329-334) and the only reading of a nested trail that
 * matches what nesting is for. `descendantLineageIds` returns the
 * UNTRAILED sentinel unchanged, which `applyScopeFilter` then reads as
 * "rows with no lineage at all" — so this one function answers for all
 * three selections and the screen has no branch of its own.
 *
 * @param {object} input
 * @param {any[]} [input.lineages]
 * @param {string|null} [input.selectedId]
 * @returns {Set<string>|string|null}
 */
export function trailScope({ lineages = [], selectedId = null } = {}) {
  if (selectedId == null) return null;
  return descendantLineageIds(selectedId, lineages);
}
