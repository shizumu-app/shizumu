// Which kind a row is, and what that kind draws.
//
// Row.svelte used to decide both from one prop: `onSelect` set meant a
// button AND a chevron. The chevron is the phone's promise that a tap
// opens a screen, so every row that did anything else — `save` on the
// pin editor, `insert` on the table sheet, `continue` under a read page,
// a tone option that selects and pops — rendered `save ›` and pointed at
// a screen that never came. This module is the amendment to spec §4's
// Row line: a chevron only where the row PUSHES.
//
// Six kinds, one word each for what a tap does:
//
//   push         opens a screen. The only kind with a chevron.
//   action       does something and stays — save, insert, continue,
//                write today, pair this device, clear filters.
//   choice       selects and pops — a tone, a trail scope, a date, a
//                page. The value column says which one is current; no
//                chevron, because a sheet closing is not a screen opening.
//   destructive  acts and cannot be undone — delete, unpin.
//   toggle       a switch. Inert markup around Toggle.
//   value        displays and does nothing. Inert.
//
// `rowKind` derives the kind from Row's props so that no existing caller
// changes: a row with `onSelect` and nothing else is still a push, still
// a button, still carries its chevron. Callers that act, choose or
// destroy say so with `kind`. That back-compat default is deliberate and
// it has a cost, recorded here: a caller that FORGETS `kind` on an action
// row gets a chevron, not an error, and only the screen's own test (or
// the photograph) can see it. The plan's gate closes that by scanning for
// `.shell-row-chevron` on any row whose data-kind is not push.

export const ROW_KINDS = ["push", "action", "choice", "destructive", "toggle", "value"];

/**
 * The kind of a row, from its props. An explicit `kind` wins outright;
 * otherwise the props decide in the order Row.svelte always read them.
 *
 * @param {{ onSelect?: (() => void) | null, toggle?: boolean,
 *           destructive?: boolean, kind?: string | null }} props
 * @returns {"push"|"action"|"choice"|"destructive"|"toggle"|"value"}
 */
export function rowKind({ onSelect = null, toggle = false, destructive = false, kind = null } = {}) {
  if (kind !== null && kind !== undefined) {
    // Fail loud rather than render a typo as a chevron-less plain row: a
    // misspelled kind would otherwise look exactly like `choice` and pass
    // every test that only counts chevrons.
    if (!ROW_KINDS.includes(kind)) throw new Error(`rowKind: unknown kind "${kind}"`);
    return kind;
  }
  if (destructive) return "destructive";
  if (toggle) return "toggle";
  if (onSelect) return "push";
  return "value";
}

/**
 * Whether a kind draws the chevron. True only for a push: the chevron is
 * the promise of a screen, and no other kind opens one.
 *
 * @param {string} kind
 * @returns {boolean}
 */
export function rowChevron(kind) {
  return kind === "push";
}

/**
 * The tone a kind is drawn in. `accent` for an action (an offer, drawn to
 * be noticed), `warm` for a destructive row (a warning), `ink` for the
 * rest. Both resolve to --warm-accent in Row.svelte today; they are two
 * words because they mean two things, and the day the palette gives a
 * warning its own colour only the stylesheet changes.
 *
 * @param {string} kind
 * @returns {"ink"|"accent"|"warm"}
 */
export function rowTone(kind) {
  if (kind === "action") return "accent";
  if (kind === "destructive") return "warm";
  return "ink";
}
