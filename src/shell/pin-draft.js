// pin-draft.js — what the pin screen's fields start with.
//
// This file was pin-sheet-model.js: the rows of a pin row's actions
// sheet, the drafts of an editor sheet behind it, and the detent that
// sheet opened at. The second device pass ended both sheets. A tester
// tapped a pin row, got a menu, and asked how to see the pin ("click on
// row opens dropdown but how to see the content"); then, once the screen
// existed, asked why the pin could not be edited on it. The old model's
// own header had written the answer down in advance — "if reading turns
// out to be what writers come here for … the row should open this screen
// and the actions should move to its bar. That is a measurement, not a
// redesign" — and the measurement came in.
//
// So a pin row pushes PinArtifactScreen, the actions are rows under the
// writing there (pin-artifact-view.js, `pinArtifactRows`), and the
// writing itself is edited in place. What this file still decides is
// what the screen's two fields open holding, which is the one part of
// the old model that the change did not touch — and the two rules below
// are load-bearing in exactly the way they were on the sheet.

import { pinModalKind, pinPlainText } from "../lib/pin-display.js";

/** Mirrors pin-display.js's private `looksLikeJSON`. Copied rather than
 *  exported-and-imported: it is a two-line defensive guard against legacy
 *  rows whose title or content was stored as raw serialized JSON, and the
 *  original is private on purpose. What matters is that both answer the
 *  same question — "would showing this string to the writer show them
 *  schema?" */
function looksLikeJSON(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  return trimmed[0] === "{" || trimmed[0] === "[";
}

/**
 * The pin's own title, for the screen's title field.
 *
 * DELIBERATELY NOT `pinDisplayTitle`. That one falls back to the first
 * line of the content so a row is never blank, and it elides at 60
 * characters — both right for a label and both wrong for a field, because
 * whatever the field holds is what a save writes to the title column.
 * Pre-filling a derived label would promote it into a stored title the
 * writer never typed, on the first save of an untitled pin; pre-filling an
 * elided one would truncate a real title to 60 characters plus an ellipsis.
 *
 * AND A STORED TITLE THAT IS ONLY THE FIRST LINE IS A DERIVED LABEL TOO.
 * The rule above was written against `pinDisplayTitle` deriving one at
 * display time; the phone defeats it from the other end by STORING one.
 * `pin-intent.js` titles a pin with its own opening words, because a phone
 * pins from the caret and never stops to ask for a name — which is right,
 * and which means the title column holds a label nobody typed.
 *
 * On the screen that reads as the same words twice, one above the other:
 *
 *     marlin152632          <- the title field
 *     from untrailed · …
 *     marlin152632          <- the writing
 *
 * So a title matching the content's own first line opens the field EMPTY,
 * on its "name this pin" placeholder. Nothing is deleted: the row keeps
 * that title until the writer types over it, the pins screen keeps showing
 * it (`pinRowLabel` falls back to the first line regardless, so those rows
 * read the same either way), and a pin the writer really did name still
 * opens holding that name. What goes away is only the repetition.
 *
 * Compared after trimming and against the ELIDED label too, because
 * `pin-intent.js` stores at most 60 characters and a longer first line is
 * therefore stored cut — still a derived label, still not worth repeating.
 *
 * @param {any} pin
 * @returns {string} "" when the pin carries no readable title of its own.
 */
export function pinTitleDraft(pin) {
  const raw = typeof pin?.title === "string" ? pin.title.trim() : "";
  if (!raw || looksLikeJSON(raw)) return "";
  return echoesTheContent(pin, raw) ? "" : raw;
}

/** Is this stored title just the writing's own opening words? */
function echoesTheContent(pin, title) {
  let plain = "";
  try {
    plain = pinPlainText(pin) || "";
  } catch {
    // A pin whose content will not parse has no first line to echo, and a
    // throw here would take the title field down with it. The title stands.
    return false;
  }
  const first = plain.split("\n")[0].trim();
  if (!first) return false;
  if (first === title) return true;
  // THE PREFIX RULE IS THE ELIDED CASE ONLY. pin-intent.js cuts a long
  // first line to 60 characters and adds its own "…", so that stored label
  // is a prefix of the writing rather than equal to it. Applying the same
  // test to a title with no ellipsis would swallow real names: "what the
  // trail is" is a writer's title and a prefix of "what the trail is for",
  // and an earlier version of this blanked the field on it.
  if (!title.endsWith("…")) return false;
  const cut = title.slice(0, -1).trim();
  return cut.length > 0 && first.startsWith(cut);
}

/**
 * The pin's text, for the screen's body field — or null when this pin's
 * body is not text, and the screen mounts an editor over its doc instead
 * (PinEditor, src/shell/ui/).
 *
 * `pinModalKind` is the fork the desktop already draws (a textarea in
 * PinNoteModal, a TipTap instance in PinArtifactModal), and it asks about
 * the CONTENT's shape rather than the `object_type` stamp: only content
 * that really is a plain string belongs in a text field. A doc handed to
 * one would come back as its own first line, and the save would replace a
 * board with that line.
 *
 * The null also covers a note whose content is an unparseable JSON-shaped
 * string — `pinModalKind` calls that a note (nothing parsed), but showing
 * it would put schema in the field and saving it would keep it there. For
 * that pin the screen has no doc either (pinArtifactDoc returns null), so
 * it shows its empty state and edits only the title.
 *
 * @param {any} pin
 * @returns {string|null}
 */
export function pinNoteDraft(pin) {
  if (!pin || pinModalKind(pin) !== "note") return null;
  const raw = pin.content;
  if (raw == null) return "";
  if (typeof raw !== "string") return null;
  return looksLikeJSON(raw) ? null : raw;
}
