// Where the gutter handle sits against the block it belongs to.
//
// NOT `src/lib/editor/handle-placement.js` coming back. That module placed
// the desktop's FLOATING block-handles bar — an overlay phones fell back to
// when the editor gutter was removed on small screens — and it was deleted
// with that layout because a pure module outliving the decision it made is
// dead weight (CLAUDE.md, testing rules). The shell's handle is not an
// overlay: it is one 44px control in a gutter that is part of the canvas's
// layout (spec §2), positioned by PageScreen's `gutterHandle`. The decision
// here is a different and much smaller one — given that column, which
// vertical offset puts the glyph on the block's FIRST LINE.
//
// The defect this answers was seen on a device: the `⋮` sat visibly below
// the text of the block it belonged to, about a line down on a Samsung.
// PageScreen placed the gutter's top AT the block's top, and the gutter's
// only content is a ToolbarButton whose box is `min-height: var(--tap)`
// (44px) — so the glyph was centred 22px below the block's top, while a
// prose line at 16px × 1.6 is 25.6px tall and its centre is 12.8px down.
// Nine pixels low by construction, and a device's font metrics widen it.
// The tap box was right; the glyph was centred on the wrong thing.
//
// The fix is arithmetic and nothing else — the gutter's width, the button's
// min-height and the hit area all stay (P2d's handoff records touch targets
// under 44px as a defect class). The column is simply shifted up by half
// the difference between the tap box and the first line box, so the two
// share a centre. A line taller than the tap box shifts it DOWN instead,
// which is the same formula with the sign the other way.

/** The floor `--tap` resolves to: global.css defines it as the larger of
 *  the design's touch token and 44px. Used only when the token cannot be
 *  read at all (jsdom, or a canvas with no computed padding), so the
 *  fallback is the number the token can never go below rather than a
 *  guess. */
export const TAP_FLOOR_PX = 44;

/** The ratio browsers use for `line-height: normal` is font-dependent and
 *  unspecified; CSS 2.1 §10.8 suggests 1.0–1.2. Prose never asks for
 *  `normal` — `.prose` and `.ProseMirror` both set 1.6 and every heading
 *  sets its own number — so this is the reading for a block that has
 *  escaped the stylesheet, and 1.2 is the top of the suggested range. */
export const NORMAL_LINE_HEIGHT = 1.2;

/**
 * The height of a block's first line box, in px, from its computed style.
 *
 * WHY THE COMPUTED LINE-HEIGHT AND NOT A RANGE'S CLIENT RECT. A Range over
 * the block's first text reports the glyphs' content area — the font's
 * ascent plus descent — not the line box, so it would put the handle on a
 * different centre than the text actually sits on. And the block the defect
 * was reported on has no text at all: an empty paragraph holds only
 * ProseMirror's trailing <br>, which reports no client rects (PageScreen's
 * caret-visible fallback exists for the same reason), so a Range would
 * measure nothing on exactly the page the screenshot showed. The computed
 * `line-height` is the line box's height whenever the line holds only the
 * block's own text — the paragraph, the heading, the empty line with its
 * placeholder — and it is per-block: a heading's 1.45 × its own size, a
 * paragraph's 1.6 × 16px. A line that carries something taller inline (an
 * image, a larger inline font) is taller than this says, and the handle
 * lands a little above that line's centre rather than on it; that is the
 * one approximation here, and it errs toward the block's top, never below.
 *
 * `lineHeight` is `getComputedStyle(block).lineHeight`. Browsers return the
 * used value in px for a number or a length (CSSOM's resolved-value rule),
 * "normal" for `normal`, and jsdom returns whatever inline style says, or
 * "" when nothing does. `fontSize` is read the same way and only consulted
 * for the two forms that need it.
 *
 * @param {{ lineHeight: string, fontSize: string }} style
 * @returns {number | null} px, or null when the line cannot be measured
 */
export function lineHeightPx({ lineHeight, fontSize }) {
  const lh = String(lineHeight ?? "").trim();
  if (lh === "") return null;
  if (lh.endsWith("px")) {
    const n = parseFloat(lh);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const fs = parseFloat(String(fontSize ?? ""));
  if (!Number.isFinite(fs) || fs <= 0) return null;
  if (lh === "normal") return NORMAL_LINE_HEIGHT * fs;
  const ratio = Number(lh);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return ratio * fs;
}

/**
 * The tap box's height in px, read off the canvas's computed `padding-left`.
 *
 * That padding IS `var(--tap)` — `.ps-canvas`'s left inset is the gutter,
 * the gutter is `width: var(--tap)`, and the button in it is `min-height:
 * var(--tap)` (PageScreen's styles say why they are one token). It is read
 * from the canvas rather than from the gutter because the gutter renders
 * FROM the number this feeds: the column does not exist until its top is
 * known, so measuring the column to place the column is a circle. The
 * canvas is there from the first frame, and a padding resolves to px in
 * every engine, which the custom property itself does not (`--tap`'s
 * computed value is its `max()` expression, not a length).
 *
 * @param {string} paddingLeft `getComputedStyle(canvas).paddingLeft`
 * @returns {number} px; `TAP_FLOOR_PX` when the padding cannot be read
 */
export function tapPx(paddingLeft) {
  const n = parseFloat(String(paddingLeft ?? ""));
  return Number.isFinite(n) && n > 0 ? n : TAP_FLOOR_PX;
}

/**
 * The gutter column's `top`, canvas-relative, such that the tap box and the
 * block's first line box share a centre.
 *
 *   blockTop + (firstLineHeight − tapPx) / 2
 *
 * Negative for any line shorter than the tap box (a 25.6px paragraph line
 * in a 44px box: −9.2), positive for a line taller than it.
 *
 * A null `firstLineHeight` — the line could not be measured — answers
 * `blockTop`: the handle sits at the block's top, which is the old
 * placement and the honest bound of the error, never `NaN` and never a
 * guessed line. jsdom takes this path unless a test stubs the style.
 *
 * @param {{ blockTop: number, firstLineHeight: number | null, tapPx: number }} geometry
 * @returns {number}
 */
export function handleTop({ blockTop, firstLineHeight, tapPx }) {
  if (firstLineHeight === null || firstLineHeight === undefined) return blockTop;
  return blockTop + (firstLineHeight - tapPx) / 2;
}

/**
 * Which element the handle's column lines up with.
 *
 * THE DEFECT, reproduced on a device: inside a table every cell reported
 * `table@20` and the handle stayed at the table's top, however far down the
 * caret went. `readActiveBlock` resolves to depth 1 — the top-level node —
 * which is right for what the handle ACTS on (turn into, move up, move down
 * mean the table, not one cell) and wrong for where it SITS. The caret's
 * chain in that case was `div > table > tbody > tr > td > p`: five levels
 * below the thing being measured.
 *
 * So the two questions are separated. The block stays the top-level node;
 * the column lines up with the line the caret is actually on. A writer in
 * the fourth cell sees the handle beside the fourth cell and knows which
 * line they are on; pressing it still offers what can honestly be done to
 * the whole table.
 *
 * Containment is checked rather than assumed: a stale line element from the
 * previous selection would otherwise drag the column somewhere the block is
 * not, which is worse than the defect — the handle would point at another
 * block entirely. When it cannot be trusted, the block's own box is the
 * answer, which is exactly the behaviour this replaces.
 *
 * @param {{contains?: (el: any) => boolean}|null} blockEl  the top-level node's DOM
 * @param {any|null} lineEl  the element the caret sits in, or null
 * @returns {any|null} the element to measure
 */
export function handleAnchor(blockEl, lineEl) {
  if (!blockEl) return null;
  if (!lineEl || lineEl === blockEl) return blockEl;
  return typeof blockEl.contains === "function" && blockEl.contains(lineEl) ? lineEl : blockEl;
}
