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

/**
 * @param {object} state
 * @param {"left"|"right"|null} state.edge   which edge the drag started in
 * @param {"page"|"memory"|string} state.space  the current space
 * @param {number} state.navDepth            navstack depth (open sheets etc.)
 * @returns {"back"|"prev"|"next"|null}  null means "ignore this gesture"
 */
export function swipeIntent({ edge, space, navDepth = 0 }) {
  if (edge === "left") {
    // Something is open — dismiss it, same as hardware back.
    if (navDepth > 0 || space === "memory") return "back";
    return space === "page" ? "prev" : null;
  }
  if (edge === "right") {
    // Never navigate the rail while a sheet is over it.
    if (navDepth > 0) return null;
    return space === "page" ? "next" : null;
  }
  return null;
}
