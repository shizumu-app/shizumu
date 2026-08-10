// Where the block-action controls sit relative to the block they act on.
//
// Desktop keeps them as a vertical column in the editor's 32px left
// gutter. Phones reclaim that gutter for writing width, so there is no
// column to sit in — the controls become a horizontal bar that floats
// clear of the text instead. Putting the arithmetic here (rather than
// inline in TipTapEditor) keeps it testable without mounting an editor.

/** Height of the floating bar on touch: one 2.5rem row plus its border. */
export const HANDLE_BAR_HEIGHT = 42;

/** Breathing room between the bar and the block it belongs to. */
export const HANDLE_BAR_GAP = 6;

/**
 * Place the floating bar for a block.
 *
 * Normally the bar goes above the block: the block being acted on stays
 * fully readable, which is the whole point — the old phone layout dropped
 * the vertical column straight onto the block's first 40px and hid it.
 *
 * When the block sits too close to the top of the visible area for the
 * bar to fit above it (the first block of a page, or a block scrolled to
 * the top edge), the bar flips below the block rather than being clipped
 * out of view. It still never covers the block it acts on.
 *
 * @param {object} args
 * @param {number} args.blockTop     block's top, in scroll-content coords
 * @param {number} args.blockHeight  block's height in px
 * @param {number} args.scrollTop    the scroll container's current scrollTop
 * @param {number} [args.barHeight]
 * @param {number} [args.gap]
 * @returns {{ top: number, placement: "above" | "below" }}
 */
export function placeHandleBar({
  blockTop,
  blockHeight,
  scrollTop,
  barHeight = HANDLE_BAR_HEIGHT,
  gap = HANDLE_BAR_GAP,
}) {
  const visibleRoomAbove = blockTop - scrollTop;
  if (visibleRoomAbove >= barHeight + gap) {
    return { top: clampToContainer(blockTop - barHeight - gap), placement: "above" };
  }
  return { top: clampToContainer(blockTop + blockHeight + gap), placement: "below" };
}

/**
 * The bar is absolutely positioned inside `.tiptap-wrapper`, which is
 * `overflow-y: auto`. A negative offset puts it above the scroll
 * container's content box, where it is clipped out of existence — while
 * still reporting a perfectly good getBoundingClientRect. That combination
 * is nasty: `waitFor({state:"visible"})` passes, `boundingBox()` returns a
 * real box, and the pixels are simply absent. It cost a VR baseline that
 * captured an empty page and looked fine.
 *
 * Never hand back an offset the container cannot show.
 */
function clampToContainer(top) {
  return Math.max(0, top);
}
