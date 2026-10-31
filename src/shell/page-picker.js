// Which page is the writer looking at — the two halves of that question.
//
// The header's `today ▾` asks WHICH DAY; the dots beside it ask WHICH PAGE
// OF IT. They are one question asked twice, so their rows are decided in
// one module: the day sheet hands a day to the page sheet, and the page
// sheet hands a row to the canvas. Splitting them would let the two
// disagree about what "the page you are on" means, which is the only
// property either of them has to get right.
//
// ── the day rows ──────────────────────────────────────────────────────
//
// TODAY IS ALWAYS THE FIRST ROW, even on a morning with nothing written
// on it. It is the one day the writer can still write on (page-writable.js),
// and a picker that could only offer days that already have writing would
// be a one-way trip into the past — reachable, and then stuck. It is also
// the shell's whole answer to midnight: an app left open across the
// boundary is holding yesterday's page, and this row is how the writer
// gets to the day they are actually in.
//
// EVERY OTHER ROW IS A DAY THAT ALREADY HAS WRITING. `getThread` applies
// `is_page_relevant` (commands.rs), so the rows are days with something on
// them rather than every date the table happens to hold. The alternative —
// a calendar grid — would offer to open a page on an arbitrary empty date,
// which is offering to open a page that does not exist and then either
// conjure one (writing into the past, which the read-only rule forbids) or
// refuse (a grid of dead cells).
//
// THE FIRST DAY GETS A SENTENCE UNDER IT. On a fresh install the sheet is
// today and nothing else, and one row over a blank half-screen read as
// broken on a real phone — the writer tapped `today ▾` and got a list of
// one. The calendar grid stays refused (above); what the sheet owes
// instead is to say where the other days go, so the blank is a place
// rather than a fault. `daySheetNote` decides when that sentence shows
// and it is the only thing that does: once any other day has writing the
// rows say it themselves, and a sentence under a list of days would
// explain what the list already makes plain. Rendering it is the settings
// screen's note shape (`SHELL_OFF_NOTE`, settings-model.js): a paragraph,
// not a `Row` — a row promises a control or a value at its end and the
// tap-height floor that goes with one, and this is a sentence about the
// row above it.
//
// ONE ROW PER DAY, not one per page. A day with four pages is one row here
// and four rows in `pageRows` below; that is the split the header's two
// affordances already draw, and collapsing it would make the day sheet a
// flat list of every page ever written, which is memory's job (spec §2).
//
// The row carries the day's FIRST page — lowest `page_number` — because
// that is where the day starts, and `pageRows` takes over from there.
//
// A DATE AFTER TODAY IS DROPPED. `getThread` can return one: a device
// whose clock ran ahead writes a page dated tomorrow and syncs it back.
// Rendering it as a day the writer wrote on is a lie the sheet has no way
// to qualify, and picking it would open a page that page-writable.js calls
// read-only anyway (it is not today), so the row could only ever disappoint.
//
// ── the page rows ─────────────────────────────────────────────────────
//
// LABELLED BY ORDINAL, NOT BY `page_number`, and this is a scar rather
// than a preference: page-ordinal.js records that the column is minted per
// device and renumbered on merge, so the same page is "1" on the phone and
// "4" on the desktop. `withOrdinals` numbers by position in the list the
// backend returns, which is the only label that agrees across devices.
//
// ADDRESSED BY ID. page-address.js records the other half of the same
// scar: `getPage(date, page_number)` is a pointer that resolves to a
// different page on each device, and it once opened somebody else's page
// entirely. Every row here carries the whole summary row so the caller can
// hand it to `pageAddress`.
//
// THE NOTE BESIDE A ROW IS THE PAGE'S OWN "what matters now". It is the
// only thing distinguishing four pages of one day from each other, and it
// is the writer's own words rather than a preview the sheet composed. It
// is truncated because `Row`'s value has no ellipsis of its own and a long
// focus line would push the label off a phone's width; the "…" is honest
// here in a way it was not for a pin's stored title (pin-intent.js), which
// search has to match — nothing searches this string.

import { flattenDocText } from "../lib/snippet.js";
import { dayLabel } from "./page-model.js";
import { withOrdinals } from "../lib/page-ordinal.js";
import { getLocalDateStr, getYesterdayStr } from "../lib/utils.js";

/** How many days the sheet offers. The sheet is a shortcut off the
 *  writing surface, not the archive — memory is the archive (spec §2) —
 *  and a half-detent sheet shows about seven rows, so two screens of
 *  scrolling is the point where "a way back to last week" has become
 *  "browsing", which is a different surface. */
export const DAY_ROW_LIMIT = 14;

/** Characters of a page's focus line before it is cut. */
const NOTE_MAX = 32;

/** The word beside the row the writer is already looking at. Lowercase,
 *  one word, neutral chrome — it names a state, not an action, which is
 *  why the row that carries it offers no action either. */
const SHOWING = "showing";

/** What the sheet says under a lone today. Says what happens, not what
 *  is missing (CLAUDE.md, brand voice: "say what the page does, never
 *  what it lacks") — a day appears here by being written on, and that is
 *  the whole rule `dayRows` applies. Present tense, no promise about
 *  later. */
export const DAY_SHEET_NOTE = "days you write on appear here.";

/**
 * The sentence under the day rows, or null when the rows speak for
 * themselves. Takes `dayRows`' output rather than its input so the two
 * cannot disagree about which days are listed.
 *
 * @param {Array<{ date: string }>} rows  what `dayRows` returned
 * @returns {string|null}
 */
export function daySheetNote(rows) {
  // Today is always the first row, so a list of one IS a list of today
  // alone — no other day has writing yet. Two or more, and at least one
  // of them is a day that got there by being written on (or the day the
  // writer is on, which is the same fact seen from the page).
  return Array.isArray(rows) && rows.length <= 1 ? DAY_SHEET_NOTE : null;
}

/**
 * @param {object} [args]
 * @param {Array<object>} [args.summaries]  `getThread(...)` rows
 * @param {string|null} [args.currentDate]  the date of the loaded page
 * @param {string} [args.todayDateStr]
 * @param {string} [args.yesterdayDateStr]
 * @param {number} [args.limit]
 * @returns {Array<{ date: string, label: string, value: string, showing: boolean, page: object|null }>}
 */
export function dayRows({
  summaries = [],
  currentDate = null,
  todayDateStr = getLocalDateStr(),
  yesterdayDateStr = getYesterdayStr(),
  limit = DAY_ROW_LIMIT,
} = {}) {
  /** @type {Map<string, object|null>} date → the day's first page row */
  const firstPageByDate = new Map();

  // Today, unconditionally and with no row of its own: the caller opens it
  // through getOrCreateToday(), which is the only call that will make one
  // if the day has none yet.
  firstPageByDate.set(todayDateStr, null);

  // The day the writer is on, if it is not today and the thread did not
  // return it. Without this the sheet would silently omit the very page it
  // was opened from — which happens for real, because getThread's
  // relevance filter drops a page with nothing on it yet.
  if (currentDate && currentDate !== todayDateStr && currentDate <= todayDateStr) {
    firstPageByDate.set(currentDate, null);
  }

  for (const row of Array.isArray(summaries) ? summaries : []) {
    const date = typeof row?.date === "string" && row.date ? row.date : null;
    if (!date) continue;
    // String comparison, not Date arithmetic: both sides are YYYY-MM-DD in
    // LOCAL time (commands.rs writes with chrono::Local), and parsing them
    // into instants is how page-model.js's scar started.
    if (date > todayDateStr) continue;
    if (date === todayDateStr) continue;
    const held = firstPageByDate.get(date);
    if (held === undefined || held === null || lowerNumbered(row, held)) {
      firstPageByDate.set(date, row);
    }
  }

  return [...firstPageByDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .slice(0, Math.max(1, limit))
    .map(([date, page]) => ({
      date,
      label: dayLabel(date, { todayDateStr, yesterdayDateStr }),
      value: date === currentDate ? SHOWING : "",
      showing: date === currentDate,
      page,
    }));
}

/**
 * A living document's days: its day markers, newest first, one row a day,
 * each carrying that day's focus. A continuous trail is one page, so its
 * `today ▾` has no other day to open; its days live inside it, and the
 * phone had no way to list them (the desktop has mod+K) — sync journey
 * J5.4, 2026-10-24. The first marker for a date wins, in document order.
 *
 * @param {object} args
 * @param {Array<{ date: string, whatMatters?: string }>} args.markers  EditorCore getDayMarkers()
 * @param {string} [args.todayDateStr]
 * @param {string} [args.yesterdayDateStr]
 * @returns {Array<{ date: string, label: string, value: string }>}
 */
export function markerRows({ markers = [], todayDateStr = getLocalDateStr(), yesterdayDateStr = getYesterdayStr() } = {}) {
  const byDate = new Map();
  for (const m of Array.isArray(markers) ? markers : []) {
    if (typeof m?.date === "string" && m.date && !byDate.has(m.date)) byDate.set(m.date, m.whatMatters || "");
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, focus]) => ({ date, label: dayLabel(date, { todayDateStr, yesterdayDateStr }), value: focus }));
}

function lowerNumbered(candidate, held) {
  const a = Number.isInteger(candidate?.page_number) ? candidate.page_number : Infinity;
  const b = Number.isInteger(held?.page_number) ? held.page_number : Infinity;
  return a < b;
}

/**
 * @param {object} [args]
 * @param {Array<object>} [args.summaries]  `getFocusesForDate(date)` rows,
 *   in the order the backend returned them — the ordinal is the position.
 * @param {string|null} [args.currentPageId]
 * @returns {Array<{ id: string, label: string, value: string, showing: boolean, page: object }>}
 */
export function pageRows({ summaries = [], currentPageId = null } = {}) {
  const rows = Array.isArray(summaries) ? summaries.filter((r) => r && r.id) : [];
  return withOrdinals(rows).map((row) => {
    const showing = row.id === currentPageId;
    return {
      id: row.id,
      kind: "page",
      label: `page ${row.ordinal}`,
      value: showing ? SHOWING : note(row.what_matters_now) || note(firstWords(row.content_json)),
      showing,
      page: row,
    };
  });
}

/**
 * The sheet's rows: the page list, and the one thing that can remove from it.
 *
 * A PAGE COULD NOT BE REMOVED ON THE PHONE AT ALL. `delete_focus` has been in
 * the backend all along — it clears the page's blocks, block items and
 * session markers with it — and the desktop wires it through FocusRail's
 * `handleRailDelete`. The shell's sheet only ever opened pages. Both halves of
 * the vocabulary were already here too: the block sheet established the
 * destructive kind, and the trail sheet established a list with an action row
 * under it. This is the two put together.
 *
 * IT ACTS ON THE PAGE THAT IS SHOWING, which is the case the desktop handles
 * and the only one with an obvious answer to "and then what". Deleting some
 * other page from the list leaves the writer where they are and is a
 * different interaction with a different confirmation; it is not offered.
 *
 * THE LABEL NAMES THE PAGE, so the row says which page it will take rather
 * than "delete this page" — and naming it is also the shortest honest label,
 * which is what the voice asks for. It used to be the whole safeguard, at one
 * tap on writing that does not come back. Since 2026-10-31 (Vercel's
 * interface guidelines: a destructive act needs a confirmation or an undo)
 * the first tap ARMS the row, which then reads "tap again to delete page 7",
 * and only a second tap on that page deletes it — the desktop rail's
 * two-step (FocusRail confirmDeleteId). The caller holds `armedDeleteId`. The ordinal is the one the
 * SHEET shows (page-ordinal.js): a row reading "delete page 7" over a list
 * labelled 1..3 would be naming a page the writer cannot see.
 *
 * LAST, for pin-artifact-view.js's reason about `unpin`: the row that removes
 * something is not the row a thumb lands on by accident.
 *
 * THE ONE-PAGE CASE IS A PROPERTY, NOT A SCREEN. The row is offered whenever a
 * page is showing, including a day with only one — but a day with one page has
 * no dots in the header, and the dots are the only thing that opens this
 * sheet. So the writer cannot reach it there. That is the header's rule and a
 * fair one (the sheet exists to choose BETWEEN pages); it is recorded here
 * because a reader of this function would otherwise expect to find the row on
 * screen and not find it.
 *
 * @param {object} [args]  as `pageRows`, plus `armedDeleteId`: the page whose
 *   delete row was tapped once
 * @returns {Array<object>}  `pageRows` plus at most one `kind: "delete"` row
 */
export function pageSheetRows({ summaries = [], currentPageId = null, armedDeleteId = null } = {}) {
  const rows = pageRows({ summaries, currentPageId });
  const showing = rows.find((r) => r.showing);
  // No page open, no row: it acts on the one being looked at, and a sheet
  // opened from nowhere has none to name.
  if (!showing) return rows;
  return [
    ...rows,
    {
      id: `delete:${showing.id}`,
      kind: "delete",
      armed: armedDeleteId === showing.id,
      label: armedDeleteId === showing.id ? `tap again to delete ${showing.label}` : `delete ${showing.label}`,
      value: "",
      destructive: true,
      pageId: showing.id,
      page: showing.page,
    },
  ];
}

/** The page's own opening words, for a row with no focus line on it.
 *
 *  THE REPORT, from a phone: the pages sheet "rows are not clean and
 *  informative, we see only page 1 2 the count". The value slot was always
 *  meant to carry "what matters now" — the header above calls it the only
 *  thing distinguishing four pages of one day — and a writer who never names
 *  one got four identical rows.
 *
 *  STILL THE WRITER'S OWN WORDS, which is the property that made the focus
 *  line the right answer in the first place. A timestamp or a word count
 *  would be something this sheet composed about the page; its first line is
 *  something the writer will recognise. (`pin_count` is not an option even if
 *  it were wanted: get_focuses_for_date hardcodes it to 0.)
 *
 *  `keepPinned`, because on a page row a pinned block is the most
 *  recognisable thing there is — see flattenDocText for why search wants the
 *  opposite.
 *
 *  Malformed or absent JSON answers "", and the row simply says nothing.
 */
function firstWords(contentJson) {
  if (typeof contentJson !== "string" || !contentJson.trim()) return "";
  try {
    return flattenDocText(JSON.parse(contentJson), { keepPinned: true });
  } catch {
    return "";
  }
}

/** One line, one space between words, cut to fit a row. */
function note(value) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (text.length <= NOTE_MAX) return text;
  return `${text.slice(0, NOTE_MAX).trimEnd()}…`;
}
