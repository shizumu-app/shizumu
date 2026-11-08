// pin-filter.js — what the phone's pins screen shows: the search, the chip
// row and its counts, the sections, the words under each row, and which
// empty state an empty list is.
//
// ── what this replaced (0.8.2, spec 2026-11-01 §4, ruling 5) ─────────
//
// The screen used to have ONE control: a segment over the desktop panel's
// sections (all | this trail | inherited | global), offered only when the
// list held more than one of them. The owner's complaint about the desktop
// panel — "no search or filtering capabilities" — was true here too: no
// search, no kind, no carries-forward, nothing for a writer with forty pins
// on one trail. Ruling 5 gives the phone the desktop's chip set, and the
// decisions are the desktop's own module (src/lib/pin-panel-filter.js), so
// a chip means the same thing and counts the same thing on both. This file
// is the phone's reading of it, and adds only what the phone does
// differently:
//
//   - `all trails` rows are read when the chip is first pressed, not on
//     every push (N+1 calls; see the host). Until then its count comes from
//     the per-trail pin counts query, and its list says it is reading.
//   - the kind chip opens a second chip row of the six families instead of
//     a menu: the shell has no popover, and a sheet for one choice would
//     cover the list it narrows (the spec leaves this to the builder).
//   - no symbol glyphs in the labels (shell-rules: "draws its symbols
//     instead of typing them") — the kind chip says `kind`, not `kind ▾`.
//
// ── the toast's count still names this list at rest ──────────────────
//
// pin-toast.js's header: the breadcrumb is "a POINTER at a list, and the
// list it points at shows the same rows". Its number is
// `getPins(lineageId).length`, every status included. So the resting
// filter (this trail, no toggle, no kind, no search) filters NOTHING out
// of that fetch — orphaned and closed rows stay, dimmed — and the global
// pins are not folded into `this trail` on the phone the way the desktop
// panel adds them with a second fetch: adding rows the toast did not count
// would put the two out of step. The global pins are one chip away, in
// `all trails`, grouped under `everywhere`.

import {
  KINDS,
  SCOPE_ALL,
  SCOPE_TRAIL,
  clearPanelFilters,
  defaultPanelFilter,
  filterPanelPins,
  narrowing,
  panelChips,
  panelSections,
  pinSection,
  pinSourceLine,
  searchPlaceholder,
  setKind,
  sortPanelPins,
  toggleChip,
} from "../lib/pin-panel-filter.js";
import { pinFamily } from "../lib/pin-display.js";
import { pinsEmptyState } from "../lib/pin-panel-empty.js";

export { KINDS, clearPanelFilters, defaultPanelFilter, setKind, toggleChip };

/** Which section a pin falls in, seen from the trail the screen was
 *  pushed for: `here`, `inherited` or `global`. The desktop's rule, kept
 *  under the name the shell has always called it. */
export const pinScope = pinSection;

const plural = (n) => (n === 1 ? "pin" : "pins");

/**
 * The words under a pin's title: where it came from when that is not this
 * trail, and that it carries forward when it does. Null when there is
 * nothing to say.
 *
 * @param {any} pin
 * @param {{ filter: object, lineageId?: string|null, lineages?: any[] }} ctx
 * @returns {string|null}
 */
export function pinDetailLine(pin, ctx) {
  const parts = [];
  const source = pinSourceLine(pin, ctx);
  if (source) parts.push(source);
  if (pin?.auto_insert) parts.push("carries forward to new pages");
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Everything the pins screen renders, from what the host read and what the
 * writer chose.
 *
 * @param {object} input
 * @param {any[]} [input.trailPins]  getPins(lineageId), as the host read it
 * @param {any[]|null} [input.allPins]  every pin, or null until read
 * @param {number|null} [input.allCount]  every pin, counted (getTrailPinCounts)
 * @param {boolean} [input.loading]  the trail fetch is in flight
 * @param {string|null} [input.lineageId]
 * @param {string|null} [input.pageId]
 * @param {any[]} [input.lineages]
 * @param {object} input.filter  pin-panel-filter's PanelFilter
 * @param {boolean} [input.kindOpen]  the kind row is showing
 */
export function pinsScreenModel({
  trailPins = [],
  allPins = null,
  allCount = null,
  loading = false,
  lineageId = null,
  pageId = null,
  lineages = [],
  filter,
  kindOpen = false,
}) {
  const trail = Array.isArray(trailPins) ? trailPins : [];
  const allLoaded = Array.isArray(allPins);
  const all = allLoaded ? allPins : [];
  const allScope = filter.scope === SCOPE_ALL;

  const chips = panelChips({ trailPins: trail, allPins: all, pageId, lineageId, filter }).map((chip) => {
    // The all-trails count before its rows are read: the counts query
    // answers it in one SELECT, and a 0 there would be a lie about the
    // writer's whole account.
    const count = chip.id === "all" && !allLoaded ? allCount : chip.count;
    const label = chip.id === "kind" ? (filter.kind ?? "kind") : chip.label;
    return {
      id: chip.id,
      label,
      count,
      active: chip.id === "kind" ? !!filter.kind || kindOpen : chip.active,
      ariaLabel: count == null ? label : `${label}, ${count} ${plural(count)}`,
    };
  });

  const inScope = allScope ? all : trail;
  const kinds = kindOpen
    ? KINDS.map((kind) => {
        const count = inScope.filter((p) => pinFamily(p) === kind).length;
        return {
          id: kind,
          label: kind,
          count,
          active: filter.kind === kind,
          ariaLabel: `${kind}, ${count} ${plural(count)}`,
        };
      })
    : [];

  const reading = allScope ? !allLoaded : loading;
  const visible = sortPanelPins(filterPanelPins(inScope, filter, { pageId }), filter.sort);
  const ctx = { filter, lineageId, lineages };
  const sections = panelSections(visible, ctx).map((section) => ({
    key: section.key,
    label: `${section.label} · ${section.pins.length}`,
    pins: section.pins.map((pin) => ({ pin, detail: pinDetailLine(pin, ctx) })),
  }));

  const empty = reading
    ? null
    : pinsEmptyState({
        lineageId,
        scopeCount: inScope.length,
        visibleCount: visible.length,
        allScope,
      });

  return {
    chips,
    kinds,
    sections,
    reading: reading && visible.length === 0,
    empty,
    placeholder: searchPlaceholder(filter, lineageId),
    narrowing: narrowing(filter),
    needsAllPins: allScope && !allLoaded,
  };
}

/**
 * What a chip tap does: the scope chips and toggles go through the
 * desktop's `toggleChip`; `kind` opens or closes the kind row, and closing
 * it with a kind on clears the kind (the row is the only place it shows).
 *
 * @returns {{ filter: object, kindOpen: boolean }}
 */
export function tapChip({ filter, kindOpen = false }, id) {
  if (id === "kind") {
    if (kindOpen) return { filter: setKind(filter, null), kindOpen: false };
    return { filter, kindOpen: true };
  }
  return { filter: toggleChip(filter, id), kindOpen };
}

/** Is this the resting filter, the one the toast's count describes? */
export function atRest(filter) {
  return filter.scope === SCOPE_TRAIL && !narrowing(filter);
}
