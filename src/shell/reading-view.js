// What the reading view says about the page it is showing, and what it
// offers to do with it.
//
// §2: "Tapping a page pushes a reading view; 'continue' lives there."
//
// ── WHAT "CONTINUE" TURNED OUT TO MEAN, read off the desktop ──────────
//
// The plan's own instruction was to find out rather than infer it from the
// word, and the word has two candidates in this tree. Only one of them is
// wired:
//
//   ThreadPageView.svelte:126 — `open in editor →`, which calls
//     `onContinue`. Memory.svelte:819 turns that into
//     `onContinueFocus(vp)`; App.svelte:249 sets `continueFocus` and
//     `space = "page"`; Page.svelte:1146 loads that page onto the writing
//     canvas (routing a continuous trail's row through
//     getCanonicalTrailPage so it opens at the clicked day rather than
//     snapping to today).
//
//   DaySummaryPopover.svelte:71 — a row reading `continue from here`.
//     Nothing in the tree renders that component: grep finds it named
//     only in its own header and in one comment in memory-filters.js. It
//     is a third orphan beside the two the spec borrowed for the timeline
//     (`memory/DayBlock.svelte`, `memory/TimelineSpine.svelte`), so its
//     wording is not evidence of anything that ships.
//
// So continue is a NAVIGATION, not an unlock. It ends the reading and
// hands this page to the writing surface. It does not make a page
// writable and never did: the desktop's `isWritable` (Page.svelte:175) —
// which is `pageReadonly` here — decides that on the canvas, after the
// navigation, exactly as it would have before it.
//
// The second, weaker sense of the word is ThreadPageView's collision bar:
// a past UNTRAILED page offers `this continues — trail it`, which creates
// a continuous lineage and repoints the page's lineage_id at it
// (continue-the-thread, N1). That is a real feature and it is deliberately
// NOT here — it needs a naming field, it creates a lineage, and §2 asks
// this screen for a reading view rather than for a trail adoption.
// Named so the gap reads as a boundary, the way PinsScreen names the pin
// scope menu it does not carry.
//
// ── WHY A READ-ONLY PAGE IS NOT OFFERED `continue` ───────────────────
//
// The desktop offers it unconditionally, and it can afford to: its
// collision bar explains the dead cursor the moment the reader presses a
// letter key ("this page is done. today is on the page."). The shell has
// no such bar, and a pushed screen has no tab bar behind it (§2 gives the
// bottom slot to nothing there), so a writer who taps `continue` on a page
// from March would land on a canvas that refuses every keystroke with
// nothing on screen saying why and no one-tap way back to now.
//
// That is the shape this shell already refuses elsewhere in as many words:
// "a dead `+` says why; an empty sheet says nothing" (ShellApp, the insert
// sheet's gate). So the fork is here instead, and both arms end on the
// page root: a writable page continues as itself, and a read-only one
// offers the day the writer can actually write on. The sentence that
// replaces the offer is the desktop's own, from the collision bar.
//
// ── A CONTINUOUS TRAIL'S PAGE IS NOT FROZEN HERE ─────────────────────
//
// CLAUDE.md's trail-exception clause: a continuous trail's canonical doc
// is "freeform-editable at any position", whatever day it was started.
// `pageReadonly` already encodes that — mode outranks date — so this
// module asks it rather than re-deriving the rule, and the trail
// exception's page gets `continue` on every day of its life. The one
// thing the host has to get right is that `trailMode` is the LINEAGE's
// mode and is not a field on the page row; a caller that leaves it null on
// a continuous page freezes exactly the surface the exception exists to
// keep open. See ShellApp's `openReading`, which resolves the mode and the
// page together before publishing either.

import { dayLabel } from "./page-model.js";
import { pageReadonly } from "./page-writable.js";

/**
 * The nav band's line for a page being read.
 *
 * The title is the DAY, not the focus line, and that is the reading
 * view's whole subject: the writer arrived here from a list of days.
 * The focus line is the screen's own title under the bar — `Title`, in
 * Lora, where ThreadPageView's `.pv-matters` sits — the page's first
 * sentence rather than a caption on the bar.
 *
 * The subtitle is always empty. The trail's name used to sit there; it is
 * a `Chip` under the title now, beside the provenance line that says when
 * the page was written (provenance.js, `readingProvenance`) — the
 * desktop's anatomy, where the trail is a chip on the subject and the
 * chrome names only the screen. The field stays in the shape so this and
 * `pinArtifactHeader` read the same to a `NavBar` call.
 *
 * Both of `dayLabel`'s reference dates are passed through rather than
 * defaulted one at a time. memory-model.js's `yesterdayOf` carries the
 * argument: defaulting them independently gives a screen handed any today
 * but the real one two reference dates that are not adjacent.
 *
 * @param {object} input
 * @param {{date?: string}|null} [input.page]
 * @param {string} [input.todayDateStr]
 * @param {string} [input.yesterdayDateStr]
 * @returns {{title: string, subtitle: string}}
 */
export function readingHeader({ page = null, todayDateStr, yesterdayDateStr } = {}) {
  const date = typeof page?.date === "string" && page.date ? page.date : null;
  // No date means the fetch has not landed. "reading" is what the screen
  // is doing in that frame, and it is replaced rather than corrected a
  // tick later — the alternative is a bar that says "today" and then says
  // something else, which describes a page that was never open.
  const title = date ? dayLabel(date, { todayDateStr, yesterdayDateStr }) : "reading";
  return { title, subtitle: "" };
}

/**
 * The rows under the writing, in order.
 *
 * `note: true` marks the one entry that is not a row at all: the screen
 * renders it through `Note`, a sentence of prose above the action group,
 * rather than through `Row`. It used to be an inert `Row` marked `fact`,
 * which was the only line the shell had — a 44px control that did
 * nothing, in the column where the taps are. A sentence that explains an
 * offer is a caption, and it sits over the offer it explains.
 *
 * The rows that remain are ACTIONS (row-kind.js): `continue` and `write
 * today` each do something and stay — they leave the stack for the page
 * root — and neither opens a screen for a chevron to point at. The screen
 * passes `kind="action"`.
 *
 * An empty array is returned for no page, and it is the honest answer
 * rather than a guard: with no row there is nothing to continue and
 * nothing to say about it. The screen shows its loading state instead.
 *
 * @param {object} input
 * @param {{is_open?: boolean, date?: string}|null} [input.page]
 * @param {"discrete"|"continuous"|null} [input.trailMode]
 * @param {string} [input.todayDateStr]
 * @param {string|null} [input.todayPageId]
 * @returns {{id: string, label: string, note?: boolean}[]}
 */
export function readingRows({ page = null, trailMode = null, todayDateStr, todayPageId = null } = {}) {
  if (!page) return [];
  const readonly = pageReadonly({
    page,
    trailMode,
    // The page the backend handed out as today (page-writable.js): judged
    // by identity, so a WebView clock behind the backend's cannot turn
    // today's page into "write today".
    todayPageId,
    // Passed through only when the caller gave one, so production keeps
    // page-writable.js's own default (the real clock) and a test keeps
    // its fixture. Spelling `todayDateStr: undefined` would be the same
    // thing; spelling it conditionally is what makes that visible.
    ...(todayDateStr ? { todayDateStr } : {}),
  });
  if (!readonly) return [{ id: "continue", label: "continue" }];
  return [
    // ThreadPageView's own words (`this page is done. today is on the
    // page.`), which is also the sentence that names where the next row
    // goes. Kept whole, and kept first: the reason, then the offer.
    { id: "done", label: "this page is done. today is on the page.", note: true },
    { id: "today", label: "write today" },
  ];
}
