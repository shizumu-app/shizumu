// focus-line.js — whether leaving the "what matters now" field writes.
//
// The field is the page's title, and it is typed into far less often than
// it is passed through: every tap on the canvas that started on the title,
// every Enter that hands the caret down to the prose, blurs it. The
// desktop's WhatMattersNow.svelte learned the cost of saving on every one
// of those (its handleBlur): "a blur is not an edit. Saving
// unconditionally here broadcast "" from every device that ever
// autofocused an empty field, and on the other device that "" carried a
// newer clock than the real title." One write per REAL change, compared
// against what was last synced rather than against "", is the rule, and
// it is a rule about two strings, so it lives here where a test can
// reach it rather than in the input's blur handler.
//
// What counts as a change is the trimmed text. Trailing whitespace the
// writer never meant is not a new title, and a title that was `"the
// book"` and is typed back as `"the book "` should not go over the wire
// as an edit — the desktop compares raw text and pays a no-op write for
// that case; this compares what the row will actually hold.
//
// An EMPTIED field is a change, and the write is `""`. Un-naming a day is
// a thing a writer may want (the pin editor's rename makes the same call
// for a pin's title), and `update_what_matters_now` takes the text as
// given; the host stores `null` for the row from an empty string.

/**
 * @param {{ draft: string, synced: string | null | undefined }} input
 *   `draft` is what the field holds; `synced` is what the row holds, or
 *   the last text this rule returned — the host passes the page's own
 *   `what_matters_now`.
 * @returns {string | null} the text to write, or null when nothing changed.
 */
export function focusLineWrite({ draft, synced }) {
  const next = typeof draft === "string" ? draft.trim() : "";
  const prev = typeof synced === "string" ? synced.trim() : "";
  return next === prev ? null : next;
}

// THE DAY MARKER. A continuous trail is one living document, and each day's
// focus is stamped into it as that day's marker (CLAUDE.md, trail modes).
// The desktop stamps on the focus line's commit (Page.svelte onCommit); the
// phone wrote only the page row, so a day written on the phone left no
// marker carrying its focus (sync journey J5.3, 2026-10-24).

/**
 * @param {{ trailMode: string | null, lineageId: string | null, readonly: boolean, text: string, day: string }} input
 * @returns {{ date: string, whatMatters: string } | null} what to stamp, or null for nothing.
 */
export function dayMarkerStamp({ trailMode, lineageId, readonly, text, day }) {
  if (trailMode !== "continuous" || !lineageId || readonly) return null;
  return { date: day, whatMatters: text ?? "" };
}
