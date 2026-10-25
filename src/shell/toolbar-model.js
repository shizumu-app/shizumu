// What the bottom slot shows. Two rows, decided in one place: which strip
// sits above the nav, and whether the nav is there at all.
//
// IT USED TO BE ONE ROW, and navigation was one of the things that could
// own it. A Galaxy A34 ended that. Its webview froze every viewport-height
// API at the keyboard-up value and never restored them, so keyboard-state's
// arithmetic believed a keyboard was up for the rest of the session — and
// this row answered `tab-bar` only when it believed otherwise. No tab bar,
// and (gesture-owner.js) no swipe off the page either: one unfalsifiable
// belief took every way out at once, and only restarting the app cleared
// it. Five fixes reasoned from the webview's numbers before the readout
// showed there was nothing there to reason from.
//
// So navigation stopped being a MODE. `nav` is a second field rather than a
// seventh strip value because a strip value that also meant navigation
// would be the same fact in two places, and a renderer could satisfy one
// and not the other. The strips below arbitrate each other; none of them
// arbitrates whether the user can leave.
//
// The phone's editor chrome exists in exactly two places: this slot and the
// gutter handle on the active block (§3). No bubble menu, no floating slash
// menu, no floating "+". That rule is what ends the controls-over-content
// class of bug — but it only holds if the slot's content is a function of
// state rather than a pile of independently-toggled flags, which is how the
// desktop chrome's visibility latched.
//
// Order is the design, and each line of it was a bug:
//   a gate first — onboarding and lock are not a state OF a shell root, they
//     are what stands in FRONT of one (App.svelte's chain runs onboarding →
//     lock → the boot fork, and the fork is below both on purpose). No
//     editor is mounted, no root is showing, and every input below this
//     line describes one or the other. It outranks even the row below it
//     because a gate's ONLY control lives in the slot: a pushed screen has
//     a back button in its nav bar and a sheet has its own handle, but
//     blank a gate's band and the surface has no control at all and the
//     user is at a wall. See `gateAction` at the parameter list.
//   nothing next — a pushed screen or an open sheet owns the bottom of the
//     display outright. A find bar (or any other strip) peeking out from
//     under a sheet is exactly the layering bug the single-slot rule exists
//     to prevent, so this outranks even find.
//   another root next — every strip below is the EDITOR's, and only the
//     page root has one. See `space` at the parameter list for the two
//     bugs that row ends.
//   find next — it is a mode the user explicitly opened, and a selection or
//     a live query must not steal the slot back from under them.
//   keyboard down next — with no keyboard there is no editing context, so
//     there is no strip to put above the nav. It no longer decides whether
//     the nav exists; nothing does, outside the two rows above.
//   query before selection — typing "/" inside a selection means the trigger,
//     not the selection.
//
// The suggestion strip is latched-bug territory: a strip that stays open
// after the trigger closes is worse than one that never opens. The fix
// lives on the producer's side, not here — `editor-snapshot.js`'s
// `computeSnapshot` already returns `query: null` the instant no slash or
// mention trigger is live, and a `{ kind, text }` object only while one is.
// This module's whole job is to not invent a field the snapshot never
// carries: `query` itself is the liveness signal, so the guard below tests
// the object's presence, not some `active` flag that does not exist on it.
//
// ROW 4 TAKES TWO INPUTS, AND THE SECOND ONE IS THE BUG FIX. For a phase
// this row returned `{ strip: "suggestion-strip", buttons: [] }` — it won
// the slot on a live query and had nothing to put in it, which made the
// single most common keystroke in the editor blank the only chrome the
// phone has. (ShellApp could only defend itself by hardcoding `query: null`
// at the call site, i.e. by turning the row off.) So `suggestions` carries
// what the row would show, and a row with nothing to show does not take
// the slot: it falls through to whatever the caret is doing instead.
//
// Both conditions are load-bearing, though a caller who derives one from
// the other will never see the difference. `suggestions` alone would let a
// STALE chip list keep the slot after the trigger closed, which is the
// latching this file exists to prevent; `query` alone is what shipped the
// blank. Liveness and content are two questions and the row asks both.

export const TOOLBAR_BUTTON_LABELS = {
  // "turn into", not "type". The same action is reachable two ways —
  // this button, and the block sheet's `convert` row — and a person hits
  // both within a session with no way to know they are one thing. Two
  // names manufacture a phantom second feature.
  //
  // "type" is also ambiguous exactly here. It sits beside bold, italic and
  // list, on a surface whose whole purpose is typing, so it reads as a
  // VERB first; the noun reading needs the reader to already know the
  // feature exists. §4 spells it "type" and §3 spells the sheet row "turn
  // into" — both spec'd, and the spec's own parenthetical about this
  // action set had already gone stale (convert joined blockActionsFor
  // three days after the spec was written), so it is not decisive here.
  //
  // Costs five characters. When this was chosen the strip carried eight
  // controls and scrolled by design, so width did not bind; the six it
  // carries now fit a 360px phone without scrolling, and the label was
  // kept because the ambiguity above did not go away with the count. The
  // one width check left is the OS font scale raised, and that is the
  // device pass's (the visual pass plan's gate names it).
  type: "turn into",
  bold: "bold",
  italic: "italic",
  strike: "strike",
  code: "code",
  link: "link",
  list: "list",
  pin: "pin",
  "pin-selection": "pin selection",
  copy: "copy",
  insert: "insert",
  undo: "undo",
  // Inside a list item only (toolbarFor's block-strip row). Words, not
  // arrows: the label is also the button's accessible name.
  indent: "indent",
  outdent: "outdent",
  // Labelled but on no strip since the visual pass (BLOCK_STRIP below says
  // why). The entry stays so the id keeps its words the day a strip needs
  // it back — iOS may — rather than being re-invented under another name.
  "keyboard-down": "hide keyboard",
  field: "find",
  prev: "previous",
  next: "next",
  close: "close",
  // The gates' three. PREFIXED, and the prefix is the point: `next` is
  // already taken, one screen up, by find's next-match arrow. Two actions
  // sharing an id would share everything read off the id — `activeIdsFor`
  // and `disabledIdsFor` both work from these keys — so the day find's
  // next goes dead on a query with no matches, onboarding's next would go
  // dead with it, on a surface where it is the only control there is.
  // `unlock` needs no prefix: nothing else in the shell unlocks anything.
  unlock: "unlock",
  "gate-next": "next",
  "gate-begin": "begin",
  // Sync setup's three, prefixed for the gates' reason: `next` is find's.
  // Each is the PrimaryAction of one step of SyncSetupScreen — the
  // phrase step's way on, the relay step's enrol, the done step's
  // `sync_set_enabled(true)`.
  "setup-next": "next",
  "setup-connect": "connect",
  "setup-turn-on": "turn on",
};

const SELECTION_STRIP = ["bold", "italic", "strike", "code", "link", "pin-selection", "copy"];
const FIND_STRIP = ["field", "prev", "next", "close"];

// SIX, with `type` second whenever the caret is in a block, which on the
// page is nearly always: insert · turn into · bold · italic · pin · undo.
// The visual pass (2026-09-15) took two off the eight this was.
//
//   `insert` LEADS, since the third device pass ("insert should be
//                   first"). It is the one control on the strip that adds
//                   a block rather than changing the one the caret is in,
//                   and it was fourth — past three marks a thumb has to
//                   read on the way to it. First is also the one position
//                   that does not move: `type` comes and goes with the
//                   active block and `pin` with the pin intent, and every
//                   control after either shifts when they do.
//
//   `list`          went under `turn into`. The strip's list button was a
//                   one-marker toggle sitting beside a sheet that already
//                   offered bullet, numbered and task to every list — two
//                   surfaces for one question. turn-into-model.js is what
//                   gives a paragraph the target, and says how far that
//                   honestly goes.
//   `keyboard-down` went because Android has a way down without it — the
//                   system back drops the IME — and a control whose only
//                   job is to dismiss the surface the other five exist to
//                   keep is a strange thing to spend a sixth of the strip
//                   on. KNOWN UNKNOWN, recorded rather than resolved: a
//                   WKWebView on iOS shows no accessory bar over a
//                   contenteditable, so there `hide keyboard` may have been
//                   the only way down. Nobody has run the shell on iOS; the
//                   plan's gate carries the question and P6 owns it. If it
//                   comes back it comes back here, under its existing id.
//
// What the strip does NOT do any more is grey a control that cannot apply
// to this block or page — those are absent (toolbar-state.js's
// `stripPresence`). The list here is the ORDER; presence is decided a
// module over, from the editor's state, and every id here keeps its place
// relative to the others whatever is hidden.
const BLOCK_STRIP = ["bold", "italic", "pin", "undo"];

/**
 * @param {object} state
 * @param {boolean} [state.editing]  a text field has focus — the writer is
 *   in the text, whether or not the soft keyboard is on screen. What the
 *   editing strip keys on; see the row for why it is not `keyboardOpen`.
 * @param {boolean} [state.keyboardOpen]  the soft keyboard is up. Kept in
 *   the signature because callers pass it and a silently-dropped argument
 *   reads as an oversight, and because the strips below may yet want it.
 *   No row reads it.
 * @param {boolean} state.selectionEmpty          true when the caret has no range
 * @param {{kind: string, text: string}|null} [state.query]  the live slash/mention query
 * @param {string[]} [state.suggestions]  the chips that query resolves to, as
 *   slash-command titles — `suggestionChips` (suggestion-strip-model.js).
 *   Not computed here: the answer comes from the editor extension's own
 *   command list, and a model that imported it could no longer be tested
 *   against plain objects. Empty when absent, which falls the safe way —
 *   no chips, no strip.
 * @param {{type: string, pos: number, isBoard: boolean, isTitled: boolean,
 *   isEmpty: boolean}|null} [state.activeBlock]  the FULL shape readActiveBlock
 *   emits (editor-snapshot.js). This row only tests truthiness, so the extra
 *   three were invisible here and the type said `{type, pos}` until P2c Task 1
 *   read the producer. P2d's gutter and block sheets want isBoard, isTitled
 *   and isEmpty, and would have planned against a type that omitted them.
 * @param {boolean} [state.findOpen]
 * @param {boolean} [state.pushedScreen]  a Stack has pushed a screen over this one
 * @param {boolean} [state.sheetOpen]     a Sheet is open over this one
 * @param {"page"|"memory"|"settings"|string} [state.space]  which root is showing
 * @param {string|null} [state.gateAction]  the one control a chromeless gate
 *   offers, as a TOOLBAR_BUTTON_LABELS id — `gateStep` (gate-model.js).
 *   Null everywhere else, which is every caller inside ShellApp.
 * @returns {{strip: "none"|"block-strip"|"selection-strip"|"suggestion-strip"|"find-strip"|"primary-action",
 *   buttons: string[], nav: boolean}}
 *   `strip` is what sits ABOVE the nav row — "none" means the band is the
 *   nav row alone, not that the band is empty. `nav` is false in exactly
 *   two places, neither of them a measurement: a gate (navigating past a
 *   locked database is what the gate exists to prevent) and an overlay (a
 *   sheet or a pushed screen owns the bottom edge and carries its own
 *   labelled way out).
 */
export function toolbarFor({
  editing = false,
  keyboardOpen = false,
  // Defaulted, and it is the one parameter where the default changes the
  // answer rather than merely tidying it. Every other optional input here
  // is falsy-when-absent and falls the safe way; this one is read as
  // `!selectionEmpty`, so an absent value is `!undefined` — TRUE — and the
  // caller gets the SELECTION strip with no editor and no selection.
  //
  // A caller can only avoid that by remembering `?? true` at every call
  // site, which is a rule living nowhere. The honest reading of "no
  // selection information yet" is "nothing is selected", so it belongs
  // here, once, where the decision is.
  //
  // Found by P2c Task 2 before this function had ever been called: it has
  // had no caller since P1a, so `!undefined` had never been evaluated.
  selectionEmpty = true,
  query = null,
  suggestions = [],
  activeBlock = null,
  // The caret is in a list item (computeSnapshot's inListItem). A list item
  // could only be nested from a hardware Tab, so on a phone it could not be
  // nested at all; the owner chose the strip for it (2026-10-25), shown
  // only here so the strip everywhere else stays the six.
  inListItem = false,
  findOpen = false,
  pushedScreen = false,
  sheetOpen = false,
  // Which root is showing. Defaulted to "page" because that is the only
  // root that had a caller when this row was added, and because a caller
  // who does not say is, historically, the page.
  //
  // ADDED IN P3 TASK 3, by memory's search field, and it is the row that
  // was missing rather than a new feature. Every strip below the next two
  // lines is the EDITOR's — bold, list, pin, the slash chips, find's
  // arrows — and each of the three rows under it reads a state that only
  // the page can produce. Row 3 encoded that as "keyboard down means no
  // editing context", which was true for exactly as long as the page was
  // the only root with a field in it. Memory's search box is a field on
  // another root: focus it and `keyboardOpen` goes true, and without this
  // row the slot hands the writer the block strip over a list of days —
  // six controls aimed at an editor that is not mounted.
  //
  // ABOVE `findOpen` DELIBERATELY, which fixes a second one of the same
  // shape: nothing resets `findOpen` on a root switch, so opening find on
  // the page and then swiping up to memory left the find strip sitting
  // under memory's list, still typing into a page nobody can see.
  space = "page",
  // A GATE, and it is the only row above `pushedScreen || sheetOpen`.
  //
  // §2: "Onboarding / lock / midnight use the bands too (nav bar hidden,
  // content centred, bottom slot holds the primary action)." Two of those
  // three arrive here; midnight does not, and why is worth writing down
  // because it looks like an omission. Midnight is §1's non-dismissable
  // SHEET, and a sheet's actions are rows inside it — so midnight reaches
  // "no chrome" through the row below this one, which takes the slot away
  // from it. It is the one chromeless state that needs no new row.
  //
  // ONE INPUT, not the two row 4 takes. Liveness and content are separate
  // questions there because a strip can be live with an empty list; here
  // the strip is exactly one button, so "a gate is showing" and "it has an
  // action" are the same fact and cannot disagree. `gateStep` is total
  // over the two kinds — it never hands back a gate with no action — and
  // the fall-through if it ever did is the safe direction anyway: a caller
  // that renders no gate reaches this with null and gets the answer it had
  // before this row existed.
  //
  // WHY ABOVE ROW 1, and this half is a claim about the future rather than
  // an observation: nothing produces both today. ShellGate is the only
  // caller that passes `gateAction`, and it pushes no screens and opens no
  // sheets, so either ordering computes the same answer from every call
  // site that exists. The position is chosen on the asymmetry between the
  // three things row 1 and this row arbitrate. A pushed screen keeps a
  // back button in its nav bar when the slot empties and a sheet keeps its
  // own handle; a gate keeps NOTHING, because the slot is the only place
  // it has a control at all. Getting it wrong in this direction costs an
  // empty band under a full-screen surface with no way off it. The test is
  // "keeps the gate's action under a sheet or a pushed screen", and it goes
  // red when the row is moved below row 1.
  //
  // It is also above `keyboardOpen`, and that matters more now than it did.
  // A row placed below that line answers `nav: true` with the keyboard down
  // — how a gate is first painted — which would put page / memory /
  // settings under the unlock box and let the user walk around the lock.
  // That is why `nav: false` here is not a cosmetic choice about an empty
  // band: it is the lock. With the keyboard UP — lock is a passphrase
  // FIELD, so focusing it raises the IME on a surface with no editor behind
  // it — the answer with NO gate row at all is the editor's block strip
  // over a password box, which is P3's `space` bug (memory's search field)
  // one level up.
  gateAction = null,
  // Whether a soft keyboard has EVER been reported this session. Defaults
  // false, which is the only safe direction: a caller that does not know
  // gets the caret-only answer, so a writer is never left without controls
  // because of a fact nobody established. ShellApp latches it from
  // `keyboardOpen` — see the editing row for why it is a latch and not a
  // level.
  imeSeen = false,
}) {
  if (gateAction) return { strip: "primary-action", buttons: [gateAction], nav: false };
  if (pushedScreen || sheetOpen) return { strip: "none", buttons: [], nav: false };
  // Memory and settings reach their tab bar THROUGH this row, so it keeps
  // producing one; what they have no use for is any strip above it.
  if (space !== "page") return { strip: "none", buttons: [], nav: true };
  // Find keeps the nav under it. Its own close button means the nav is not
  // NEEDED as an escape here, so `nav: false` would be defensible — one
  // rule with no exception to remember is worth more than the 44px.
  if (findOpen) return { strip: "find-strip", buttons: [...FIND_STRIP], nav: true };
  // THE CARET AND THE KEYBOARD, BOTH.
  //
  // This row has now been written three ways and each one was answering a
  // different complaint, so all three are recorded here rather than one
  // replacing the next.
  //
  // It asked `keyboardOpen` alone first. A writer dismissed the keyboard
  // and watched insert, turn into, bold, italic and undo go with it — every
  // editing control gone on the root whose job is editing, until they
  // tapped back into the text. That rule made sense when the band was ONE
  // row and the strip's presence meant navigation's absence; the band is
  // two rows now and the strip costs the nav row nothing.
  //
  // So it moved to `editing` alone — a focused text field, which is what
  // the controls act on. That survived a keyboard dismissal, which was the
  // point, and it had a second virtue at the time: `keyboardOpen` was an
  // INFERENCE a Galaxy A34 could latch for a whole session, and a strip
  // that keyed on it could be held off the screen by a lie.
  //
  // And it over-corrected. Android's back key hides the IME without
  // blurring, so a writer who puts the keyboard away keeps a focused caret
  // — and a strip offering bold, undo and insert sat at the bottom of a
  // page nobody was typing into, for as long as they were reading it. The
  // writer's report is the plain one: the insert strip should appear only
  // when it is needed, while the keyboard is open.
  //
  // Both inputs, now, and the reason the first objection no longer applies
  // is that `keyboardOpen` is a MEASUREMENT on the platform that produced
  // it. The activity reports the IME (keyboard-state.js, the native
  // branch); the arithmetic that could latch is not consulted there. A
  // strip that comes and goes with the keyboard is the behaviour the writer
  // asked for, and it is now safe to key on it.
  //
  // `editing` is still the other half, and not redundant: focusing memory's
  // search field raises the IME with no editor mounted — the `space` row
  // above catches that one, but a field in a sheet on the page root would
  // not reach it.
  //
  // AND `imeSeen` IS THE THIRD, because "the keyboard is down" and "this
  // device has no soft keyboard" are not the same fact and the row above
  // cannot tell them apart. A writer on a Bluetooth keyboard, a case
  // keyboard, DeX or a Chromebook never raises an IME at all: `keyboardOpen`
  // is false for the whole session, and a strip gated on it alone offers
  // nothing to someone typing a document. That is the original complaint
  // ("the insert toolbar disappear") on a different input device, which is
  // how a fix for one report becomes the next one.
  //
  // So the keyboard only has a veto once it has shown up. Until the first
  // time this session sees one, the caret decides on its own, which is the
  // answer the `editing`-only rule gave and the right one where there is no
  // keyboard to wait for. A soft-keyboard phone passes `imeSeen` true from the
  // writer's first tap into the text and never goes back.
  if (!editing) return { strip: "none", buttons: [], nav: true };
  if (imeSeen && !keyboardOpen) return { strip: "none", buttons: [], nav: true };
  // A live trigger AND something to offer for it. A slash query that
  // matches no command, and every mention query (the chips are slash-only —
  // see suggestion-strip-model.js), arrive here with an empty list and fall
  // through: the writer keeps the block strip they were already looking at
  // rather than watching it empty out under them.
  if (query && suggestions.length > 0) {
    return { strip: "suggestion-strip", buttons: [...suggestions], nav: true };
  }
  if (!selectionEmpty) {
    return { strip: "selection-strip", buttons: [...SELECTION_STRIP], nav: true };
  }
  return {
    strip: "block-strip",
    buttons: [
      "insert",
      ...(activeBlock ? ["type"] : []),
      ...(inListItem ? ["indent", "outdent"] : []),
      ...BLOCK_STRIP,
    ],
    nav: true,
  };
}
