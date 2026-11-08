// pin-panel-empty.js — what an empty pins list says, and why.
//
// THE BUG. On an untrailed page with no pins the panel said "nothing
// matches" with nothing searched and no filter on (walk-through,
// 2026-11-01): a sentence about a search the writer never made. An empty
// list has three different causes and each one tells the writer something
// else to do (spec §1, "empty states, in brand voice"):
//
//   untrailed   the page has no trail, so no trail's pins can come back to
//               it. Choosing a trail is the way back (CLAUDE.md, Context
//               clause), so this one carries the trail button.
//   trailEmpty  the trail exists and nothing on it is pinned yet.
//   noMatch     there ARE pins in scope; the search or a chip hid them all.
//               Only this one offers `clear filters`.
//
// The order of the checks is the decision: a narrowing filter on an empty
// scope still reads as the scope being empty, because clearing the filter
// would show nothing either.

/**
 * @param {{
 *   loading?: boolean,
 *   lineageId?: string|null,
 *   scopeCount: number,     // pins in the current scope before toggles/search
 *   visibleCount: number,   // pins left after toggles/search
 *   allScope?: boolean,     // the `all trails` scope is chosen
 * }} state
 * @returns {null | { kind: "untrailed"|"trailEmpty"|"allEmpty"|"noMatch", title: string, body: string, action: null|"chooseTrail"|"clearFilters" }}
 */
export function pinsEmptyState({ loading = false, lineageId = null, scopeCount, visibleCount, allScope = false }) {
  // Not empty, or not known to be empty yet: render the list (or loading).
  if (loading || visibleCount > 0) return null;
  if (scopeCount > 0) {
    return { kind: "noMatch", title: "nothing matches", body: "", action: "clearFilters" };
  }
  if (allScope) {
    return {
      kind: "allEmpty",
      title: "nothing pinned yet",
      body: "select a passage and press pin.",
      action: null,
    };
  }
  if (!lineageId) {
    return {
      kind: "untrailed",
      title: "this page has no trail yet.",
      body: "choose one and the pins kept there come back here.",
      action: "chooseTrail",
    };
  }
  return {
    kind: "trailEmpty",
    title: "nothing pinned on this trail yet.",
    body: "select a passage and press pin.",
    action: null,
  };
}
