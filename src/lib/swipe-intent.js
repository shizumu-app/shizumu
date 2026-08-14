// What a committed edge swipe should actually do, given where the user is.
//
// The horizontal swipes are page navigation, mirroring the desktop
// Ctrl/Cmd+Left and Ctrl/Cmd+Right shortcuts — left pulls the previous
// page in, right moves forward along the rail. They used to be wired to
// something else entirely: the left edge popped the navstack (and was
// disabled outright when there was nothing to pop, so on a plain page it
// did nothing at all), and the right edge created a new page every time.
//
// Back still wins the left edge when something is actually open, because
// that's the platform gesture for dismissing a sheet, settings, or memory —
// navigating the page rail out from under an open sheet would be wrong.
// Only once the stack is empty does the left edge mean "previous page".
//
// On the LAST page there's no "next" for a right swipe to pull in — that
// used to just no-op (the reported bug), so it now means the same thing as
// the pages sheet's "+ new page": start a fresh page. And any swipe while
// the keyboard is up is suppressed outright — that drag is the user working
// the keyboard/cursor, never a navigation gesture.

/**
 * @param {object} state
 * @param {"left"|"right"|null} state.edge   which edge the drag started in
 * @param {"page"|"memory"|string} state.space  the current space
 * @param {number} state.navDepth            navstack depth (open sheets etc.)
 * @param {boolean} state.atLastPage         true when there's no next page on the rail
 * @param {boolean} state.keyboardOpen       true when the on-screen keyboard is up
 * @returns {"back"|"prev"|"next"|"create"|null}  null means "ignore this gesture"
 */
export function swipeIntent({ edge, space, navDepth = 0, atLastPage = false, keyboardOpen = false }) {
  if (keyboardOpen) return null;
  if (edge === "left") {
    // Something is open — dismiss it, same as hardware back.
    if (navDepth > 0 || space === "memory") return "back";
    return space === "page" ? "prev" : null;
  }
  if (edge === "right") {
    // Never navigate the rail while a sheet is over it.
    if (navDepth > 0) return null;
    if (space !== "page") return null;
    // On the last page there is no "next" to pull in — the gesture means
    // "give me a fresh page", same as the pages sheet's "+ new page".
    return atLastPage ? "create" : "next";
  }
  return null;
}
