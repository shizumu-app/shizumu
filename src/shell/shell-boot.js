// Whether the phone shell renders at all.
//
// P5 INVERTED THE DEFAULT. This header used to argue the opposite case, in
// its own words: "an unwritten key reads back as null, which must stay off
// — defaulting a missing key to on would ship the redesign to every phone
// on the next release rather than to the testers who asked for it." That
// was the opt-in beta, and shipping the redesign to every phone is now the
// point. The sentence is quoted rather than deleted because the reasoning
// it carries did not stop being true; it stopped being what we want.
//
// THE FOUR STATES, and they are four, not two:
//
//   null       key never written  → ON. A phone that never opted out is a
//                                  phone that gets the shell.
//   "true"     written on         → ON.
//   "false"    written off        → OFF. The escape hatch, kept on purpose.
//   undefined  the read has not   → OFF. Not the same absence as null.
//              answered
//   (anything else)               → OFF, with the corrupt-value reasoning
//                                  below.
//
// THE ESCAPE HATCH IS KEPT, and it is the reason this function is not
// simply `mobileNav`. A tester whose shell breaks needs a way back to a
// tree that works, so "false" still opts out. The cost is precise and
// worth naming here because a later reader will be tempted to collect it:
// `bootShell` is therefore NOT equivalent to `mobileNav`, so every
// `mobileNav && !bootShell` condition in App.svelte is still reachable and
// none of the desktop phone chrome behind them is dead. That is what makes
// the desktop tree's bottom bar load-bearing — it is the only route to
// settings at phone width there.
//
// THAT ROUTE DOES NOT YET LEAD BACK IN, and this header said it did until
// the control was built. It read "hence the only way a tester who opted
// out could ever opt back in", which was a guess about a control that did
// not exist. The one that does exist is the shell's own labs switch
// (shell-switch.js), and it is INSIDE the shell — so opting out is
// currently ONE-WAY, and the settings the bar reaches hold no switch to
// undo it. Recorded here because a reader weighing the bar's deletion
// needs the real reason it stays, and recorded as a precondition in the P5
// plan because the fix is a control on a tree this branch may not touch.
//
// NULL AND UNDEFINED ARE DIFFERENT ABSENCES, and the difference decides a
// whole tree. `null` is get_setting answering "no such key" — a real
// answer, and under the new default it means on. `undefined` is App.svelte
// before the read resolves, or after it threw (`.catch(() => {})` leaves
// the state at its initial value). That is not an answer, and it must not
// boot the shell: a read that fails on a cold or migrating database would
// otherwise trap the very tester the hatch exists for, in the tree their
// "false" was supposed to get them out of. The escape hatch has to survive
// a database that is unhappy, because an unhappy database is exactly when
// it gets used. App.svelte's `let shellFlag = $state(undefined)` is what
// feeds this, and shell-boot.test.js asserts that initialiser as text —
// initialising it to `null` instead would silently boot the shell on every
// phone one tick before the flag was ever read.
//
// AN UNRECOGNISED STRING IS OFF, which is the one place the old header's
// exactness argument survives intact. The setting arrives from get_setting
// as a string, never a boolean — set_setting takes a Rust String
// (commands.rs:1236-1242) and the column holds text, so turning the flag
// off writes the four characters "false", and `Boolean("false")` is true.
// A `setting !== "false"` check would read the same way for "false" but
// would send a corrupted row ON. So the on-states are enumerated and
// everything else falls through: a value nobody wrote on purpose is not
// consent to the redesign, and the tree it falls to is the one that has
// shipped for years.
//
// WHICH DIRECTION IS RECOVERABLE HAS SINCE INVERTED, and this paragraph
// used to close on the other answer: "Off is the recoverable direction:
// the desktop tree at phone width still has a route to settings, and the
// shell may not." That was written when neither tree had a switch. Now the
// SHELL has one and the desktop does not, so ON is the direction a reader
// can leave on their own and OFF is the one-way trip. The behaviour is
// unchanged anyway — an unrecognised value must not be read as a choice
// nobody made — but the reason above is the one that still holds, and this
// is here so the next reader does not inherit an argument that reversed.
//
// WHAT WRITES THIS KEY is one surface: the shell's own labs section, via
// `shellSwitchValue` in shell-switch.js. This header used to say "NOTHING
// WRITES THIS KEY YET — the hatch is a mechanism without a control until
// one is built", and that was true for as long as the only writes in the
// tree were harness code (the demo bootstrap, the VR seed, the VR scenes),
// which made the hatch openable only by editing SQLite. The control is
// built; the sentence is replaced rather than left standing, because a
// header claiming there is no way to reach this function's off state is
// the kind of comment a reader acts on.
//
// The viewport is checked as well as the flag because the shell is a phone
// tree with no desktop layout inside it. A tester who tries it on a phone
// and then opens the same database on a laptop would find their laptop
// rearranged, with no visible control to undo it — and wherever the
// toggle eventually lands it will be a phone surface. Desktop keeps the
// desktop tree.
//
// THE VIEWPORT IS NOT ENOUGH ON ITS OWN, and this header stopped at the
// paragraph above until the gap was found. `isMobileNav()` is
// `isPhoneViewport() || (isCoarsePointer() && isTabletViewport())`, and
// `PHONE_QUERY` is `(max-width: 480px), (orientation: landscape) and
// (max-height: 480px)`. That second clause matches a SHORT, WIDE DESKTOP
// WINDOW — it was written to keep a handset on its side from falling out
// of the phone tier, and it cannot tell a handset on its side from a
// laptop window someone dragged short. The app ships as a Linux desktop
// Flatpak, so under the flipped default a user with a mouse who resized
// their window would have been handed the phone shell, on the one tree
// that has no route back in (see the one-way paragraph above). That is
// not a hypothetical shape: the VR harness's `android-landscape` project
// runs at 863x360 and photographs the DESKTOP tree, which is exactly why
// src/lib/vr/seed.js has to seed `try_new_shell: "false"` for it.
//
// So the pointer is asked as well, and it is asked as INPUT MODALITY,
// which is the thing the size queries cannot see. A phone is always
// coarse; a desktop window is fine however short it gets. `isCoarsePointer`
// and `watchCoarsePointer` already exist in src/lib/responsive.js and are
// reused rather than re-spelled — a second matcher for the same query is
// how two predicates start disagreeing.
//
// THE FIX IS HERE AND NOT IN `isMobileNav()`, deliberately. Thirteen
// desktop components branch on those predicates, and narrowing the shared
// rule to fix the shell's gate would change the bar mount, the gesture
// enablement and the CSS breakpoint along with it. This is a shell-gate
// change; responsive.js keeps answering exactly what it answered.
//
// THE TABLE, with the flag already in an on-state (null or "true"):
//
//   mobileNav  coarsePointer  →
//   true       true           → ON.  a phone, or a touch tablet.
//   true       false          → OFF. THE REGRESSION THIS TERM CLOSES —
//                               a short/narrow desktop window with a
//                               mouse. Keeps the desktop tree.
//   false      true           → OFF. a big touchscreen: coarse, but there
//                               is no phone-shaped viewport to render into.
//   false      false          → OFF. an ordinary laptop.
//
// `coarsePointer` DEFAULTS TO FALSE, and that default is the same
// argument as `undefined` above: a caller that has not said is not a
// caller saying yes. Under jsdom `window.matchMedia` does not exist at
// all, `safeMatchMedia` returns null and `isCoarsePointer()` answers
// false — so the default and the real reading agree there, and neither
// boots the shell.

/**
 * @param {object} input
 * @param {string|null|undefined} input.setting  raw get_setting("try_new_shell")
 * @param {boolean} [input.mobileNav]            isMobileNav()
 * @param {boolean} [input.coarsePointer]        isCoarsePointer()
 * @returns {boolean}
 */
export function shouldBootShell({ setting, mobileNav = false, coarsePointer = false }) {
  return (
    mobileNav === true && coarsePointer === true && (setting === null || setting === "true")
  );
}

// There was a `playground` escape hatch here, meant to let ?playground=shell
// force the shell on a laptop. It never had a caller: that param routes to
// the component gallery from a branch above the fork, and the VR scenes reach
// the shell by seeding the setting instead. Removed rather than kept "in case"
// — an argument nothing passes is the same condition that left gestureOwner
// inert for three phases. A dev route into the shell is still worth having;
// when one is built it should add its input and its caller in one commit.
