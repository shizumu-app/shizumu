// pin-intent.js — what a pin carries, and what it is called.
//
// `EditorCore.confirmPin({title, category, content, nodePositions})` is the
// data half of pinning and it decides NEITHER of the first two on purpose
// (EditorCore:666): a category and a title are product answers, and the
// core has no product. This module is the shell's answer. It is a module
// and not a branch inside ShellApp because CLAUDE.md's first testing rule
// puts a decision where something can reach it, and because the desktop
// kept this decision inline in a `.svelte` file and grew two of them that
// disagree (below).
//
// It takes plain descriptors and never an editor — the same scar
// toolbar-state.js records. A module handed an editor can only be tested
// against an editor, and the shape in between goes unread.
//
// ── the two desktop answers, and why the phone needs a third ──────────
//
// `handlePinBlock` (TipTapEditor:1653) reads the DOM. Category comes off
// `data-type` and tag names, title off `hoveredBlock.getAttribute(...)`
// and `querySelectorAll("tr")`. It titles a list "list", a blockquote
// "outline", a table "table · 3×2" — TYPE LABELS, because a board's text
// is its items and items are not a name. Its NOTE branch then stores
// `hoveredBlock.textContent` as the pin's whole content, and
// block-pin-guard.js's header measures what that string actually holds:
// an empty bullet reads "list", a code block reads
// "copyconst … = truecode". The NodeView chrome is real text inside the
// block shell.
//
// `quickPinFromCursor` (TipTapEditor:1930) reads the NODE. No chrome, no
// DOM, one title rule — `existingTitle || textPreview.slice(0, 60) ||
// "untitled"` — and it serialises the node to JSON even for a note.
// It is the newer path and the better one.
//
// The phone's third answer takes the node-reading of the second and the
// type labels of the first, because each is right about a different half:
//
//   - CONTENT is always the node's JSON, never DOM text. Chrome-free by
//     construction, and it keeps the marks and any inline attachment that
//     a flatten-to-text would drop.
//   - A TITLE for a BOARD prefers its kind ("list", "table", "outline",
//     "code") over its text, because `node.textContent` concatenates a
//     list's items with no separator at all — "milk" and "eggs" arrive as
//     "milkeggs", which is not a name and not even a phrase.
//   - A TITLE for a NOTE is its text, because there the text IS the
//     sentence the writer wrote.
//
// ── the fallback is a quotation, not a summary ────────────────────────
//
// Step 3 of the plan asks this out loud, so: a title the writer did not
// type is a GUESS, and the only honest guess is one that invents nothing.
// Every fallback below is either a name the writer typed (`blockTitle`), a
// name the file system already had (`filename`), the block's own opening
// words verbatim, or the block's kind — which is a fact about the
// document, not a description of it. Nothing here summarises, and nothing
// reads the content to say what it is about. That would be a claim the
// shell cannot stand behind, on an artifact the writer keeps.
//
// It is also honest because it is not final: a pin row renames inline
// (PinRow), so a guess is an opening offer, not a label welded on. That is
// the same reason the phone pins without asking for a title at all —
// SharePopup's input cannot reliably raise the IME on a freshly-mounted
// overlay, so asking would trade a pin for a fight with the keyboard
// (TipTapEditor:1826 records the Android WebView rule behind that).
//
// ── the cap is 60, and it carries no ellipsis ─────────────────────────
//
// The plan says "the desktop truncates at 40 chars with an ellipsis;
// decide whether a phone agrees". It does not, and the premise is off by
// one surface: 40-with-an-ellipsis is the desktop's TOAST label
// (`title.slice(0, 40)`, TipTapEditor:1848 and :1993), computed after the
// pin is written. The stored title is 50 (`handlePinBlock`) or 60
// (`quickPinFromCursor`) and carries no ellipsis on either path.
//
// The phone takes 60, and no ellipsis, for two reasons that are about the
// pin row rather than about the phone:
//
//   - `pinDisplayTitle` (pin-display.js) already elides at 60 and appends
//     its own "…". A title stored longer than that is invisible; a title
//     stored WITH an ellipsis would be elided a second time.
//   - `pinSearchText` matches against the raw stored title. A "…" the
//     writer never typed is a character inside a haystack, and every one
//     of them is a word the search can no longer complete.
//
// 60 over 50 because the phone is in the same situation `quickPinFromCursor`
// is — pinning silently, with no popup to correct the guess in — and that
// is the path that chose 60.
//
// ── a block that is already pinned is refused, and why that is not
//    politeness ──────────────────────────────────────────────────────
//
// The obvious reason to refuse a second identical pin is tidiness. That
// is not this one. `confirmPin` STAMPS the new row's id onto the source
// node — `tr.setNodeAttribute(pos, "pinId", newPin.id)` — and paragraph
// and heading carry that attribute too (pin-id.js's PINNABLE_TYPES). A
// node holds ONE pinId, so pinning an already-pinned block does not add a
// pin beside the old one: it OVERWRITES the old one's stamp. The Rust
// side's `refresh_pin_caches` orphans any pin whose id is absent from the
// saved content_json, so the first pin goes dim — "like deleted",
// EditorCore's own words at :741 — on the next launch.
//
// So the rule is the STAMP, not content equality. The desktop compares
// content strings (`existing.some(p => p.content === pinContent)`), which
// works on `handlePinBlock`'s note path only because that path stores the
// rendered DOM's text, and text does not change when a node attribute
// does. `quickPinFromCursor` stores JSON like this module's caller does,
// and its guard therefore MISSES on the second press — the re-serialised
// node now carries the pinId the first press wrote, so the strings differ
// and the stamp is taken. That is a defect on the desktop's keyboard path
// today, not a rule worth importing.
//
// Refusing on ANY already-pinned block in range, rather than on all of
// them, for the same reason: one stamped block inside a wider selection
// is one pin about to be orphaned.
//
// What the writer sees is not a silent tap. `null` is also what the
// caller's disabled derivation reads, so the control goes DEAD on a block
// that is already pinned — which is the phone's version of the desktop's
// dimmed pin glyph (`blockAlreadyPinned`), and it says "this is kept"
// without a toast. Editing the block does not revive it, and that is the
// known limit of a stamp-based rule: pinId survives an edit, so a
// rewritten paragraph cannot be re-pinned until it is unpinned. A
// content-aware rule needs the trail's existing pins in hand, which is a
// fetch, and P2f Task 2 — which fetches them for the toast's count
// anyway — is where that trade gets made.

/** Longest stored title. See the header: `pinDisplayTitle` elides at 60. */
export const TITLE_MAX = 60;

/** The floor. Reached only by a block with non-text content, no name, no
 *  filename and no kind — an attachment whose attrs lost their filename is
 *  the one shape that gets here in practice. It is the last rung of the
 *  ladder, not an expected answer, and it says what it knows: nothing. */
export const UNTITLED = "untitled";

/**
 * One top-level block a pin covers, as the caller read it off the editor.
 *
 * @typedef {object} PinBlock
 * @property {number} pos            document position of the top-level node
 *   (`$from.before(1)` for the caret's block) — what confirmPin stamps.
 * @property {boolean} isBoard       `isBoardType(node.type.name)`. Passed in
 *   rather than derived here so this module imports nothing at all.
 * @property {boolean} isAttachment  the block is ONLY an attachment —
 *   `soleAttachmentNode(node)` answered non-null. A line MIXING text with an
 *   inline file is false here and pins as what it is: a line.
 * @property {boolean} [pinned]      the node already carries a `pinId`, so a
 *   pin exists whose stamp lives here. See the header: a second pin does not
 *   sit beside the first, it takes its stamp.
 * @property {boolean} hasContent    `mayPinBlock`'s answer for this block.
 *   False for an empty paragraph and for a divider; true for an attachment
 *   or a chart, whose content does not live in their text.
 * @property {string} [text]         `node.textContent` — chrome-free.
 * @property {string} [blockTitle]   `attrs.blockTitle`, trimmed. A name the
 *   writer typed, and therefore the first answer whenever it exists.
 * @property {string} [filename]     the sole attachment's filename.
 * @property {string|null} [kind]    `nodeKind(node)` (pin-display.js) — the
 *   one-word name the pin row's own chip will show for this block.
 */

/**
 * What to pin, and what to call it.
 *
 * @param {object} args
 * @param {"block"|"selection"} args.scope  which control was pressed. `block`
 *   is the strip's `pin` and the caret's own block; `selection` is
 *   `pin-selection` and a range the writer dragged.
 * @param {PinBlock[]} args.blocks  every top-level block the pin covers, in
 *   document order. One for `block`; for `selection`, every block the range
 *   overlaps — a selection pins the blocks it touches WHOLE, because
 *   confirmPin stamps top-level positions and half a paragraph has none.
 *   The desktop does the same (handlePinSelection, TipTapEditor:1498).
 * @param {string} [args.selectionText]  the range's text as the caller
 *   extracted it (`textBetween(from, to, " ")`). Ignored for `block` scope.
 * @returns {{category: "note"|"board"|"file", title: string,
 *   positions: number[]}|null} null when there is nothing worth pinning.
 */
export function pinIntent({ scope = "block", blocks = [], selectionText = "" } = {}) {
  const covered = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  if (covered.length === 0) return null;

  // Nothing pinnable anywhere in range. Not the same as "no blocks": a
  // node selection on a divider is a NON-empty selection over a real
  // block that has no content in any form, and it must not produce a pin
  // row saying nothing. `some`, not `every`, because a range that drags
  // across a paragraph and a divider is a range with writing in it — the
  // divider rides along inside the content rather than vetoing it.
  if (!covered.some((b) => b.hasContent)) return null;

  // Already kept. `some`, not `every` — see the header: one stamped block
  // anywhere in range is one pin about to lose its stamp to this one.
  if (covered.some((b) => b.pinned)) return null;

  const positions = covered.map((b) => b.pos);
  const category = categoryOf(covered);

  // The selected words win whenever there are any, whatever the blocks
  // under them are: the writer drew that range, so it is the one piece of
  // this decision that is not a guess at all.
  const chosen = scope === "selection" ? clean(selectionText) : "";
  const title = cap(chosen || titleOf(covered));

  return { category, title, positions };
}

/**
 * note · board · file — the three `object_type` values pin-display.js
 * reads. Chosen against what the pin ROW will do with the answer:
 *
 *   - `file` renders a chip that hands the blob back to the OS, so it is
 *     for a line that is ONLY a file and nothing else.
 *   - `board` is in pin-display's BOARD_TYPES, so it opens the artifact
 *     modal and gets a per-kind chip. A composite belongs here.
 *   - `note` renders the "text" chip. A paragraph or a heading is that.
 *
 * A multi-block range is a `board` even when every block in it is a
 * paragraph: two paragraphs kept together are a composite, and that is
 * exactly what the desktop's selection path says too — though it says it
 * for every selection, including one word inside one sentence, which is
 * the case this splits off. `pinKind` would label that word "board".
 */
function categoryOf(blocks) {
  if (blocks.length > 1) return "board";
  const [only] = blocks;
  if (only.isAttachment) return "file";
  if (only.isBoard) return "board";
  return "note";
}

/** The block-derived title: the first block that has anything to say. */
function titleOf(blocks) {
  const source = blocks.find((b) => b.hasContent) || blocks[0];
  // A name the writer typed outranks everything, on any kind of block.
  const typed = clean(source.blockTitle);
  if (typed) return typed;
  // A file's name is the file's name.
  if (source.isAttachment) {
    const named = clean(source.filename);
    if (named) return named;
  }
  // A board's text is its ITEMS, and node.textContent joins them with
  // nothing — see the header. Its kind is the better name and it is the
  // same word the row's own chip will carry.
  if (source.isBoard) {
    const kind = clean(source.kind);
    if (kind) return kind;
  }
  const words = clean(source.text);
  if (words) return words;
  // Everything above came up empty and the block still has content: an
  // atom. Its kind, then the floor.
  return clean(source.kind) || UNTITLED;
}

/** Collapse every run of whitespace to one space and trim. A title is one
 *  line by the time anything renders it (`pinDisplayTitle` splits on "\n"
 *  and keeps the first), so a stored newline is a character that only ever
 *  truncates the title early. */
function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Cap without eliding — the header says why there is no "…" here. */
function cap(title) {
  return title.length > TITLE_MAX ? title.slice(0, TITLE_MAX).trimEnd() : title;
}
