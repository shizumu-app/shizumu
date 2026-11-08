// pins-dock.js — does the pins panel sit beside the page, or over it?
//
// THE BUG. The panel always slid over the page behind a scrim
// (`--scrim-soft`), so reading a pin and writing were two separate moments:
// the page dimmed and a click on it closed the panel (walk-through,
// 2026-11-01). Spec §1: on a window wide enough to keep the page at its
// writing width AND hold the panel, the panel docks to the right and the
// page stays live and undimmed. Below that, today's overlay stays.
//
// "Wide enough" is measured against the page's real writing width, not the
// sheet's 900px floor: the floor is there so a small font does not leave a
// sliver on a big screen, and it may give way while the panel is docked.
// The 72-character column may not. So the page needs
//
//     72ch (at the canvas font) + the sheet's own 72px of padding
//
// and the window needs that, plus the panel, plus a gutter on each side of
// the sheet so it still reads as a sheet on the desk.
//
// Not persisted (ruling 4): the answer follows the window width every time.

/** The docked panel's width, px. The mockup's 380. */
export const DOCK_PANEL_WIDTH = 380;
/** The sheet's horizontal padding, px (Page.svelte: 36px each side). */
export const SHEET_PADDING = 72;
/** Desk visible either side of the sheet while docked, px. */
export const DOCK_GUTTER = 24;
/** The sheet's widest, px (Page.svelte's clamp upper bound). */
export const SHEET_MAX = 1200;
/** The sheet's floor when nothing is docked, px. */
export const SHEET_FLOOR = 900;

/**
 * The page sheet's minimum width while docked: 72 characters plus padding.
 * @param {number} chPx  width of one `ch` at the canvas font
 */
export function minSheetWidth(chPx) {
  const ch = Number.isFinite(chPx) && chPx > 0 ? chPx : 8;
  return Math.ceil(72 * ch + SHEET_PADDING);
}

/**
 * @param {{ viewportWidth: number, chPx: number, panelWidth?: number }} input
 * @returns {"dock"|"overlay"}
 */
export function pinsPanelPlacement({ viewportWidth, chPx, panelWidth = DOCK_PANEL_WIDTH }) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return "overlay";
  const need = minSheetWidth(chPx) + 2 * DOCK_GUTTER + panelWidth;
  return viewportWidth >= need ? "dock" : "overlay";
}

/**
 * How wide the sheet is while docked: as wide as it would be undocked, but
 * never wider than what is left beside the panel.
 * @param {{ viewportWidth: number, chPx: number, panelWidth?: number }} input
 */
export function dockedSheetWidth({ viewportWidth, chPx, panelWidth = DOCK_PANEL_WIDTH }) {
  const natural = Math.min(SHEET_MAX, Math.max(SHEET_FLOOR, minSheetWidth(chPx)));
  const room = viewportWidth - panelWidth - 2 * DOCK_GUTTER;
  return Math.max(minSheetWidth(chPx), Math.min(natural, room));
}
