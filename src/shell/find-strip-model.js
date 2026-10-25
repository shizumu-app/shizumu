// What the find strip says about a search, and which of its controls are dead.
//
// The strip is `field · prev · next · close` (FIND_STRIP, toolbar-model.js).
// Its three inputs are the whole payload of the `shizumu:find-state` window
// event the find extension broadcasts — `{ query, total, activeIdx }`
// (find-replace.js:59-67) — and this file turns them into the one sentence
// beside the field and the ids that render dead.
//
// WHY THIS OWNS `disabledIds` INSTEAD OF `disabledIdsFor` (toolbar-state.js),
// which answers the same question for every other strip. Two reasons, and the
// second is the one that would survive if the first were solved:
//
//   1. `disabledIdsFor` takes the EDITOR SNAPSHOT, and find state is not in
//      it and cannot be. `FindReplaceKey` is module-private
//      (find-replace.js:25), so `computeSnapshot` has no way to read match
//      state; the window event is the only door, and exporting the key would
//      be an `src/lib/` change this branch may not make. Handing
//      `disabledIdsFor` a second argument from a different producer would
//      quietly break its documented contract — "a booleans bag and a
//      snapshot" — which is itself a recorded scar, not a preference.
//   2. toolbar-state.js's header says why active and disabled share one
//      module: "both answers are read off the same editor state on the same
//      transaction." Find state is read off NEITHER. It arrives
//      asynchronously on a window event that can lag the editor by a tick,
//      so co-locating it there would put the module's stated reason for
//      existing next to a case that contradicts it.
//
// And the positive reason: `label` and `disabledIds` are the same decision
// read twice. `total === 0` is exactly when the label says "no matches" and
// exactly when prev/next have nothing to step between. Splitting them across
// two files gives one condition two homes, and they drift the way any
// duplicated guard drifts — silently, because a live arrow beside a "no
// matches" label looks like a strip that is merely optimistic.
//
// The caller still spreads this into the same `disabledIds` array as
// everything else (ShellApp), so the strip sees one list; what is decided
// here is only find's share of it.

/**
 * @param {{query?: string, total?: number, activeIdx?: number}} [state]
 *   the `shizumu:find-state` detail, verbatim. Absent on the first frame:
 *   the strip paints when `findOpen` flips and the extension's initial
 *   broadcast (find-replace.js:121-124) lands a tick later, so every field
 *   is optional and falls to "nothing typed yet".
 * @returns {{label: string, disabledIds: string[]}}
 */
export function findStripModel({ query = "", total = 0, activeIdx = -1 } = {}) {
  return {
    label: findLabel(query, total, activeIdx),
    // `field` and `close` are never here. A field you cannot type in cannot
    // recover from the query that emptied the strip, and a close you cannot
    // press leaves the user in a mode with no way out — the two controls a
    // dead-end state most needs are the two it would be most tempting to
    // grey out alongside the arrows.
    //
    // The floor is `total === 0`, not "no active match": with total 1 both
    // arrows are no-ops that the extension still accepts (it mods by
    // matches.length), and with `activeIdx -1` `next` is the ONLY way to
    // reach the first match. Disabling either of those would take away a
    // control at the moment it is doing its job.
    disabledIds: total > 0 ? [] : ["prev", "next"],
  };
}

function findLabel(query, total, activeIdx) {
  // Nothing typed. Not "no matches" — an untyped field reporting a failed
  // search accuses the user of something they have not done, on the frame
  // the strip opens, before they can have done anything at all. The desktop
  // renders nothing here too (FindBar.svelte:129-133); this is the same
  // answer, said out loud because it is the easiest one to lose.
  //
  // Deliberately not trimmed. `collectMatches` (find-replace.js:28-45)
  // searches the raw string, so a query of spaces really does highlight
  // every space in the document; reading it as "untyped" would blank the
  // label while the page lit up.
  if (!query) return "";

  // A search that found nothing. The desktop's exact words
  // (FindBar.svelte:132) — one feature, one phrasing.
  if (total === 0) return "no matches";

  // A match is current. The desktop's exact form (FindBar.svelte:130).
  if (activeIdx >= 0) return `${activeIdx + 1} of ${total}`;

  // Matches exist but none is current — the one state where this diverges
  // from the desktop, because the desktop is wrong there. It is reachable:
  // find-replace.js:97-102 re-collects matches for the standing query on
  // every doc change and carries `prev.activeIdx` forward untouched unless
  // it ran past the end, so a query that matched nothing (activeIdx -1) and
  // then starts matching, because the user typed the word, arrives here.
  // `{activeIdx + 1} of {total}` prints "0 of 3": a match numbered zero,
  // which no arrow can reach, while the document carries no active
  // highlight either (find-replace.js:115). Reporting the count and no
  // position is what is actually true.
  return total === 1 ? "1 match" : `${total} matches`;
}
