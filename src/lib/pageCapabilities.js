// src/lib/pageCapabilities.js
//
// One rule about when a new page may be created, shared by everything that
// offers the action.
//
// There used to be a module-level canNewPage flag here as well, mirrored
// out of Page.svelte so App.svelte's right-edge gesture could read it at
// gesture time. The flag is gone, but the gesture still creates a page on
// a right-edge swipe from the last page (handleRailNew in App.svelte),
// re-checking canCreateNewPage below directly instead of a cached mirror.

/**
 * Whether "new page" is valid right now. The ONLY rule is the date: new
 * pages belong to today.
 *
 * Trail mode is deliberately not an input. This used to also require
 * `currentTrailMode !== "continuous"`, which conflated two claims: "you
 * can't add a page to THIS continuous trail" (true, enforced in Rust by
 * check_continuous_invariant) and "you can't create any page while viewing
 * one" (false). create_new_page never sets lineage_id, so a new page is
 * untrailed and cannot violate the single-canonical invariant.
 *
 * @param {string} viewingDate YYYY-MM-DD currently on screen
 * @param {string} todayStr    YYYY-MM-DD local today
 */
export function canCreateNewPage(viewingDate, todayStr) {
  if (!viewingDate || !todayStr) return false;
  return viewingDate === todayStr;
}
