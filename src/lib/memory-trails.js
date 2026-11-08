// memory-trails.js — what memory's trails list shows (spec 2026-11-01 §2).
//
// THE FAULTS. The list had no search, a `discrete`/`continuous` tag on every
// row, page counts only, and "untrailed" twice (a heading and its one row).
// Finding a trail in a long tree meant scrolling it, and nothing on a row
// said where the pins were.
//
// The rules, decided here so the desktop sidebar and the phone's trails
// sheet answer the same way:
// - `find a trail…` keeps every trail whose name matches AND every ancestor
//   of one, so a match is never shown without the path that leads to it.
// - Each row carries `pages` and `pins`: the pages and pins the trail itself
//   owns (ruling 1, the carry-forward rule), not its subtree's.
// - Only continuous trails are marked (`one doc`); discrete is the default
//   and says nothing.
// - `all trails` first, `untrailed` once, at the end.

import { buildTreeList, lineagePath } from "./trail-utils.js";
import { shortDate } from "./memory-filter-bar.js";

/** Normalised needle: trimmed, lowercased; "" means no search. */
function needleOf(query) {
  return String(query ?? "").trim().toLowerCase();
}

/**
 * Filter a tree-ordered trail list by name, keeping each match's ancestors.
 *
 * @template {{ id: string, parent_id?: string|null, name: string }} T
 * @param {T[]} rows  tree-ordered (parents before children)
 * @param {string} query
 * @returns {T[]}  the same rows, same order; all of them for an empty query
 */
export function filterTrailTree(rows = [], query = "") {
  const needle = needleOf(query);
  if (!needle) return rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const keep = new Set();
  for (const r of rows) {
    if (!String(r.name ?? "").toLowerCase().includes(needle)) continue;
    let cur = r;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      keep.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
  }
  return rows.filter((r) => keep.has(r.id));
}

/**
 * How many untrailed pages memory can honestly claim.
 *
 * There is no SQL count for them (get_trail_page_counts leaves them out, and
 * get_ground_data's total counts empty pages too), so the number comes from
 * the pages memory loaded. That list is capped; once it is full the tally
 * would mean "untrailed among the most recent", which nobody can use, so the
 * answer is null and the row shows no page number.
 *
 * @param {Array<{ lineage_id?: string|null }>} pages
 * @param {number} cap  the limit memory asked get_thread for
 * @returns {number|null}
 */
export function untrailedPageCount(pages = [], cap = 100) {
  if (pages.length >= cap) return null;
  return pages.filter((p) => p.lineage_id == null).length;
}

/**
 * The trails list, ready to render.
 *
 * @param {object} input
 * @param {Array<{ id: string, name: string, mode?: string, parent_id?: string|null }>} [input.lineages]
 * @param {Map<string, number>} [input.pageCounts]  lineage id → own pages
 * @param {Map<string|null, number>} [input.pinCounts]  lineage id → own pins; null → global pins
 * @param {number|null} [input.untrailedPages]  see untrailedPageCount
 * @param {string} [input.query]
 * @param {Set<string>} [input.collapsed]  folded trail ids; ignored while searching
 */
export function trailSidebarModel({
  lineages = [],
  pageCounts = new Map(),
  pinCounts = new Map(),
  untrailedPages = null,
  query = "",
  collapsed = new Set(),
} = {}) {
  const tree = buildTreeList(lineages).map((l) => ({
    id: l.id,
    name: l.name,
    parent_id: l.parent_id ?? null,
    depth: l._depth ?? 0,
    hasChildren: !!l._hasChildren,
    oneDoc: l.mode === "continuous",
    pages: pageCounts.get(l.id) ?? 0,
    pins: pinCounts.get(l.id) ?? 0,
  }));
  const searching = needleOf(query) !== "";
  let rows = filterTrailTree(tree, query);
  if (!searching) {
    // A folded parent hides its subtree. A search ignores folding: a match
    // inside a folded branch is still the answer to the question asked.
    const byId = new Map(tree.map((r) => [r.id, r]));
    rows = rows.filter((r) => {
      let cur = r.parent_id ? byId.get(r.parent_id) : undefined;
      while (cur) {
        if (collapsed.has(cur.id)) return false;
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
      return true;
    });
  }
  rows = rows.map((r) => ({ ...r, expanded: r.hasChildren ? (searching || !collapsed.has(r.id)) : undefined }));

  const trailedPages = tree.reduce((n, r) => n + r.pages, 0);
  let allPins = 0;
  for (const n of pinCounts.values()) allPins += n;
  const untrailedPins = pinCounts.get(null) ?? 0;

  return {
    rows,
    searching,
    // A search that matches no trail says so instead of an empty list.
    noMatch: searching && rows.length === 0,
    all: {
      pages: untrailedPages == null ? null : trailedPages + untrailedPages,
      pins: allPins,
    },
    untrailed: { pages: untrailedPages, pins: untrailedPins },
  };
}

/**
 * The counts a row shows, as text: `6 · 4` (pages · pins), or just the pins
 * when the page number is not known. The pins half is returned separately
 * so the row can colour it.
 *
 * @param {{ pages: number|null, pins: number }} counts
 * @returns {{ pages: string|null, pins: string, label: string }}
 */
export function trailCountText({ pages, pins }) {
  const pageWord = pages === 1 ? "page" : "pages";
  const pinWord = pins === 1 ? "pin" : "pins";
  return {
    pages: pages == null ? null : String(pages),
    pins: String(pins),
    label: pages == null ? `${pins} ${pinWord}` : `${pages} ${pageWord}, ${pins} ${pinWord}`,
  };
}

/**
 * The source line of a pin in memory's pins tab: `<trail path> · <date>`,
 * the trail that owns it and the day it was kept (spec §2). A global pin's
 * trail is `everywhere`, the word the panel uses for the same pins.
 *
 * @param {{ lineage_id?: string|null, source_page_date?: string|null, created_at?: string|null }} pin
 * @param {Array<{ id: string, name: string, parent_id?: string|null }>} lineages
 */
export function memoryPinSourceLine(pin, lineages = []) {
  const path = pin?.lineage_id ? lineagePath(pin.lineage_id, lineages) : [];
  const trail = pin?.lineage_id
    ? (path.map((l) => l.name).join(" › ") || "a trail that is no longer listed")
    : "everywhere";
  const day = pin?.source_page_date || (pin?.created_at ? String(pin.created_at).slice(0, 10) : "");
  return day ? `${trail} · ${shortDate(day)}` : trail;
}
