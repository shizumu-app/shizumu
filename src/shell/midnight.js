// Whether the day changed UNDER the writer, and the sheet has to say so.
//
// This is the state P2f left unanswered: "midnight has no sheet — `+` and the
// date sheet are the shell's two exits from it today". Both of those are
// exits the writer has to already know about, and the thing that sends them
// looking is a page that has quietly stopped accepting keystrokes —
// page-writable.js's date arm turns yesterday's page read-only the moment the
// clock rolls over, with nothing on screen that changed. So the sheet is not
// a courtesy: it is the only notice the writing surface gives.
//
// It answers with a SHEET rather than with the slot's primary action, which
// is the one place §2 and §1 have to be read together. §2 lists midnight
// beside onboarding and lock as a chromeless state whose "bottom slot holds
// the primary action"; §1's sheet list has it as "midnight (non-dismissable
// variant)", and Sheet.test.js has carried the case since P1 ("it must be
// answered, not swiped away"). Two reasons the sheet is right and the slot is
// not. Midnight offers TWO choices of equal weight — start fresh, stay on
// yesterday — and a slot that holds "the primary action" holds one. And the
// page the question is about is yesterday's writing: a full-screen chromeless
// gate would cover the very thing "stay on yesterday" refers to, where a half
// sheet leaves it visible behind. Chromeless it still is — row 1 of
// toolbarFor takes the slot away from an open sheet — it just gets there
// through a row that already existed.
//
// ── `openedOn` IS THE WHOLE DIFFICULTY, AND IT WAS A REAL DEFECT ──
//
// The first version of this asked only "is the page older than today", and
// that is not the question. It is true of a page the writer DELIBERATELY
// opened from the date sheet or the reading view's `continue` — a legal act
// the whole shell is built around — so choosing to read last Tuesday
// summoned a non-dismissable sheet asking whether to start a new day. Caught
// by ShellApp's own suite, whose fixtures are pages from 1999: the date sheet
// opened and midnight immediately took its place.
//
// The question is about a CROSSING, not about an age: the page was today's
// when it came on screen, and today has since moved on. So `openedOn` — the
// device's day at the moment the page was adopted — is compared twice, and
// both comparisons are load-bearing. `pageDate === openedOn` says the page
// WAS writable when it arrived, which is the only case where the read-only
// flip is a surprise. `today > openedOn` is the crossing itself.
//
// DATES ARE COMPARED AS STRINGS, never parsed. They are YYYY-MM-DD from
// getLocalDateStr, which sorts lexicographically in date order, and parsing
// a bare YYYY-MM-DD lands on UTC midnight — page-model.js:36 records the hour
// that costs. Nothing here needs a Date at all.

/**
 * Is the midnight question due right now?
 *
 * @param {object} input
 * @param {string|null|undefined} input.pageDate  the date of the page on the
 *   writing surface, YYYY-MM-DD
 * @param {string|null|undefined} input.openedOn  the device's day when that
 *   page was put on screen, YYYY-MM-DD
 * @param {string} input.today  getLocalDateStr(), read from a live clock
 * @param {string|null} [input.answered]  the day the writer last answered
 *   this question, stamped by either row of the sheet
 * @param {string} [input.space]  which root is showing
 * @returns {boolean}
 */
export function midnightDue({ pageDate, openedOn, today, answered = null, space = "page" }) {
  // No page, no question. The shell paints before its first page load
  // resolves, and asking "a new day — start fresh?" about nothing is asking
  // the writer to choose between two pages that do not exist.
  if (!pageDate || !openedOn || !today) return false;

  // ONLY ON THE WRITING SURFACE. Memory and settings are read surfaces:
  // "start fresh" means nothing on a timeline, and a non-dismissable sheet
  // over a list the writer is scrolling is a wall in front of the one part
  // of the app that never needed today's date. The crossing is not lost —
  // `today` keeps moving and the question is asked when they come back.
  if (space !== "page") return false;

  // The page was today's when it arrived. Without this the sheet fires on
  // every deliberately-opened past page — see the header.
  if (pageDate !== openedOn) return false;

  // And the day has moved since. `>`, not `!==`: a device whose clock is
  // corrected BACKWARD (an NTP step, a timezone change westward) would
  // otherwise be told a new day had begun on the way into yesterday.
  if (!(today > openedOn)) return false;

  // Asked once per day, not once per poll. Without this the sheet would come
  // straight back the moment the writer chose "stay on yesterday" — the
  // condition that opened it is still true, and staying is precisely the
  // answer that does not change it.
  return answered !== today;
}
