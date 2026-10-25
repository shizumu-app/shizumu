// provenance.js — the shell's date words, and the one line under a title
// that says where a pin or a page came from and when.
//
// ── WHY THE SHELL HAS ITS OWN DATE WORDS ──────────────────────────────
//
// The desktop's PinArtifactModal pairs every provenance fact with a date
// (`created today`, `edited 3 days ago` as a weekday, `cached on 24 aug`),
// and its formatter — `formatRelativeDate` — is a private function inside
// SharedObjectsPanel.svelte, a desktop component the shell may not import
// (shell-rules.test.js). Until this module the shell's pin view dropped
// every date rather than duplicate that function, and said `source
// removed` with no `cached on` after it. That was the honest trade while
// the shell had no date labeller of its own beyond `dayLabel`'s three
// answers; this module is the labeller, so the trade is over.
//
// It EXTENDS `dayLabel` (page-model.js) rather than standing beside it.
// `dayLabel` already answers `today`, `yesterday` and `d mon` — the three
// the page header, the date sheet and memory's headings need — and it
// carries the scar this whole file is careful about: the day is compared
// as a `YYYY-MM-DD` STRING against injected reference strings, never by
// millisecond arithmetic against a parsed Date. PageNav.svelte's comment
// records what the arithmetic shipped as ("22 apr" while the user was on
// today). This module adds the two answers the desktop's provenance has
// and `dayLabel` does not — a weekday for the last six days, and the year
// on anything older than this one — and gets its `d mon` from `dayLabel`
// itself, so the month names live in one place.
//
// ── A TIMESTAMP IS NOT A DAY ──────────────────────────────────────────
//
// `created_at` and `updated_at` are ISO timestamps (models.rs: `String`
// columns, written by chrono::Utc::now().to_rfc3339() in commands.rs), so
// the first step is always to reduce one to the writer's LOCAL calendar
// day — `formatLocalDate` from src/lib/utils.js, the same helper
// `getLocalDateStr` is built on — and only then to compare. Slicing the
// first ten characters of the string would read the UTC day, which is
// wrong by one on every evening east of Greenwich and every morning west
// of it. A page's `date`, by contrast, IS already a local day (commands.rs
// writes it with chrono::Local), and `shellDay` takes it as one.
//
// ── THE SIX-DAY WINDOW, STEPPED NOT SUBTRACTED ────────────────────────
//
// The weekday answer is for a day within the last six — close enough that
// "tuesday" places it better than "13 jan" does. The window is walked one
// day at a time with memory-model.js's `yesterdayOf`, which is
// noon-anchored, rather than by subtracting n × 86 400 000 ms from a
// midnight: a day that crosses a DST boundary is 23 or 25 hours long, and
// the subtraction lands an hour into the wrong calendar day. The test
// file's DST case is the proof, and it only bites in a timezone that has
// one — say so when reading it in UTC.
//
// The window looks BACKWARDS only. A timestamp after today — a device
// whose clock was set forward, a synced row from a peer an hour ahead at
// midnight — is not "next tuesday"; it falls through to `d mon`, which is
// at least true.

import { formatLocalDate } from "../lib/utils.js";
import { dayLabel } from "./page-model.js";
import { yesterdayOf } from "./memory-model.js";

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

/** How many days back the weekday answer reaches, counting from the day
 *  before yesterday. Six days back in all: yesterday is its own word, and
 *  seven back is the same weekday as today, which would read as today. */
const WEEKDAY_STEPS = 5;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Noon, for `page-model.js`'s reason: only the weekday is read out of
 *  this Date, and a bare date parsed at local midnight sits an hour on the
 *  wrong side of a DST boundary. */
function weekdayOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAYS[d.getDay()];
}

/**
 * A local calendar day, reduced from an ISO timestamp — or `""` when the
 * timestamp is missing or will not parse, which the callers treat as "say
 * nothing" rather than as a day.
 *
 * A bare `YYYY-MM-DD` is returned as it is: it is already a local day, and
 * handing it to `Date` would parse it as UTC midnight and shift it west of
 * Greenwich.
 *
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function localDayOf(iso) {
  if (typeof iso !== "string" || !iso) return "";
  if (DATE_RE.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatLocalDate(d);
}

/**
 * What one local day is called, on a provenance line.
 *
 * `today` · `yesterday` · a weekday for the five days before that ·
 * `d mon` in this year · `d mon yyyy` in any other. The first three
 * compare strings; the year is read off the string too.
 *
 * Both reference dates are REQUIRED here rather than defaulted, and that
 * is deliberate where `dayLabel` defaults them: memory-model.js's
 * `yesterdayOf` records the day a caller passed one and got a `yesterday`
 * off the machine's clock that was not adjacent to its own today. The
 * hosts pass `getLocalDateStr()` and `yesterdayOf` of it, one clock read.
 *
 * @param {string} dateStr  YYYY-MM-DD, local
 * @param {{ todayDateStr: string, yesterdayDateStr: string }} refs
 * @returns {string}
 */
export function shellDay(dateStr, { todayDateStr, yesterdayDateStr }) {
  if (typeof dateStr !== "string" || !DATE_RE.test(dateStr)) return "";
  if (dateStr === todayDateStr) return "today";
  if (dateStr === yesterdayDateStr) return "yesterday";

  let cursor = yesterdayDateStr;
  for (let i = 0; i < WEEKDAY_STEPS; i += 1) {
    cursor = yesterdayOf(cursor);
    if (dateStr === cursor) return weekdayOf(dateStr);
  }

  const label = dayLabel(dateStr, { todayDateStr, yesterdayDateStr });
  const year = dateStr.slice(0, 4);
  return year === todayDateStr.slice(0, 4) ? label : `${label} ${year}`;
}

/**
 * `shellDay` of an ISO timestamp's local day. `""` when there is no day
 * to name — the callers drop the segment rather than print `kept ` with
 * nothing after it.
 *
 * @param {string|null|undefined} iso
 * @param {{ todayDateStr: string, yesterdayDateStr: string }} refs
 * @returns {string}
 */
export function shellDate(iso, refs) {
  const day = localDayOf(iso);
  return day ? shellDay(day, refs) : "";
}

const SEP = " · ";

function trailWord(trailName) {
  const name = typeof trailName === "string" ? trailName.trim() : "";
  // `not on a trail`, not `untrailed`. The desktop says untrailed and this
  // file used to match it for that reason alone; `untrailed` is a schema
  // word, and the canon's voice is the fewest PLAIN words that say the
  // fact. The two trees disagree on this one string on purpose, and the
  // line still names the trail rather than falling silent, which is what
  // the fallback was protecting.
  return name || "not on a trail";
}

/** `<verb> <date>` for a day, or nothing when there is no day to name. */
function dated(verb, day, refs) {
  const label = day ? shellDay(day, refs) : "";
  return label ? `${verb} ${label}` : "";
}

/**
 * The line under a pin's title.
 *
 *   live:      `from <trail> · kept <created> · edited <updated>`
 *   orphaned:  `source removed · cached on <updated> · kept <created>`
 *   diverged:  the live line, then ` · changed elsewhere`
 *
 * `edited` is left out when it names the same day as `kept`: a pin kept
 * and edited on one day would read `kept today · edited today`, which is
 * one fact said twice — and the common case, since most pins are never
 * edited at all and carry `updated_at` equal to `created_at`. On an
 * orphan the cached-on date IS the updated date, so it is not repeated
 * as `edited` either; `kept` follows because when it was kept is the one
 * date the removal did not change.
 *
 * `from` falls back to `untrailed` rather than to silence. The desktop
 * says `untrailed` here (SharedObjectsPanel's `sourcePageLabel`), and a
 * provenance line that skipped the trail on an untrailed pin would read
 * as a lookup that failed rather than as a pin with no trail.
 *
 * Divergence is withheld from an orphan — pin-artifact-view.js's own
 * call, kept: "source removed" and "changed elsewhere" are two claims
 * about one page and only one can be true.
 *
 * `kept`, not `created`, and lowercase throughout: the verb is the
 * canon's (write · pin · trail; what you pin is kept).
 *
 * @param {any} pin
 * @param {{ trailName?: string|null, todayDateStr: string, yesterdayDateStr: string }} input
 * @returns {string}
 */
export function pinProvenance(pin, { trailName = null, todayDateStr, yesterdayDateStr }) {
  if (!pin) return "";
  const refs = { todayDateStr, yesterdayDateStr };
  const kept = localDayOf(pin.created_at);
  const edited = localDayOf(pin.updated_at);
  const orphaned = pin.status === "orphaned";

  const parts = [];
  if (orphaned) {
    parts.push("source removed");
    parts.push(dated("cached on", edited, refs));
    parts.push(dated("kept", kept, refs));
  } else {
    parts.push(`from ${trailWord(trailName)}`);
    parts.push(dated("kept", kept, refs));
    if (edited && edited !== kept) parts.push(dated("edited", edited, refs));
    if (pin.diverged) parts.push("changed elsewhere");
  }
  return parts.filter(Boolean).join(SEP);
}

/**
 * The line under a page's title on the reading view:
 * `<trail> · written <date> · edited <date>`, the pin line's rules.
 *
 * `written` is the page's own `date` — the day the page is FOR, which is
 * what memory listed it under and what the bar above already calls it —
 * not `created_at`. On a discrete trail the two agree; on a continuous
 * trail the canonical doc's `date` is the day it was begun and its
 * `updated_at` moves every day it is written on, and `written <begun> ·
 * edited <today>` is exactly the shape that says so.
 *
 * @param {any} page
 * @param {{ trailName?: string|null, todayDateStr: string, yesterdayDateStr: string }} input
 * @returns {string}
 */
export function readingProvenance(page, { trailName = null, todayDateStr, yesterdayDateStr }) {
  if (!page) return "";
  const refs = { todayDateStr, yesterdayDateStr };
  const written = localDayOf(page.date);
  const edited = localDayOf(page.updated_at);

  const parts = [trailWord(trailName), dated("written", written, refs)];
  if (edited && edited !== written) parts.push(dated("edited", edited, refs));
  return parts.filter(Boolean).join(SEP);
}
