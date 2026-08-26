// slash-insert-target.js — where a slash-created block should land.
//
// The bug: type a slash command on a line that already has writing on it,
// and the new block SWALLOWS that writing. `/outline` on "the rest sinks —
// and that is what makes the writing honest." wrapped the sentence into
// the outline; `/task` turned it into a checklist item. The user did not
// ask to convert what they had written, they asked for a new block.
//
// The rule: a block command inserts on a NEW line below when the current
// line has other text on it, and in place when the line is empty. The
// empty case is the common one — press Enter, type `/`, pick a block — and
// converting the blank line you are standing on is exactly right there.
//
// Conversions are deliberately excluded. `/heading 1` on a written line
// MEANS "make this line a heading"; giving it a fresh empty heading below
// and leaving the sentence as a paragraph would be the same class of
// surprise in the opposite direction. So the split is by what the command
// is for, not by a blanket rule — see BLOCK_COMMANDS below.

/**
 * Slash-command titles that CREATE a block, as opposed to converting the
 * line the cursor is on or toggling a mark across it.
 *
 * Keyed by the command's `title` because that is the identity
 * `commandItems` already carries; adding a new block command means adding
 * it here, and the test that walks `commandItems` will say so if it is
 * forgotten.
 */
export const BLOCK_COMMANDS = new Set([
  "task",
  "bullet",
  "numbered",
  "code block",
  "table",
  "outline",
  "recipe",
  "decision",
  "chart",
  "q&a",
  "blockquote",
  "divider",
  "image",
  "file",
]);

/**
 * Slash-command titles that CONVERT the current line or toggle a mark on
 * it, and so must act where the cursor already is.
 *
 * Listed explicitly rather than inferred as "not a block command" so that a
 * new command added to neither set is caught by the test rather than
 * silently defaulting to one behaviour.
 */
export const IN_PLACE_COMMANDS = new Set([
  "heading 1",
  "heading 2",
  "heading 3",
  "text",
  "strikethrough",
  "code",
]);

/**
 * needsFreshLine — should this command get a new empty line to land on?
 *
 * @param {string} title - the slash command's `title`.
 * @param {boolean} lineHasOtherText - whether the textblock the cursor is
 *   in still holds text after the "/query" itself has been removed.
 * @returns {boolean}
 */
export function needsFreshLine(title, lineHasOtherText) {
  if (!lineHasOtherText) return false;
  return BLOCK_COMMANDS.has(title);
}

/**
 * Block types whose NodeView renders a title slot, which is a reachable
 * place at the very top of the block: ArrowUp from the first item lands
 * there, and ArrowUp again escapes upward (title-slot.js's
 * moveCursorBeforeBlock, which CREATES a paragraph above when the block is
 * the first node in the document).
 *
 * They therefore need no paragraph parked above them permanently.
 */
export const TITLE_ESCAPE_TYPES = new Set([
  "list",
  "blockquote",
  "qaBlock",
  "recipeBlock",
  "decisionBlock",
  // Its own NodeView (CodeBlockShizumu) renders the slot itself, alongside
  // the language input and copy button.
  "codeBlock",
  // ShellTableView (table-shell-view.js) wires its own slot into the
  // tableWrapper by hand. Task 1 added it; before that the table genuinely
  // had no title and no way out of the top, which is why it was excluded
  // here — see needsLeadingParagraph's note.
  "table",
]);

/** Node types the cursor can already sit inside at the top of a document. */
const TEXT_BEARING = new Set(["paragraph", "heading"]);

/**
 * needsLeadingParagraph — must an empty paragraph be parked above the
 * document's first node so the user can write above it?
 *
 * A block as the very first node is a trap without one: measured in the
 * browser, ArrowUp from the first list item goes to the block's TITLE
 * (block-title.js owns that key), no gap cursor appears from ArrowUp or
 * from clicking above, and typing goes nowhere. So the guard is real.
 *
 * But it fired for every board, which is why creating the first block on a
 * blank page left a stray empty line above it — the reported "it gets
 * inserted one line below the current one". A block that can be escaped
 * through its own title slot does not need the line: the paragraph is
 * created on demand, the moment the user actually asks to go up.
 *
 * `table` used to be listed here as the case that still needed it, on the
 * premise that its DOM contract fights NodeView wrapping so it has no title
 * slot and no way out of the top. Task 1 falsified that premise: it gave
 * ShellTableView a real `INPUT.board-title-slot`, and ArrowUp from it runs
 * the same moveCursorBeforeBlock as every other board. Measured in a live
 * editor — doc `["table"]`, ArrowUp from the title, doc
 * `["paragraph","table"]` with the cursor in the new paragraph. So a table
 * creates the line above on demand too, and it joined TITLE_ESCAPE_TYPES.
 *
 * Keeping the stale premise cost two bugs at once, not one: the stray empty
 * line above every `/table` on a blank page, and a dead title focus — the
 * parked paragraph swallowed the selection, so slash-commands.js's
 * armPendingTitleFocus resolved the cursor to that paragraph instead of the
 * table and never armed. That is the second stale premise in a decision
 * module on this branch to outlive the code it described; when the fact
 * changes, change the comment in the same commit.
 *
 * What still needs a parked paragraph is a first node that is genuinely
 * unreachable from above: an atom (`horizontalRule`), or a board with no
 * title slot. The default below assumes that of anything unrecognised.
 *
 * @param {string} firstNodeTypeName
 * @returns {boolean}
 */
export function needsLeadingParagraph(firstNodeTypeName) {
  if (TEXT_BEARING.has(firstNodeTypeName)) return false;
  return !TITLE_ESCAPE_TYPES.has(firstNodeTypeName);
}
