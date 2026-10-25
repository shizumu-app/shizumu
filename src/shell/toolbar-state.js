// Which buttons in the bottom slot are lit, and which are dead.
//
// `toolbar-model.js` says WHICH strip shows and which ids it carries. This
// says what those ids look like right now: pressed for the marks under the
// caret, dead for the commands that cannot run. Two questions, one module,
// because both answers are read off the same editor state on the same
// transaction.
//
// It takes plain objects — a booleans bag and a snapshot — and never an
// editor. That is a scar, not a style preference. P1a's suggestion strip
// guarded on `query?.active`, but `readQuery` (editor-snapshot.js) returns
// `{ kind, text }` or `null` and has no `active` field at all, so the strip
// was dead from the day it was written while both sides' tests stayed green:
// the model's tests passed a shape it invented, and the editor's tests never
// looked at the strip. A module that reaches into an editor can only be
// tested against an editor, and the shape in between goes unread. Handing it
// plain objects makes the shape the thing under test.
//
// The ids come from TOOLBAR_BUTTON_LABELS rather than a list kept here. A
// second list would drift the same way that guard did, and drift in this
// direction is silent twice over: an id the strip never renders produces no
// button and no error, so a typo'd mark name reads exactly like a mark that
// is off.
//
// HIDDEN AND DEAD ARE TWO STATES, and `stripPresence` at the bottom is the
// line between them. Until the visual pass (2026-09-15) the strip greyed
// every control it could not run — `turn into` beside a paragraph with
// nowhere to go, `insert` on a closed page, `pin` on an empty line, `link`
// everywhere — and a strip that is a third grey at rest reads as a strip
// that is a third broken. The line drawn:
//
//   unavailable   cannot apply to THIS block or THIS page. Nothing the
//                 writer does on this spot changes the answer; they would
//                 have to be somewhere else. Absent from the strip.
//   disabled      could apply here, not right now. `undo` with nothing on
//                 the history stack is the type case: the control is right
//                 where the writer expects it, and the first edit lights it
//                 without moving anything. Present and dead.
//
// The test that names why a hidden `undo` would be wrong is the one to read
// if the line ever looks arbitrary.

import { TOOLBAR_BUTTON_LABELS } from "./toolbar-model.js";

const BUTTON_IDS = Object.keys(TOOLBAR_BUTTON_LABELS);

/**
 * Which strip buttons render pressed.
 *
 * @param {Record<string, boolean>|null|undefined} marks  the marks and node
 *   types active at the caret, as the caller read them off the editor —
 *   e.g. `{ bold, italic, strike, code, link, list }`
 * @returns {string[]} button ids — TOOLBAR_BUTTON_LABELS order, incidentally
 */
export function activeIdsFor(marks) {
  if (!marks) return [];
  // Iterating the id list rather than the caller's keys is what drops the
  // marks the shell has no button for — the editor reports highlight and
  // subscript happily enough.
  //
  // The order it produces is a side effect, not a promise: ToolbarStrip asks
  // `activeIds.includes(id)` per button, so nothing downstream can see the
  // order at all. Filtering the caller's own keys instead leaves every test
  // here green, and that reversal is the check that says so — rather than a
  // claim that this ordering is load-bearing.
  return BUTTON_IDS.filter((id) => Boolean(marks[id]));
}

/**
 * Which strip buttons render dead.
 *
 * @param {{canUndo?: boolean, selectionEmpty?: boolean}|null|undefined} snapshot
 *   the editor snapshot (`computeSnapshot`, editor-snapshot.js)
 * @returns {string[]} button ids
 */
export function disabledIdsFor(snapshot) {
  const ids = [];
  // No snapshot means no editor yet — the shell paints before EditorCore
  // mounts. Every branch below reads a missing snapshot as "cannot", so the
  // first paint disables the lot rather than offering commands that would
  // land on nothing.
  if (!snapshot?.canUndo) ids.push("undo");
  // The selection strip only shows while a range exists, so this looks like
  // belt and braces — but the strip renders from whatever snapshot it last
  // received, and a stale one that says "text is selected" after the caret
  // collapsed would pin an empty range and leave an empty pin behind.
  if (snapshot?.selectionEmpty !== false) ids.push("pin-selection");
  // Shown only inside a list item; dead where the item cannot move that
  // way, e.g. indent on a list's first item, which has nothing to nest under.
  if (!snapshot?.canIndent) ids.push("indent");
  if (!snapshot?.canOutdent) ids.push("outdent");
  return ids;
}

/**
 * Which of a strip's buttons render at all, and which of those render dead.
 *
 * `buttons` is the strip's ORDER (toolbarFor's answer); this never reorders
 * it, only removes from it, so a control keeps its place relative to its
 * neighbours whatever else is hidden. The two id lists are the host's two
 * categories (see the header): an id in `unavailable` is dropped, an id in
 * `disabled` stays and is reported back as dead. An id in BOTH is dropped —
 * hidden beats dead, because a control that cannot apply here has no "not
 * right now" left to signal.
 *
 * The returned `disabled` is filtered to the shown ids so the consumer can
 * hand it straight to the strip: a disabled list naming a hidden button is
 * not wrong, but it is a claim about a control that is not on screen, and
 * the two lists are cleaner when one is a subset of the other.
 *
 * @param {{buttons: string[], unavailable?: string[], disabled?: string[]}} args
 * @returns {{shown: string[], disabled: string[]}}
 */
export function stripPresence({ buttons, unavailable = [], disabled = [] }) {
  const gone = new Set(unavailable);
  const shown = buttons.filter((id) => !gone.has(id));
  const onScreen = new Set(shown);
  return {
    shown,
    disabled: disabled.filter((id) => onScreen.has(id)),
  };
}
