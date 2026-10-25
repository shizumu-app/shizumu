// The control behind the escape hatch: what the labs switch writes, and
// what state it shows.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
//
// P5 Task 2 flipped the default, so an unwritten `try_new_shell` boots the
// shell on a phone-shaped viewport, and kept `"false"` as the way back out.
// It then found that NOTHING IN THE APP WRITES THAT KEY. Every write in
// the tree was harness code — the demo bootstrap, the VR seed, the VR
// scenes — so the hatch was openable only by editing SQLite. A hatch
// nobody can open is not a hatch, and shell-boot.js's own header recorded
// the gap ("NOTHING WRITES THIS KEY YET") rather than routing around it.
// This is the write.
//
// ── THE VALUE IS A STRING, AND IT IS "false" EXACTLY ──────────────────
//
// `set_setting` takes a Rust `String` (commands.rs:1236-1242) and the
// column holds text, so the off value is the four characters `false` and
// not a boolean. shell-boot.js enumerates the ON states and reads
// everything else as off, which means a near miss — `"off"`, `"0"`, `"no"`
// — would still leave the desktop tree. That is the trap: a wrong value
// LOOKS correct, because it fails toward the tree the user asked for. It
// is only wrong in the other direction, where turning the switch back on
// has to produce a value shell-boot reads as ON, and only `"true"` (or a
// never-written key) does. So the two values are produced here, together,
// and shell-switch.test.js asserts both against `shouldBootShell` itself
// rather than against a second copy of the table.
//
// ── THE ROW'S STATE IS THE BOOT FORK'S ANSWER, NOT A SECOND OPINION ───
//
// `shellSwitchChecked` delegates to `shouldBootShell` instead of testing
// the string itself. A row that decided on its own would drift: a stored
// value neither side recognises reads as off to the boot fork, and a row
// that showed it as ON would be telling the reader they are getting a tree
// the next launch will not give them. Delegating makes that class of lie
// unrepresentable.
//
// `mobileNav: true` and `coarsePointer: true` are passed as constants,
// and that is a fact about where this runs rather than an assumption. The
// only caller is the shell's settings screen, and the shell mounts only
// under `bootShell`, which required BOTH. The question the row is really
// asking is "would a phone boot the shell on this value", and that is the
// question with the viewport and pointer halves already answered.
//
// THE SECOND CONSTANT IS NOT DECORATION. `shouldBootShell` defaults
// `coarsePointer` to false, so omitting it here would make this row read
// OFF for every stored value — the row's own "true" included — and the
// loop in shell-switch.test.js that compares this against
// `shouldBootShell` would still go green, because both sides would be
// answering false for the same wrong reason. Two mechanisms hiding each
// other; the reference call in that test passes the same pair, so the
// comparison keeps comparing something.

import { shouldBootShell } from "./shell-boot.js";

/** The settings key. Exported rather than typed twice because the WRITE
 *  is here and the READ is in App.svelte — two literals with nothing
 *  holding them together is how a control quietly stops reaching the
 *  thing it controls. shell-switch.test.js reads App.svelte and asserts
 *  the read uses this exact string. */
export const SHELL_SWITCH_KEY = "try_new_shell";

/**
 * What to store for a switch the reader has just moved.
 *
 * @param {boolean} on  the switch's new position
 * @returns {"true"|"false"}  a string, because the column holds text
 */
export function shellSwitchValue(on) {
  return on ? "true" : "false";
}

/**
 * Where the switch sits for a stored value.
 *
 * @param {string|null|undefined} setting  raw get_setting("try_new_shell")
 * @returns {boolean}  on exactly when a phone would boot the shell on it
 */
export function shellSwitchChecked(setting) {
  return shouldBootShell({ setting, mobileNav: true, coarsePointer: true });
}
