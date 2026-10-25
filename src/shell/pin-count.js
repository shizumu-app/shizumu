// pin-count.js — what the page header's `pins` control says.
//
// The third device pass: "we don't know how much pin associated to current
// trail". The header said `pins` and nothing else, so the only way to learn
// whether a trail had kept anything was to open the list. The count goes on
// the control itself — `pins · 3` — because that control opens exactly the
// list the number counts (`getPins` for the page's trail, which is also
// what the pins screen shows), and a number that agreed with nothing on the
// next screen would be worse than none (pin-toast.js's rule).
//
// A TRAIL'S COUNT. An untrailed page's pins list is every untrailed pin
// app-wide, a heap rather than a trail, and the host passes null there
// (ShellApp's measurePinCount) so the control says the word alone.
//
// MEASURED, OR NOT SAID. `null` means the host has not read the list for
// this page yet, and the control says `pins` alone rather than a number
// from a page it has left. Zero says `pins` too: `pins · 0` reads as a
// shortcoming counted, where the plain word is just the way in.

/**
 * @param {number|null|undefined} count
 * @returns {string}
 */
export function pinsLabel(count) {
  return Number.isInteger(count) && count > 0 ? `pins · ${count}` : "pins";
}
