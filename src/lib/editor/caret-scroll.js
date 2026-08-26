// caret-scroll.js — keeping the caret in view at the bottom of the editor.
//
// The bug: pressing Enter on the last line adds a line you cannot see. The
// doc grows, the caret moves into the new paragraph, and the scroller does
// not move — so the caret is below the fold. Pressing ↓ afterwards scrolls
// it into view, which is how the problem reads to a user: "it adds a line
// but it does not appear, I have to press down arrow."
//
// It is not a missing scroll call. ProseMirror DOES run its scroll on that
// transaction; instrumenting `handleScrollToSelection` showed it firing on
// Enter exactly as it fires on a keystroke. What differs is what it has to
// aim at. For the caret in a brand-new EMPTY paragraph, `coordsAtPos`
// returns an all-zero rect — `{top: 0, bottom: 0, left: 0, right: 0}` —
// because the paragraph's only child at that moment is ProseMirror's
// trailing `<br>`, which reports no client rects. And prosemirror-view's
// `scrollRectIntoView` opens with:
//
//     if (!nonZero(rect) && rect.left == 0) return
//
// a guard meant for `display: none` content. So it returns having done
// nothing. Type one character into that same paragraph and the rect
// becomes real (measured: top 737.7 against a container bottom of 729) and
// the identical code path scrolls correctly.
//
// The fix is to answer the question PM could not: measure the caret's own
// BLOCK ELEMENT, which always has a box, and scroll the container by the
// difference. Kept here as a pure function of two rectangles because a
// scroll decision computed inline in a component is a scroll decision
// nothing can test — the project's testing rules exist because exactly
// this class of geometry bug kept reaching devices.

/**
 * Breathing room kept below the caret's block, in pixels.
 *
 * Not zero: landing the last line flush against the container's bottom
 * edge is technically "in view" and still feels like writing into the
 * frame of the window. One line of slack means the next line you are
 * about to write is already visible before you write it.
 */
export const CARET_SCROLL_MARGIN_PX = 28;

/**
 * How much to scroll a container so a block sits comfortably inside it.
 *
 * @param {{top: number, bottom: number}|null} blockRect - viewport rect of
 *   the block holding the caret.
 * @param {{top: number, bottom: number}|null} containerRect - viewport rect
 *   of the scrolling element.
 * @param {number} [margin] - see CARET_SCROLL_MARGIN_PX.
 * @returns {number} pixels to ADD to scrollTop. 0 when already comfortable,
 *   negative to scroll up.
 */
export function caretScrollDelta(blockRect, containerRect, margin = CARET_SCROLL_MARGIN_PX) {
  if (!blockRect || !containerRect) return 0;
  const height = containerRect.bottom - containerRect.top;
  if (height <= 0) return 0;

  // A block taller than the viewport can never satisfy both edges. Align
  // its top and let the user scroll — the alternative pins them to the
  // bottom of a long block, which is never where the caret entered it.
  if (blockRect.bottom - blockRect.top > height) {
    return blockRect.top - containerRect.top - margin;
  }

  const below = blockRect.bottom + margin - containerRect.bottom;
  if (below > 0) return below;
  const above = blockRect.top - margin - containerRect.top;
  if (above < 0) return above;
  return 0;
}

/**
 * Is this rect the degenerate one PM's own scroll gives up on?
 *
 * Mirrors prosemirror-view's `nonZero(rect) || rect.left != 0` test, so
 * the app takes over in exactly the cases PM declines to handle and stays
 * out of the way everywhere else. Getting this wrong in the permissive
 * direction would mean fighting PM for the scroll position on every
 * keystroke.
 *
 * @param {{top: number, bottom: number, left: number, right: number}|null} rect
 * @returns {boolean}
 */
export function isDegenerateCaretRect(rect) {
  if (!rect) return true;
  const nonZero = rect.top < rect.bottom || rect.left < rect.right;
  return !nonZero && rect.left === 0;
}
