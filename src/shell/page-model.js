// What the page header says about the page that is actually loaded.
//
// For all of P2a the header read "today" on every date, because the shell
// rendered with no props at all and `dateLabel` fell back to a static
// string. It looked like data and was a placeholder — the failure mode
// where a label is right by coincidence on the one day anybody checks it.
// This module is the seam that makes the header answerable: give it the
// loaded row, get back the four things the two-line bar shows.
//
// On the two reference dates being PARAMETERS. A labeller that reads the
// system clock internally produces tests whose colour changes overnight:
// "2026-08-24 is not yesterday" is true today and false tomorrow, and the
// suite goes red on a morning nobody touched the code. So both dates are
// injected under test and defaulted in production, where no caller has to
// care.
//
// On timezone, which is the part with a scar. The backend writes the date
// with chrono::Local::now() (commands.rs:61) — Local, not Utc. A label
// computed by millisecond arithmetic against a parsed Date drifts by a day
// in non-UTC timezones, and PageNav.svelte's comment records the symptom it
// shipped as: "22 apr" while the user was on today. The remedy it settled
// on is comparing date STRINGS against getLocalDateStr() / getYesterdayStr(),
// and those two are shared exports of src/lib/utils.js — so importing them
// carries the fix rather than forking it. Only the month names below are
// genuinely duplicated; five private labellers in three formats
// ("24 aug" vs "aug 24") are consolidated in P5, where the desktop phone
// branches are deleted anyway and src/components/ is legal to edit.

import { getLocalDateStr, getYesterdayStr } from "../lib/utils.js";

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

// Noon, not midnight. Only the day and month are read out of this Date, and
// parsing a bare YYYY-MM-DD at local midnight puts the instant one hour on
// the wrong side of a DST boundary in the timezones that have one — which
// prints the previous day. Noon has an hour of slack in both directions.
function monthDayLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** What one date is called, on its own.
 *
 *  Extracted from `pageHeaderModel` below when the date sheet arrived
 *  (P2f Task 3): the sheet's rows are the same three answers the header
 *  gives — "today", "yesterday", "24 aug" — and a second labeller would
 *  be a second place for the DST and timezone reasoning above to be got
 *  wrong. Both reference dates stay injected for the reason recorded at
 *  the top of this file.
 *
 * @param {string} dateStr  YYYY-MM-DD, local
 * @param {{ todayDateStr?: string, yesterdayDateStr?: string }} [refs]
 * @returns {string}
 */
export function dayLabel(
  dateStr,
  { todayDateStr = getLocalDateStr(), yesterdayDateStr = getYesterdayStr() } = {},
) {
  if (dateStr === todayDateStr) return "today";
  if (dateStr === yesterdayDateStr) return "yesterday";
  return monthDayLabel(dateStr);
}

/**
 * @param {object} [input]
 * @param {{ date?: string, page_number?: number } | null} [input.page]
 *   the row from `getOrCreateToday().page`, or null before the load resolves
 * @param {string} [input.todayDateStr]      YYYY-MM-DD, local
 * @param {string} [input.yesterdayDateStr]  YYYY-MM-DD, local
 * @param {string | null} [input.lineageName]
 * @param {number | null} [input.pageCount]  pages on this date
 * @param {number | null} [input.pageOrdinal]
 *   this page's POSITION among that day's pages, 1-based — `ordinalOf` in
 *   page-ordinal.js. Never `page_number`; see the note at the return.
 * @returns {{ dateLabel: string, trailName: string | null, pageCount: number, pageNumber: number }}
 */
export function pageHeaderModel({
  page = null,
  todayDateStr = getLocalDateStr(),
  yesterdayDateStr = getYesterdayStr(),
  lineageName = null,
  pageCount = null,
  pageOrdinal = null,
} = {}) {
  // No page yet means the load has not landed, and the honest thing for the
  // header to say in that frame is the same thing it will say a moment
  // later on the overwhelmingly common path: today.
  const dateStr = page?.date ?? todayDateStr;

  const dateLabel = dayLabel(dateStr, { todayDateStr, yesterdayDateStr });

  // The day the header is describing always contains at least the page the
  // header is on, so a count below 1 is a load that has not resolved rather
  // than a real answer. "page 1 of 0" is the shape of a placeholder leaking
  // into the bar, which is the defect this whole module exists to end.
  const count = typeof pageCount === "number" && pageCount >= 1 ? pageCount : 1;

  // A POSITION, NOT page_number — and the header draws its dots as positions,
  // which is why the two must be the same kind of number. `page_number` is
  // minted per device as MAX+1 and is never reused, so one delete leaves the
  // day numbered 1..19, 21, 22 with twenty-one pages in it. The dot row then
  // draws twenty-one dots and lights `n === page_number`: nothing matches for
  // the pages past the gap, and the ones before it light a dot belonging to
  // another page. Measured on the A16 after the pages sheet learned to
  // delete — twenty-one dots, none lit.
  //
  // page-ordinal.js has said "not page_number" since the cross-device scar
  // that produced it, and page-picker.js already numbers the sheet's rows
  // that way. This is the other half of the same header agreeing with it.
  const ordinal =
    typeof pageOrdinal === "number" && pageOrdinal >= 1 ? pageOrdinal : 1;

  return {
    dateLabel,
    trailName: lineageName ?? null,
    pageCount: count,
    pageNumber: ordinal,
  };
}
