// pin-filter.js — which pins the pins screen shows, and whether there is
// anything to choose between at all.
//
// §2 gives the pins screen a "filter segment", one control, and the axis
// it filters on is NOT invented here: it is the axis the desktop's own
// panel is SECTIONED by. SharedObjectsPanel derives `scopeOf` (its
// :303-307) and groups the feed into "on this trail" / "inherited" /
// "global" (:401-403) before any of its five filters run. Its other axes —
// the six-family category, carries-forward, on-this-page, free text — are
// side-nav checkboxes over that grouping. One of them had to be the
// phone's single control, and the grouping is the one the desktop already
// treats as structure rather than as a filter.
//
// It is also the axis this product is for. CLAUDE.md: pin × trail is the
// cross-product, "show me the pins on my book trail" is the six-month
// executive summary. Splitting a nested trail's list into what this trail
// kept and what it inherited from its parent is that question, asked on
// the surface where the answer lives.
//
// THE CATEGORY AXIS WAS THE OTHER CANDIDATE and it does not fit the
// control: `pinFamily` has six families plus "all", and SegmentedControl
// is documented for 2-5 options with `white-space: nowrap` on every
// segment. Seven of those do not fit a phone's width, and the honest
// version of that filter is a sheet — which §2 gives to MEMORY ("filters
// in a sheet") and deliberately does not give to pins.
//
// ── the options are derived from the pins, not declared ───────────────
//
// A pins screen pushed from a page on a root trail holds one scope: every
// row is that trail's own. A segment there would be `all | this trail`,
// two controls selecting the same rows — the "affordance onto nothing"
// this tree keeps refusing, in the form the block sheet refuses as a dead
// row. So the control exists only when the list actually holds more than
// one scope, and pinFilterOptions returns [] otherwise.
//
// That also means the filtered list can never be empty: every offered
// value names a scope some row carries. The screen needs two empty states
// (nothing kept, not read yet) and not a third for "nothing matches".
//
// ── the count on the toast, and this list, must agree ─────────────────
//
// pin-toast.js's header states the contract from the other end: the
// breadcrumb is "a POINTER at a list, and the list it points at shows the
// same rows (PinRow renders closed and orphaned dimmed, not absent). A
// count that disagreed with the list it names would be worse than no
// count." `getPins(lineageId)` filters on no status and walks ancestors
// upward, and the toast passes its length unfiltered.
//
// Hence: `all` is the default and it filters NOTHING — not "everything
// except orphans", not "open only". filterPins returns the array it was
// given for `all`, so the row count at rest is the number the toast said.
// A status filter added here would break that agreement silently, which
// is why the axis is scope and the default is a pass-through.

/** The resting value: every row the fetch returned. */
export const ALL = "all";

/**
 * Which scope a pin has, seen from the trail the screen was pushed for.
 *
 * `scopeOf` on the desktop (SharedObjectsPanel:303-307), with one
 * difference worth naming: there, `lineageId` is the panel's trail and
 * global pins arrive from a SECOND fetch (`getPins(null)`). The shell
 * makes one call, so on a trailed page "global" is unreachable — the CTE
 * matches `so.lineage_id IN (chain)` and NULL matches no IN list — and on
 * an untrailed page every row is global and nothing else is. The function
 * stays total anyway rather than encoding the caller's arithmetic.
 *
 * @param {any} pin
 * @param {string|null} lineageId  the trail the pins were read for
 * @returns {"here"|"inherited"|"global"}
 */
export function pinScope(pin, lineageId) {
  const owner = pin?.lineage_id ?? null;
  if (owner === null) return "global";
  return owner === lineageId ? "here" : "inherited";
}

// Order is the desktop's section order (SharedObjectsPanel:401-403): the
// trail's own first, what it inherited next, global last. A segment whose
// order changed with the data would move under the reader's thumb.
const SCOPE_ORDER = ["here", "inherited", "global"];

// The desktop's section headings, shortened only where a segment cannot
// carry them: "on this trail" is its label for `here`, and four words in a
// nowrap segment beside two more segments does not fit a phone. The other
// two are its words unchanged.
const SCOPE_LABELS = {
  here: "this trail",
  inherited: "inherited",
  global: "global",
};

/**
 * The segment's options, or [] when there is nothing to choose between.
 *
 * @param {any[]} pins
 * @param {string|null} lineageId
 * @returns {{value: string, label: string}[]}
 */
export function pinFilterOptions(pins, lineageId) {
  const rows = Array.isArray(pins) ? pins : [];
  const present = new Set(rows.map((pin) => pinScope(pin, lineageId)));
  const scopes = SCOPE_ORDER.filter((scope) => present.has(scope));
  // One scope (or none) means every option would select every row. See the
  // header: a control that cannot change what is on screen is not a
  // control.
  if (scopes.length < 2) return [];
  return [
    { value: ALL, label: "all" },
    ...scopes.map((scope) => ({ value: scope, label: SCOPE_LABELS[scope] })),
  ];
}

/**
 * The rows to render. `all` is a pass-through by design — see the header
 * on the toast's count.
 *
 * @param {any[]} pins
 * @param {string|null} lineageId
 * @param {string} value
 * @returns {any[]}
 */
export function filterPins(pins, lineageId, value) {
  const rows = Array.isArray(pins) ? pins : [];
  if (!value || value === ALL) return rows;
  return rows.filter((pin) => pinScope(pin, lineageId) === value);
}

/**
 * The value the segment should actually be showing, given what it offers.
 *
 * The pins list is mutable from this screen — unpinning removes a row —
 * so the last row of a scope can leave while that scope is selected. The
 * option then disappears from the control and the selection names a scope
 * nothing carries: an empty list under a segment with no segment lit.
 * Falling back to ALL is what keeps the rendered control and the rendered
 * list describing the same thing.
 *
 * @param {{value: string}[]} options
 * @param {string} value
 * @returns {string}
 */
export function pinFilterValue(options, value) {
  return options.some((option) => option.value === value) ? value : ALL;
}
