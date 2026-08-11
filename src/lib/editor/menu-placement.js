// Where the slash-command menu goes, and how tall it may be.
//
// Extracted from `positionMenu` in slash-commands.js, which had no height
// bound at all. On a phone with the keyboard up the menu is routinely taller
// than what is left of the viewport, and the old code's last resort was
// `top = max(8, vh - menuH - 8)`. With `menuH > vh` that is simply `8` — the
// menu started 8px from the top of the *viewport*, which on a phone is
// underneath the status bar, and ran off the bottom behind the keyboard. The
// first section was under the clock and the last was unreachable.
//
// The fix is a max height, not a cleverer top: a menu that cannot fit must
// scroll, and it must never begin above the safe area.

/** Gap between the caret and the menu, and the minimum edge margin. */
const GAP = 4;
const MARGIN = 8;

/**
 * @param {object}  a
 * @param {{top:number, bottom:number, left:number}} a.caretRect  caret rect, viewport coords
 * @param {number}  a.menuH      the menu's natural (unclamped) height
 * @param {number}  a.menuW      the menu's width
 * @param {number}  a.vh         visible viewport height — visualViewport when the keyboard is up
 * @param {number}  a.vw         visible viewport width
 * @param {number} [a.safeTop]   status-bar / notch inset
 * @param {number} [a.safeBottom] home-indicator inset
 * @returns {{top:number, left:number, maxHeight:number}}
 */
export function placeMenu({
  caretRect,
  menuH,
  menuW,
  vh,
  vw,
  safeTop = 0,
  safeBottom = 0,
}) {
  const topLimit = safeTop + MARGIN;
  const bottomLimit = vh - safeBottom - MARGIN;

  const below = caretRect.bottom + GAP;
  const roomBelow = bottomLimit - below;
  const roomAbove = caretRect.top - GAP - topLimit;

  let top;
  let maxHeight;

  if (menuH <= roomBelow) {
    // Fits under the caret, which is where it belongs — the eye is already
    // there and the caret stays visible.
    top = below;
    maxHeight = roomBelow;
  } else if (menuH <= roomAbove) {
    // Flip above. Only when it fits whole: a flipped menu that then has to
    // scroll hides the caret behind itself for no gain.
    top = caretRect.top - GAP - menuH;
    maxHeight = roomAbove;
  } else {
    // Fits neither way. Take the roomier side and let the menu scroll, rather
    // than overflowing off-screen. `maxHeight` is what makes this survivable;
    // without it the old code pinned the menu at the top edge and the tail of
    // the list was simply unreachable.
    if (roomBelow >= roomAbove) {
      top = below;
      maxHeight = roomBelow;
    } else {
      top = topLimit;
      maxHeight = roomAbove;
    }
  }

  // Never start above the safe area, whatever the arithmetic produced — this
  // is the clamp whose absence put the menu under the status bar.
  top = Math.max(topLimit, top);
  // And never promise more height than there is between top and the bottom
  // limit; the branches above can over-promise once `top` has been clamped.
  maxHeight = Math.max(0, Math.min(maxHeight, bottomLimit - top));

  let left = caretRect.left;
  if (left + menuW > vw - MARGIN) left = vw - MARGIN - menuW;
  left = Math.max(MARGIN, left);

  return { top, left, maxHeight };
}
