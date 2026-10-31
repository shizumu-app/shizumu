// Where the desktop's "pin selection" button sits: by the END of the
// selection, where the pointer was released.
//
// It used to sit above `range.getBoundingClientRect()`, the box around the
// whole selection, whose top is the selection's FIRST line. A selection
// dragged down over several blocks put the button above where the drag
// began, often scrolled out of view, while the writer's pointer was at the
// bottom; pinning several blocks read as "pin is not working" (found by
// the J12 journey on 2026-10-29, the harness could not find the button
// either). The last of the range's line boxes is the line the selection
// ends on.

/**
 * @param {{getClientRects?: () => ArrayLike<DOMRect>, getBoundingClientRect?: () => DOMRect}|null} range
 * @returns {{top: number, bottom: number, right: number}|null} the end line's box, or null
 *   when the range has no box to read (the caller falls back to the
 *   editor's own coordinates)
 */
export function selectionEndRect(range) {
  if (!range) return null;
  const rects = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
  const last = [...rects].reverse().find((r) => r && (r.width > 0 || r.height > 0));
  if (last) return { top: last.top, bottom: last.bottom ?? last.top + last.height, right: last.right };
  const box = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
  if (box && (box.width > 0 || box.height > 0)) return { top: box.top, bottom: box.bottom ?? box.top + box.height, right: box.right };
  return null;
}

/** The button's height and its gap from the line, in px. */
export const PIN_BUTTON_LIFT = 32;
const PIN_BUTTON_DROP = 8;

/**
 * The button's top inside the editor wrapper (content space, scroll
 * included): just above the end line when there is room in the visible
 * wrapper, just below it otherwise. A selection ending on the page's first
 * lines put the button above the wrapper's top edge, clipped and out of
 * reach (the J12 journey's overlap check, 2026-10-29).
 * @param {{top: number, bottom: number}} end  selectionEndRect's answer, viewport space
 * @param {{top: number}} wrapperRect  the wrapper's box, viewport space
 * @param {number} scrollTop  the wrapper's scroll
 */
export function pinButtonTop(end, wrapperRect, scrollTop) {
  const above = end.top - wrapperRect.top - PIN_BUTTON_LIFT;
  if (above >= 0) return above + scrollTop;
  return end.bottom - wrapperRect.top + PIN_BUTTON_DROP + scrollTop;
}
