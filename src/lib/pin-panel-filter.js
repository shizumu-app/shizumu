// pin-panel-filter.js — which pins the pins panel shows, under which
// headings, and what each filter chip counts.
//
// THE BUG THIS REPLACES. The desktop panel had five filters (category,
// scope, carries-forward, on-this-page, free text) and only the free text
// was reachable: the rest lived in a SidebarShell sidebar the panel was too
// narrow to show, with nothing on desktop that opened its drawer. So a
// writer with forty pins had a search box and nothing else (owner,
// 2026-11-01). The decisions below were inline in SharedObjectsPanel.svelte
// where no test could reach them; they live here now, and the panel renders
// one chip row from `panelChips`.
//
// THE CHIPS (spec 2026-11-01 §1, rulings 2 and 3):
//   scope    `this trail` | `all trails` — one choice. `this trail` is what
//            get_pins returns for the page's trail (the trail and its
//            ancestors) plus the global pins, sectioned. `all trails` is
//            every pin, grouped by trail path in tree order. On a page with
//            no trail the first scope reads `everywhere` — the global pins
//            are the only ones that belong to an untrailed page.
//   toggles  `carries forward`, `on this page` — combine with the scope.
//   kind     one of pinFamily's six families, or none.
//   sort     `default` (bucket, then manual position; drag reorders) or
//            `newest` (created_at, newest first; drag is hidden).
//
// COUNTS. A scope chip counts its whole scope; a toggle chip and each kind
// counts how many pins in the CURRENT scope it would keep, ignoring the other
// toggles and the search. That way a count never reads 0 merely because a
// different chip is on, and the number beside a chip is what turning it on
// alone would show.

import { pinFamily, pinSearchText } from "./pin-display.js";
import { buildTreeList, lineagePath } from "./trail-utils.js";

export const SCOPE_TRAIL = "trail";
export const SCOPE_ALL = "all";
export const SORT_DEFAULT = "default";
export const SORT_NEWEST = "newest";

/** pinFamily's six families, in the order the kind menu lists them. */
export const KINDS = ["text", "lists", "structure", "charts", "code", "files"];

/**
 * @typedef {{
 *   scope: "trail"|"all",
 *   carries: boolean,
 *   onPage: boolean,
 *   kind: string|null,
 *   query: string,
 *   sort: "default"|"newest",
 * }} PanelFilter
 */

/** @returns {PanelFilter} */
export function defaultPanelFilter() {
  return { scope: SCOPE_TRAIL, carries: false, onPage: false, kind: null, query: "", sort: SORT_DEFAULT };
}

/**
 * Which section of the `this trail` view a pin falls in.
 * @returns {"here"|"inherited"|"global"}
 */
export function pinSection(pin, lineageId) {
  const owner = pin?.lineage_id ?? null;
  if (owner === null) return "global";
  return owner === lineageId ? "here" : "inherited";
}

/**
 * Join several pin lists into one, first occurrence wins. get_pins walks
 * ancestors upward, so asking for every trail returns a parent's pins once
 * per child; the union must hold each pin once or every count doubles.
 */
export function mergePinRows(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists || []) {
    for (const row of list || []) {
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/** The rows a scope holds before any toggle, kind or search. */
export function scopeRows({ trailPins = [], allPins = [] }, scope) {
  return scope === SCOPE_ALL ? allPins : trailPins;
}

/** Search predicate over everything the pin has words in (pinSearchText). */
export function pinMatchesQuery(pin, query) {
  const needle = (query || "").trim().toLowerCase();
  if (!needle) return true;
  return pinSearchText(pin).toLowerCase().includes(needle);
}

const carries = (p) => !!p.auto_insert;
const onPage = (pageId) => (p) => !!pageId && p.source_page_id === pageId;

/**
 * Apply the toggles, kind and search to a scope's rows.
 * @param {any[]} rows
 * @param {PanelFilter} filter
 * @param {{ pageId?: string|null }} ctx
 */
export function filterPanelPins(rows, filter, { pageId = null } = {}) {
  let r = Array.isArray(rows) ? rows : [];
  if (filter.carries) r = r.filter(carries);
  if (filter.onPage) r = r.filter(onPage(pageId));
  if (filter.kind) r = r.filter((p) => pinFamily(p) === filter.kind);
  if ((filter.query || "").trim()) r = r.filter((p) => pinMatchesQuery(p, filter.query));
  return r;
}

/**
 * Order rows. `default` is the panel's order before this change: object_type
 * bucket, then manual position (what drag-to-reorder writes). `newest` is by
 * created_at, newest first, ties kept in default order.
 */
export function sortPanelPins(rows, sort = SORT_DEFAULT) {
  const byDefault = (a, b) => {
    const t = (a.object_type || "").localeCompare(b.object_type || "");
    if (t !== 0) return t;
    return (a.position || 0) - (b.position || 0);
  };
  if (sort === SORT_NEWEST) {
    return [...rows].sort((a, b) => {
      const d = (b.created_at || "").localeCompare(a.created_at || "");
      return d !== 0 ? d : byDefault(a, b);
    });
  }
  return [...rows].sort(byDefault);
}

/**
 * Every count the chip row shows.
 * @returns {{ trail: number, all: number, carries: number, onPage: number, kinds: Record<string, number> }}
 */
export function chipCounts({ trailPins = [], allPins = [], pageId = null, filter }) {
  const inScope = scopeRows({ trailPins, allPins }, filter.scope);
  const kinds = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const p of inScope) {
    const fam = pinFamily(p);
    if (fam in kinds) kinds[fam] += 1;
  }
  return {
    trail: trailPins.length,
    all: allPins.length,
    carries: inScope.filter(carries).length,
    onPage: inScope.filter(onPage(pageId)).length,
    kinds,
  };
}

/**
 * The chip row, in order, ready to render.
 * @returns {Array<{ id: string, label: string, count: number|null, active: boolean, menu?: boolean }>}
 */
export function panelChips({ trailPins = [], allPins = [], pageId = null, lineageId = null, filter }) {
  const c = chipCounts({ trailPins, allPins, pageId, filter });
  return [
    { id: "trail", label: lineageId ? "this trail" : "everywhere", count: c.trail, active: filter.scope === SCOPE_TRAIL },
    { id: "all", label: "all trails", count: c.all, active: filter.scope === SCOPE_ALL },
    { id: "carries", label: "carries forward", count: c.carries, active: filter.carries },
    { id: "onPage", label: "on this page", count: c.onPage, active: filter.onPage },
    {
      id: "kind",
      label: filter.kind ? `${filter.kind} ▾` : "kind ▾",
      count: filter.kind ? c.kinds[filter.kind] : null,
      active: !!filter.kind,
      menu: true,
    },
  ];
}

/**
 * What tapping a chip does to the filter. Scope chips select; toggles flip;
 * `kind` is a menu and is set through `setKind`.
 * @returns {PanelFilter}
 */
export function toggleChip(filter, id) {
  if (id === "trail") return { ...filter, scope: SCOPE_TRAIL };
  if (id === "all") return { ...filter, scope: SCOPE_ALL };
  if (id === "carries") return { ...filter, carries: !filter.carries };
  if (id === "onPage") return { ...filter, onPage: !filter.onPage };
  return filter;
}

/** Choose a kind; choosing the one already on (or null) clears it. */
export function setKind(filter, kind) {
  const next = kind && kind !== filter.kind && KINDS.includes(kind) ? kind : null;
  return { ...filter, kind: next };
}

/** Is anything narrowing the scope (a toggle, a kind, a search)? */
export function narrowing(filter) {
  return !!(filter.carries || filter.onPage || filter.kind || (filter.query || "").trim());
}

/**
 * `clear filters`: drop the toggles, kind and search. The scope and the sort
 * stay — the scope is where you are looking, not a filter on it, and
 * clearing it would move the reader to another list than the one they were
 * reading.
 */
export function clearPanelFilters(filter) {
  return { ...filter, carries: false, onPage: false, kind: null, query: "" };
}

/** `search pins on this trail…` when the scope is this trail. */
export function searchPlaceholder(filter, lineageId) {
  return filter.scope === SCOPE_TRAIL && lineageId ? "search pins on this trail…" : "search pins…";
}

/** `pins · shizumu › v0.8`, or `pins` on a page with no trail. */
export function panelTitle(lineageId, lineages = []) {
  const path = lineagePath(lineageId, lineages || []).map((l) => l.name).join(" › ");
  return path ? `pins · ${path}` : "pins";
}

/**
 * The visible rows grouped under headings.
 *
 * `trail` scope keeps today's three sections — this trail's own, then the
 * parent trails', then the global pins — and an untrailed page has only the
 * last. `all` groups by trail path in tree order, global pins last.
 *
 * @returns {Array<{ key: string, label: string, pins: any[] }>}
 */
export function panelSections(rows, { filter, lineageId = null, lineages = [] }) {
  if (filter.scope === SCOPE_ALL) {
    const byTrail = new Map();
    const global = [];
    for (const p of rows) {
      if (p.lineage_id == null) global.push(p);
      else {
        if (!byTrail.has(p.lineage_id)) byTrail.set(p.lineage_id, []);
        byTrail.get(p.lineage_id).push(p);
      }
    }
    const out = [];
    const placed = new Set();
    for (const l of buildTreeList(lineages || [])) {
      const pins = byTrail.get(l.id);
      if (!pins) continue;
      placed.add(l.id);
      const path = lineagePath(l.id, lineages).map((x) => x.name).join(" › ");
      out.push({ key: `trail:${l.id}`, label: path, pins });
    }
    // A pin whose trail the lineage list does not hold (deleted elsewhere,
    // list not loaded yet) is still a pin: list it rather than drop it.
    for (const [id, pins] of byTrail) {
      if (!placed.has(id)) out.push({ key: `trail:${id}`, label: "another trail", pins });
    }
    if (global.length) out.push({ key: "global", label: "everywhere", pins: global });
    return out;
  }
  const groups = { here: [], inherited: [], global: [] };
  for (const p of rows) groups[pinSection(p, lineageId)].push(p);
  const out = [];
  if (groups.here.length) out.push({ key: "here", label: "on this trail", pins: groups.here });
  if (groups.inherited.length) out.push({ key: "inherited", label: "from parent trails", pins: groups.inherited });
  if (groups.global.length) out.push({ key: "global", label: "everywhere", pins: groups.global });
  return out;
}

/**
 * The `from …` line under a pin's title, or null.
 *
 * Only on pins that are not the page trail's own (ruling 2): every row
 * repeating "this trail" under an "on this trail" heading was noise. In the
 * `all` scope each group is already headed by its trail path, so no row
 * repeats it.
 */
export function pinSourceLine(pin, { filter, lineageId = null, lineages = [] }) {
  if (filter.scope === SCOPE_ALL) return null;
  const section = pinSection(pin, lineageId);
  if (section === "here") return null;
  if (section === "global") return lineageId ? "from everywhere" : null;
  const owner = (lineages || []).find((l) => l.id === pin.lineage_id);
  return owner ? `from ${owner.name} (parent trail)` : "from a parent trail";
}

/** May rows be dragged to reorder? Only in the order drag writes. */
export function canReorder(filter) {
  return filter.sort === SORT_DEFAULT;
}
