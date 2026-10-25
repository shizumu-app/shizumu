// What `turn into` offers the block the caret is in.
//
// THE ONE-LINE CHOICE. The block strip's list button is gone (toolbar-model
// .js), and the question was where a paragraph's way into a list now lives:
// under `turn into`, or under `insert`. It is `turn into` — the writer's
// intent when they reach for it is to change the block they are standing
// in, not to add one below it — and that is the default this file
// implements. The alternative is one line: drop PARAGRAPH_TARGETS to `[]`
// and the paragraph falls back to the insert sheet's `list` row, which
// lands a fresh list on the next line. Nothing else moves.
//
// WHAT A PARAGRAPH CAN HONESTLY BECOME, and why the list is two long when
// the plan sketched six. `block-convert.js` converts BOARD types only
// (CONVERTIBLE_TYPES: list, blockquote, qaBlock, recipeBlock, decisionBlock,
// codeBlock), so a paragraph has no targets there and never did — the
// strip's `turn into` was dead beside every paragraph for two phases. The
// targets below therefore run commands the shell already runs for other
// rows, and each was read before it was wired:
//
//   list      `COMMANDS.list` (ShellApp) → `setMarker("bullet")`, which on a
//             paragraph WRAPS it in a list item where it stands. In place.
//   heading   `runSlashInsert(ed, "heading 1")` → `setNode("heading")` on
//             the caret's textblock. `heading 1` is in
//             slash-insert-target.js's IN_PLACE_COMMANDS, so `insertionPoint`
//             opens no fresh line for it. In place.
//
// NOT here — numbered list, task list, outline, code block — because their
// slash commands (`numbered`, `task`, `outline`, `code block`) sit in
// BLOCK_COMMANDS, and `runSlashInsert`'s `insertionPoint` gives a
// BLOCK_COMMAND a fresh empty paragraph BELOW a written line before the
// command runs (needsFreshLine, the rule that stopped `/outline` swallowing
// the sentence it was typed on). Offered under `turn into`, each would
// leave the paragraph exactly as it was and add an empty board under it:
// an insert wearing the wrong name, on an empty paragraph acting in place
// and on a written one not — the same row doing two things depending on a
// fact the writer cannot see. The insert sheet already offers all four
// under the honest word. A list, once made, has its way on from here: it is
// a board, so `turn into` on it offers bullet, numbered and task through
// block-convert like any other.
//
// `readonly` is asked here for the paragraph branch only. The board branch
// never sees a read-only page — the host's `convertTargetsOf` answers `[]`
// there before this is called — but the paragraph targets are decided in
// this file, so the page's state has to reach it or a closed page would
// offer to turn its paragraphs into lists.

/** Target id → what the row says, for the board targets block-convert.js
 *  can produce. Its ids are type-shaped (`qaBlock`, `codeBlock`) rather
 *  than prose, so every host needs this translation; the desktop keeps its
 *  own copy in TipTapEditor. Brand voice: lowercase, fewest words. */
export const CONVERT_TARGET_LABELS = {
  bullet: "bullet list",
  ordered: "numbered list",
  task: "task list",
  blockquote: "outline",
  qaBlock: "q&a",
  codeBlock: "code block",
  paragraphs: "plain paragraphs",
};

/** The rows a paragraph gets, in display order. Ids are deliberately NOT
 *  block-convert.js target ids (`bullet`, `codeBlock`, …): the host routes a
 *  paragraph target to a command and a board target to `convertBlockNode`,
 *  and disjoint id sets are what keep that routing a lookup rather than a
 *  guess. The test holds the two sets apart. */
export const PARAGRAPH_TARGETS = Object.freeze([
  Object.freeze({ id: "list", label: "list" }),
  Object.freeze({ id: "heading", label: "heading" }),
]);

/**
 * turnIntoRows({ activeBlock, convertTargets, readonly }) -> {id, label}[]
 *
 * @param {object} args
 * @param {{type: string}|null} [args.activeBlock]  readActiveBlock's output
 *   (editor-snapshot.js); only `type` is read. null means no block.
 * @param {string[]} [args.convertTargets]  `convertTargetsFor(node)` for
 *   the block — block-convert.js's answer, already empty on a read-only
 *   page. When it has entries they ARE the rows, labelled.
 * @param {boolean} [args.readonly]  a closed page. Withholds the paragraph
 *   targets; see the header.
 * @returns {{id: string, label: string}[]}  empty means "nothing to turn
 *   into", which is both the sheet's gate for the row and the strip's
 *   gate for the button — one call, so the two cannot disagree.
 */
export function turnIntoRows({ activeBlock = null, convertTargets = [], readonly = false } = {}) {
  if (convertTargets.length > 0) {
    return convertTargets.map((id) => ({ id, label: CONVERT_TARGET_LABELS[id] ?? id }));
  }
  if (readonly || !activeBlock) return [];
  if (activeBlock.type === "paragraph") return PARAGRAPH_TARGETS.map((row) => ({ ...row }));
  return [];
}
