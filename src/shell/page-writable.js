// Can the writer type into the page that is loaded?
//
// Until P2f Task 3 the shell never held a page other than today's, so this
// question had one arm — `page.is_open === false` — written twice, once in
// ShellApp (for `disabledIds`) and once in PageScreen (for EditorCore's
// `readonly`). ShellApp's own comment said what to do the day it grew a
// second arm: make it one derivation both files import, "because two
// copies of a two-armed rule is how they drift". This is that derivation.
//
// ── the arm the shell was missing, and what it was hiding ─────────────
//
// The desktop's rule is `page?.is_open !== false && (page?.date ===
// todayStr || currentTrailMode === "continuous")` (Page.svelte:175). The
// shell had only the first term. That was harmless for exactly as long as
// the shell could not open another day — and the date sheet is what ends
// it. Without the date arm, tapping "24 aug" would hand the writer a
// living cursor on a page from last week, and every keystroke would save
// into it. CLAUDE.md's constraint is not a preference: "past pages are
// read-only… write today on PAGE".
//
// `is_open` cannot stand in for it. Nothing in the backend flips that
// column at a day boundary — the only write of `is_open = 0` in the tree
// is migration 003's one-off backfill of pages whose "what shifted" was
// completed. A page from 1999 with `is_open = 1` is the ordinary state of
// old data, not an anomaly, so a shell that trusted `is_open` alone would
// call it writable.
//
// THE SHELL'S OWN SUITE WAS THAT PAGE. Every ShellApp and PageScreen
// fixture was dated in the past (`LONG_AGO = "1999-01-02"`, chosen so the
// header's date LABEL could not drift overnight), and every typing,
// pinning and inserting test drove a real editor on it. They passed
// because the shell asked a question that could not see the date. The
// fixtures now carry today's date, and the tests that are about a past
// label pass one explicitly — which is the honest split: a test about
// what the header SAYS names its date, and a test about what the writer
// can DO uses a page they are allowed to write on.
//
// ── the continuous arm is not an exception to the rule, it IS the rule ─
//
// A continuous trail's canonical page is one living document the writer
// keeps adding to, and its `date` is whatever day it was started. Judged
// by date alone it would be read-only on every day but its first, which
// would freeze the one surface the trail exception exists to keep open
// (CLAUDE.md's trail-exception clause). So mode outranks date, exactly as
// on the desktop.
//
// ── two deliberate falls-through to writable ──────────────────────────
//
// `page` null: the load has not landed. There is no page to refuse, and
// answering "read-only" for that frame would render the chrome dead and
// then alive again a tick later — a flicker on the most common path in
// the app, describing nothing.
//
// A row with no readable `date`: the date arm can only close on a date it
// can read, and a canvas that silently refuses writing is the worse of
// the two failures — the writer has no way to tell it from a broken app.
// `is_open` still guards, and no call in the tree produces a dateless row.

// ── the page the backend handed out as today is writable by identity ─
//
// Two clocks used to decide one fact. The backend dates the page it makes
// in `get_or_create_today` with chrono's local clock; the date arm judged
// that same page with the WebView's. On an SM-A065F in Africa/Casablanca
// with stale tz data the WebView said UTC+0 while Rust said UTC+1, so for
// an hour every night the page Rust had just made as today's was "an
// earlier day" here, and the writer could not type at all. ShellApp's
// clockDay asks the backend's clock first (`local_today`), but it falls
// back to the WebView's whenever that call cannot answer, so the second
// clock was narrowed, not removed.
//
// `todayPageId` removes it for the page that matters: the id of the row
// `get_or_create_today` last returned (lib/today-page.js, shared with the
// desktop tree). That page is today's because the
// backend said so, and no frontend clock is asked to agree. The identity
// expires only when the reference clock moves strictly PAST the page's own
// date — a real midnight, which midnight.js's sheet is built on — never
// when it is behind it, which is the disagreement this exists for. Every
// other row (a past day from the date sheet, a page from memory) is judged
// by the date arm exactly as before.

import { getLocalDateStr } from "../lib/utils.js";
import { handedOutAsToday } from "../lib/today-page.js";

/**
 * @param {object} [args]
 * @param {{ is_open?: boolean, date?: string } | null} [args.page]
 * @param {"discrete" | "continuous" | null} [args.trailMode]  the LINEAGE's
 *   mode, which is not a field on the page row (ShellApp looks it up).
 * @param {string} [args.todayDateStr]  YYYY-MM-DD, local. Injected under
 *   test for page-model.js's reason: a labeller or a gate that reads the
 *   clock internally produces a suite whose colour changes overnight.
 * @param {string | null} [args.todayPageId]  the id of the page the backend
 *   last handed out as today (`get_or_create_today`); writable by identity
 *   until the clock moves past its date. See the section above.
 * @returns {boolean} true when the canvas must refuse edits.
 */
export function pageReadonly({
  page = null,
  trailMode = null,
  todayDateStr = getLocalDateStr(),
  todayPageId = null,
} = {}) {
  if (!page) return false;
  if (page.is_open === false) return true;
  if (trailMode === "continuous") return false;
  const date = typeof page.date === "string" && page.date ? page.date : null;
  if (!date) return false;
  // The desktop's Page.svelte asks the same question of the same module.
  if (handedOutAsToday({ page, todayPageId, todayDateStr })) return false;
  return date !== todayDateStr;
}

// ── AND THE WRITER HAS TO BE TOLD ────────────────────────────────────
//
// `pageReadonly` answering true was, until now, the whole of it: the canvas
// stopped taking input and NOTHING on screen said why. Measured on an
// SM-A065F, the entire visible text of a page refusing every keystroke was
//
//     9 oct · find · pins · + · page · memory · settings
//
// A writer tapping into that page gets no caret, no keyboard and no
// sentence. This file's own header already names that as the worse of the
// two failures — "a canvas that silently refuses writing is the worse of
// the two, the writer has no way to tell it from a broken app" — and then
// the shell shipped exactly it.
//
// It is not only the clock-disagreement case that found this. Every
// LEGITIMATE read-only page is just as silent: open last Tuesday from the
// date sheet and the canvas goes quiet with no more explanation than a
// broken build would give.
//
// THE WORDS LIVE HERE, with the rule that produces them, because they are
// a decision and not a label — which reason is showing decides which
// sentence is true, and a component that worked that out inline would put
// it where no test can reach it (CLAUDE.md's first testing rule).
//
// The shape is ReadingScreen's, which met this problem first: the reason,
// then where writing does happen (`readingRows` in reading-view.js, "this
// page is done. today is on the page."). The sentences differ because the
// surfaces do — on the reading screen the page space is elsewhere, and on
// this one the writer is already in it, just on another day.

/**
 * Why the canvas is refusing, in the writer's own language.
 *
 * @param {object} [args]  the same four `pageReadonly` takes
 * @param {{ is_open?: boolean, date?: string } | null} [args.page]
 * @param {"discrete" | "continuous" | null} [args.trailMode]
 * @param {string} [args.todayDateStr]
 * @param {string | null} [args.todayPageId]
 * @returns {string | null}  null when the page takes writing, which is the
 *   ordinary case and renders nothing at all.
 */
export function readonlyNote({ page = null, trailMode = null, todayDateStr, todayPageId = null } = {}) {
  const readonly = pageReadonly({
    page,
    trailMode,
    todayPageId,
    // Forwarded only when given, so production keeps the real clock and a
    // test keeps its fixture. reading-view.js spells it the same way and
    // for the same reason.
    ...(todayDateStr ? { todayDateStr } : {}),
  });
  if (!readonly) return null;

  // CLOSED OUTRANKS OLD, because it is the more specific fact and because
  // it is the one `pageReadonly` checks first. A page can be both — a
  // closed page from last week — and "done" is what the writer did to it,
  // while the date is only when.
  if (page?.is_open === false) return "this page is done. write on today's page.";
  return "this is an earlier day. write on today's page.";
}
