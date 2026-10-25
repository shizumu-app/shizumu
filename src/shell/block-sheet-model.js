// What the block actions sheet offers, and what each row says.
//
// Why the shell's rows are added HERE and not upstream in
// `blockActionsFor`. Two reasons, and only the second would survive if the
// first went away:
//
//   1. `src/lib/editor/block-actions.js` is shared with `main`, and this
//      branch may not edit it (CLAUDE.md, "Two trees"). Editing it here
//      would land a desktop behaviour change inside a phone-shell merge,
//      which is the one thing the split exists to stop.
//   2. The desktop cannot honour these rows. Move up / move down are the
//      keyboard-free path to the drag-to-reorder the phone gets (§3: "move
//      up/down in the sheet remain as the accessibility path"); the desktop
//      long-press sheet has no reorder to be an alternative to. Growing the
//      shared list would put two rows in the desktop's sheet that do
//      nothing — the failure the plan forbids, exported to a tree that
//      cannot see it happen.
//
// So the division is: the shared module decides what a block offers
// ANYWHERE, and this one adds what only the phone can do. If the trees ever
// merge, (1) stops applying and (2) still does.
//
// The count is two, not three. §3 reads "the existing `blockActionsFor` set
// (pin, copy, title, insert below, delete) plus move up, move down, turn
// into" — but that parenthetical is a snapshot of the shared module on
// 2026-08-22, the day the spec was written, and `convert` landed on it three
// days later (d37410dc, "convert a board block's type in place"). "Turn
// into" is not a third addition; it is the shared `convert` row under the
// spec's name for it. Offering both would put the same action in the sheet
// twice, so this file relabels rather than duplicates.
//
// Order is not re-decided here. `blockActionsFor` returns an ORDERED list
// and its suite pins that order; a sheet whose rows move between openings is
// unusable, so the shared sequence is passed through untouched and the two
// moves are spliced in ahead of `delete`. Destructive row last is the whole
// point of the placement: appended after `delete`, a mis-tap aimed at "move
// down" lands on the row that cannot be undone by tapping again.
//
// The moves are offered for every block, with no first/last gate. That is a
// limit of the inputs, stated rather than hidden: `activeBlock.pos` is a
// document position, not an index, and nothing in this file's three inputs
// knows where the document ends. At a boundary the move is a no-op — the
// edge of a real, implemented action, not the dead row the plan rules out.
// If Task 3 finds the no-op reads as broken, the fix is a boundary fact
// passed in, decided here; it is not a reason to compute geometry.
//
// One caller: ShellApp's `rowsFor`, which opens the sheet from the gutter
// handle (P2d Task 3) and filters what is returned here through the row
// actions it can honour. This header said "no caller yet" for three phases
// after it got one.

import {
  blockActionsFor,
  BLOCK_ACTION_LABELS as SHARED_BLOCK_ACTION_LABELS,
} from "../lib/editor/block-actions.js";

/**
 * Every row the sheet can show, id → label. Spread from the shared map so
 * the ids the desktop also has keep ONE source of copy; the entries below
 * the spread are the shell's deltas and are the whole diff.
 *
 * Brand voice: lowercase, present tense, fewest words.
 */
export const BLOCK_ACTION_LABELS = {
  ...SHARED_BLOCK_ACTION_LABELS,
  // §3's name for the shared `convert` id. The desktop keeps "convert to…".
  convert: "turn into",
  "move-up": "move up",
  "move-down": "move down",
};

// Hyphenated to match `insert-below`, the shared map's only other two-word
// id — so a caller switching on ids never has to remember which convention
// a given row followed.
const MOVE_IDS = ["move-up", "move-down"];

/**
 * blockSheetRows({ activeBlock, canPin, hasTitleSlot, convertTargets })
 *   -> {id, label}[]
 *
 * @param {object} args
 * @param {{type: string, pos: number, isBoard: boolean, isTitled: boolean,
 *   isEmpty: boolean}|null} [args.activeBlock]  readActiveBlock's output
 *   (editor-snapshot.js), which supplies two of `blockActionsFor`'s five
 *   inputs directly. null means the caret is in no top-level node.
 * @param {boolean} [args.canPin]  `mayPinBlock(...)` — it takes text, not a
 *   node, so the caller reads the strings off the block first.
 * @param {boolean} [args.hasTitleSlot]  does this block render a
 *   `.board-title-slot` to focus — `core.hasBlockTitleSlot(pos)`, the same
 *   DOM fact the desktop's sheet reads off the block element. It is passed
 *   IN rather than taken off `activeBlock` because the snapshot cannot
 *   answer it: that module is pure over `editor.state` and this is a DOM
 *   fact, which is exactly why it must not be guessed from the node type.
 *   `activeBlock.isTitled` is the neighbouring question — whether a title
 *   has been TYPED — and is emphatically not this one. Both were called
 *   `hasTitle` until 2026-08-31, and that is the whole reason `title` spent
 *   three phases as an absent row here: feeding the typed answer to this
 *   gate offers the row only on boards that already have a title, and never
 *   on the untitled board it exists to title.
 * @param {string[]} [args.convertTargets]  `convertTargetsFor(...)`. Empty
 *   means not convertible; this file only reads its length, so it never
 *   needs to know what a target is.
 * @returns {{id: string, label: string}[]} rows in display order
 */
export function blockSheetRows({
  activeBlock = null,
  canPin = false,
  hasTitleSlot = false,
  convertTargets = [],
} = {}) {
  if (!activeBlock) return [];

  const shared = blockActionsFor({
    isBoard: activeBlock.isBoard,
    hasTitleSlot,
    isEmpty: activeBlock.isEmpty,
    canPin,
    canConvert: convertTargets.length > 0,
  });

  // `indexOf`, not "the last one is delete": that would be true today and
  // would silently put the moves in the wrong place the day the shared
  // order gains a row after it. Absent (an empty paragraph offers no
  // delete), the moves go last.
  const cut = shared.indexOf("delete");
  const ids =
    cut === -1
      ? [...shared, ...MOVE_IDS]
      : [...shared.slice(0, cut), ...MOVE_IDS, ...shared.slice(cut)];

  return ids.map((id) => ({ id, label: BLOCK_ACTION_LABELS[id] }));
}
