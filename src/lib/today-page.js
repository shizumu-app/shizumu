// Is this the page the backend handed out as today?
//
// The backend dates the page `get_or_create_today` makes with its own clock
// (chrono::Local in commands.rs). Both trees used to judge that same page
// with the WebView's clock — `page.date === todayStr` on the desktop
// (Page.svelte's isWritable), `date !== todayDateStr` in the shell
// (page-writable.js). On a phone whose tz database is stale the two
// disagree: an SM-A065F in Africa/Casablanca thought UTC+0 while Rust
// thought UTC+1, so for an hour every night the page Rust had just made as
// today's was a past page to the frontend and the writer could not type.
//
// The answer here asks no clock about whether the page is today's: the
// backend already said so, and the caller remembers which row it said it
// of (`todayPageId`). The one clock comparison left is the EXPIRY, and it
// is one-sided on purpose: the identity holds until the reference day
// moves strictly PAST the page's own date. A clock behind the page's date
// is the disagreement this exists for; a clock past it is a real midnight,
// which both trees' midnight flows are built on (the page that was today's
// becomes yesterday's, read-only, and the writer is asked what to do).
//
// Dates are compared as YYYY-MM-DD strings, which sort in date order.

/**
 * @param {object} [args]
 * @param {{ id?: string, date?: string } | null} [args.page]
 * @param {string | null} [args.todayPageId]  the id of the row
 *   get_or_create_today last returned, or null before it has.
 * @param {string} [args.todayDateStr]  the frontend's day, YYYY-MM-DD
 * @returns {boolean}
 */
export function handedOutAsToday({ page = null, todayPageId = null, todayDateStr } = {}) {
  if (!page || todayPageId == null || page.id !== todayPageId) return false;
  const date = typeof page.date === "string" && page.date ? page.date : null;
  if (!date) return false;
  // No reference day means nothing can say midnight has passed.
  if (typeof todayDateStr !== "string" || !todayDateStr) return true;
  return !(todayDateStr > date);
}
