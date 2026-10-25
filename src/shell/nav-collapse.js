// Whether the shell's nav bar is showing its one-line form right now.
//
// One trigger: the content has scrolled away from the top.
//
// THE KEYBOARD USED TO BE A SECOND ONE, on the reasoning that a writing
// surface wants the room when someone is typing in it. The device pass
// priced that reasoning and it does not hold. The nav carries the trail
// row, its + for a new page and the trail's own control, so a keyboardOpen
// that goes wrong takes away every way to add a page or change the trail —
// and on a Galaxy A34 it went wrong repeatedly, where a page zoom measured
// as a 310px keyboard. The writer's only way out was to restart the app.
//
// Scrolling cannot strand anyone that way: scrolling back up brings the bar
// straight back, and the band below keeps it from flickering en route. The
// keyboard trigger had no such escape, so it is gone. A couple of rows of
// writing space are not worth a surface someone can be locked out of.
//
// The hysteresis band is the part that is easy to leave out and expensive to
// omit. With a single threshold, a scroll position that hovers on it flips
// the bar on every frame: the header jitters, and every layout that reads
// its height jitters with it. Collapsing at 24px but only expanding again
// below 8px means the bar changes state twice per gesture at most.
//
// This is not `src/lib/header-collapse.js`. That one answers a different
// question for the DESKTOP tree's phone branches — whether an overlay owns
// the header — and knows nothing about scroll. The shell has no isPhone axis
// (it is always the phone tree) and no overlay depth (its overlays are
// Sheets, which do not own the bar).

/**
 * @param {object} state
 * @param {number} state.scrollTop      the content band's scroll offset, px
 * @param {boolean} [state.collapsed]   the bar's current state — the answer inside the band
 * @param {boolean} [state.keyboardOpen]
 * @param {number} [state.collapseAt]   px scrolled at which it collapses
 * @param {number} [state.expandAt]     px scrolled below which it expands
 * @returns {boolean}
 */
export function navCollapsed({
  scrollTop,
  collapsed = false,
  // Accepted and ignored. Kept in the signature because both callers pass
  // it and a silently-dropped argument reads as an oversight; the comment
  // above is the reason it does nothing.
  keyboardOpen = false,
  collapseAt = 24,
  expandAt = 8,
}) {
  void keyboardOpen;
  if (scrollTop >= collapseAt) return true;
  if (scrollTop <= expandAt) return false;
  return collapsed;
}
