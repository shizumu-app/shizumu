// calendar-month.js — a month, as the grid a phone draws.
//
// The fourth device pass: "the filters does not show date picker similar
// to desktop, also in the today". Memory's filter sheet offered four
// presets and memory-model.js's own header recorded the calendar as
// "deliberately absent… §2 asks this task for a sheet, not for a date
// picker"; the page's day sheet listed the days that already had pages.
// Neither could answer "take me to the eleventh".
//
// ── STRINGS, NOT DATES ────────────────────────────────────────────────
//
// Every date in this module is a local `YYYY-MM-DD` string, and every
// step between two of them is arithmetic on the numbers in it. Nothing
// here constructs a `Date` from a timestamp or adds 86_400_000 to one:
// on the two days a year a timezone shifts, that addition lands on the
// same calendar day or skips one, and a calendar that skips a day is a
// day of somebody's writing they cannot reach. `getLocalDateStr` (utils)
// is the same rule at the other end — the app's clock read — and this
// file never calls it, so a caller decides what "today" is and a test
// can hand it one.
//
// `new Date(y, m, d)` IS used, with three numbers and no timezone in
// sight: that constructor is local-time by definition, and it is how the
// day-of-week for a local date is found. It is never used for
// arithmetic across days.

/** Sunday-first, one letter each, which is what fits seven columns on a
 *  360px phone. The desktop's calendar heads its columns the same way. */
export const WEEKDAYS = Object.freeze(["s", "m", "t", "w", "t", "f", "s"]);

const MONTHS = Object.freeze([
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
]);

function parse(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseMonth(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (m) {
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return { year: Number(m[1]), month };
  }
  const day = parse(value);
  return day ? { year: day.year, month: day.month } : null;
}

const pad = (n) => String(n).padStart(2, "0");
const dateStr = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

/** Days in a month, by the Gregorian rule. Written out rather than read
 *  off a rolled-over `Date`, because the rolled-over version is the one
 *  that needs a timezone to be right. */
function daysIn(year, month) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The month a date belongs to, as `YYYY-MM`. Null for anything that is
 *  not a date, which is what a caller with no selection hands in. */
export function monthOf(date) {
  const d = parse(date);
  return d ? `${d.year}-${pad(d.month)}` : null;
}

/**
 * The month `delta` months away. `shiftMonth("2026-01", -1)` is
 * `"2025-12"` — the wrap is the whole reason this is a function rather
 * than `month ± 1` at two call sites.
 *
 * @param {string} month  `YYYY-MM` (a `YYYY-MM-DD` is accepted and its day dropped)
 * @param {number} delta
 * @returns {string|null}
 */
export function shiftMonth(month, delta) {
  const m = parseMonth(month);
  if (!m || !Number.isInteger(delta)) return null;
  const zero = m.year * 12 + (m.month - 1) + delta;
  return `${Math.floor(zero / 12)}-${pad((zero % 12) + 1)}`;
}

/**
 * What the month is called over its grid: `september 2026`.
 *
 * Lowercase, because every label in this app is (the voice canon), and
 * the year is always there — a calendar that says `september` alone is
 * one a writer can page into last year without noticing.
 *
 * @param {string} month
 * @returns {string}
 */
export function monthLabel(month) {
  const m = parseMonth(month);
  return m ? `${MONTHS[m.month - 1]} ${m.year}` : "";
}

/**
 * The grid: whole weeks, Sunday first, covering the month and padded at
 * both ends with the neighbouring months' days.
 *
 * The padding days are REAL and carry their own date, rather than being
 * blanks: a writer who can see the 31st of last month in the first row
 * expects to be able to tap it, and a blank there is a hole in the one
 * control whose whole subject is which day. They are marked `inMonth:
 * false` so the screen can draw them back.
 *
 * WHAT `marked` MEANS IS THE CALLER'S: memory hands the days it has
 * pages for, the day sheet hands the same. The grid only says which of
 * its cells are in that set, and it accepts an array or a Set so neither
 * caller has to convert.
 *
 * @param {object} args
 * @param {string} args.month      `YYYY-MM`, or any date in it
 * @param {string} [args.today]    the caller's clock, as a date string
 * @param {Iterable<string>} [args.marked]  dates with writing on them
 * @param {string|null} [args.selected]     the day a filter names
 * @returns {Array<Array<{date: string, day: number, inMonth: boolean,
 *   marked: boolean, today: boolean, selected: boolean}>>} weeks of seven
 */
export function monthGrid({ month, today = "", marked = [], selected = null } = {}) {
  const m = parseMonth(month);
  if (!m) return [];
  const markedSet = marked instanceof Set ? marked : new Set(marked || []);
  const first = new Date(m.year, m.month - 1, 1).getDay();
  const count = daysIn(m.year, m.month);
  const prev = shiftMonth(`${m.year}-${pad(m.month)}`, -1);
  const next = shiftMonth(`${m.year}-${pad(m.month)}`, 1);
  const prevM = parseMonth(prev);
  const nextM = parseMonth(next);
  const prevCount = daysIn(prevM.year, prevM.month);

  const cells = [];
  for (let i = first; i > 0; i -= 1) {
    const day = prevCount - i + 1;
    cells.push({ year: prevM.year, month: prevM.month, day, inMonth: false });
  }
  for (let day = 1; day <= count; day += 1) {
    cells.push({ year: m.year, month: m.month, day, inMonth: true });
  }
  // Whole weeks, and never a trailing week of nothing but next month:
  // the grid stops at the last row that holds a day of THIS month.
  while (cells.length % 7 !== 0) {
    const day = cells.length - (first + count) + 1;
    cells.push({ year: nextM.year, month: nextM.month, day, inMonth: false });
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(
      cells.slice(i, i + 7).map((cell) => {
        const date = dateStr(cell.year, cell.month, cell.day);
        return {
          date,
          day: cell.day,
          inMonth: cell.inMonth,
          marked: markedSet.has(date),
          today: date === today,
          selected: !!selected && date === selected,
        };
      }),
    );
  }
  return weeks;
}
