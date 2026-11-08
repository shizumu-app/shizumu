// trail-map-entries.js — what one entry on memory's trail map shows
// (spec 2026-11-01 §3, ruling 7).
//
// THE FAULTS. Each day's trail block was a card stretched across the window
// for a one-line title, with no hint of what the page said and its pins
// reduced to a "1 pin" badge you had to open to read. The map is where the
// pin × trail view is read; a pin you cannot see there is a pin you do not
// return to.
//
// Each page is now an entry: trail path, title, the page's first line as a
// preview, and every pin kept FROM that page under it (matched on
// source_page_id). A pin whose page is not on the map (another day's page
// outside the window, or a page since deleted) still shows on its day, on
// its own line, so nothing the map used to count goes missing.

import { trailGroupsForDate, relativeLineagePath } from "./memory-filters.js";
import { pinDisplayTitle } from "./pin-display.js";
import { lineagePath } from "./trail-utils.js";

const PREVIEW_MAX = 160;

function clip(s, max = PREVIEW_MAX) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** First line of prose in a TipTap doc: the first block with text, not a
 *  day marker and not a pinned block (the pins show under the entry, so
 *  previewing one would show it twice). */
function firstDocLine(contentJson) {
  let doc = contentJson;
  if (typeof doc === "string") {
    try { doc = JSON.parse(doc); } catch { return ""; }
  }
  if (!doc || typeof doc !== "object") return "";
  let found = "";
  function textOf(node) {
    if (!node || typeof node !== "object") return "";
    if (typeof node.text === "string") return node.text;
    return Array.isArray(node.content) ? node.content.map(textOf).join("") : "";
  }
  function walk(node) {
    if (found || !node || typeof node !== "object") return;
    if (node.type === "dayMarker") return;
    if (node.attrs && node.attrs.pinId) return;
    const kids = Array.isArray(node.content) ? node.content : [];
    // A textblock: its own inline text is the line.
    if (kids.length > 0 && kids.every((k) => k && (typeof k.text === "string" || k.type === "hardBreak" || !Array.isArray(k.content)))) {
      const t = textOf(node).trim();
      if (t) found = t;
      return;
    }
    for (const k of kids) walk(k);
  }
  walk(doc);
  return found;
}

/**
 * The one-line preview of a page: `preview_lines[0]` when the summary has
 * one (ruling 7), else the first line of its content_json — pages written in
 * the editor keep no `lines` rows, so their preview_lines is empty. A line
 * that only repeats the title is no preview.
 *
 * @param {{ preview_lines?: string[], content_json?: string|object|null, what_matters_now?: string|null }} page
 * @returns {string}
 */
export function pagePreviewLine(page) {
  const title = String(page?.what_matters_now || "").trim();
  const fromLines = (page?.preview_lines || []).map((l) => String(l || "").trim()).find(Boolean) || "";
  const line = fromLines || firstDocLine(page?.content_json);
  if (!line || line === title) return "";
  return clip(line);
}

/**
 * @param {object} input
 * @param {any[]} input.pages  the pages the map shows (already filtered)
 * @param {any[]} input.pins   the pins the map shows (already filtered)
 * @param {any[]} input.lineages
 * @param {string|null} input.lineageId  the sidebar's selected trail (null = all trails)
 * @param {string} input.date
 * @returns {{
 *   entries: Array<{ page: any, lineageId: string|null, crumb: string|null, title: string, untitled: boolean, preview: string, pins: Array<{ pin: any, title: string }> }>,
 *   loosePins: Array<{ pin: any, title: string, lineageId: string|null, crumb: string|null }>,
 * }}
 */
export function trailMapDay({ pages = [], pins = [], lineages = [], lineageId = null, date }) {
  const pagesOnMap = new Set(pages.map((p) => p.id));
  const pinsByPage = new Map();
  for (const pin of pins) {
    if (!pin.source_page_id || !pagesOnMap.has(pin.source_page_id)) continue;
    if (!pinsByPage.has(pin.source_page_id)) pinsByPage.set(pin.source_page_id, []);
    pinsByPage.get(pin.source_page_id).push(pin);
  }
  const pinLine = (pin) => ({ pin, title: pinDisplayTitle(pin) || "untitled pin" });

  const crumbFor = (lid) => {
    if (!lid || lid === "__untrailed__") return "untrailed";
    // The sidebar already names the trail in view; its own pages need no
    // label. A child trail's pages keep theirs (leaf only, as the sidebar
    // gives the rest of the path).
    if (lineageId && lid === lineageId) return null;
    const path = relativeLineagePath(lineagePath(lid, lineages), lineageId, lineages);
    return path.map((l) => l.name).join(" › ") || null;
  };

  // Same trail order the map always used (trailGroupsForDate), so a day
  // reads busiest trail first.
  const groups = trailGroupsForDate({ pages, pins, lineages, date });
  const entries = [];
  const loosePins = [];
  for (const g of groups) {
    const lid = g.lineageId === "__untrailed__" ? null : g.lineageId;
    const crumb = crumbFor(g.lineageId);
    for (const page of g.pages) {
      const title = String(page.what_matters_now || "").trim();
      entries.push({
        page,
        lineageId: lid,
        crumb,
        title: title || "untitled",
        untitled: !title,
        preview: pagePreviewLine(page),
        pins: (pinsByPage.get(page.id) || []).map(pinLine),
      });
    }
    for (const pin of g.pins) {
      if (pin.source_page_id && pagesOnMap.has(pin.source_page_id)) continue;
      loosePins.push({ ...pinLine(pin), lineageId: lid, crumb });
    }
  }
  return { entries, loosePins };
}
