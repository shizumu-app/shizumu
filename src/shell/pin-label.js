// What a pin row says, on either screen that lists pins.
//
// This was PinsScreen's local `labelOf` until memory grew a pins mode
// (P3 Task 3) and a second screen needed the same answer. Two copies of a
// display fallback is the shape that drifts silently: nothing fails when
// they disagree, the two lists simply start describing the same pin
// differently, and the writer is the only one who can see it.
//
// `pinDisplayTitle` already falls back to the content's first line and
// guards the legacy pins whose title was stored as raw JSON, so the only
// case left for this file is a pin with no readable text at all — an image
// or a file, whose row would otherwise render as an empty line the writer
// cannot tell from a broken one. The kind is the last resort for exactly
// that row.
//
// THE CHAIN LOST A FOURTH LINK on the way here, and it is worth saying why
// rather than leaving the next reader to re-add it. It read
// `… || pinKind(pin) || "pin"`, and that trailing "pin" could never
// render: `pinKind` is total — every branch of it returns a non-empty
// string literal, and its own last line is `return "board"` — so it has no
// falsy answer for the `||` to step past. Not even `pinKind(null)`, which
// falls through its three type guards to "text". A guard that cannot fire
// is not a safety net; it is a claim about the function next to it that
// happens to be false, and the version of it that mattered would have been
// a test of `pinKind` in the file that owns it.

import { pinDisplayTitle, pinKind, pinSnippet } from "../lib/pin-display.js";

/**
 * @param {any} pin
 * @returns {string}
 */
export function pinRowLabel(pin) {
  return pinDisplayTitle(pin) || pinSnippet(pin) || pinKind(pin);
}
