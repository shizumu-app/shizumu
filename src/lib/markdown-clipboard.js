// Helpers shared by the editor's paste/copy/cut handlers. The contract:
//
//   looksLikeMarkdown(text)
//     Heuristic check on text/plain payloads. Returns true when the
//     payload likely came from a markdown source. Conservative: only
//     trips on patterns that are vanishingly rare in normal prose.
//
//   serializeSelection(editor)
//     Build a fake one-page TipTap doc from the current selection and
//     run it through the existing src/lib/export/markdown.js serializer.
//     Returns a markdown string.
//
//   parseAndInsert(editor, md)
//     Parse a markdown string via src/lib/export/parse.js and insert the
//     resulting doc content at the editor's current cursor position.
//
// The serializer/parser pair is the same one used by trail-folder
// export (round-trip tested in src/lib/export/round-trip.test.js), so
// shizumu-specific nodes (recipe, q&a, chart, pin-ref, page-ref, day-
// marker, attachment) keep their semantics through clipboard.

import { serializePage } from "./export/markdown.js";
import { parsePage } from "./export/parse.js";

const FENCE_RE = /(^|\n)```/;
const BULLET_RE = /(^|\n)[-*+]\s+/;
const HEADING_RE = /(^|\n)#{1,6}\s+/;
const BOLD_RE = /\*\*[^\s*][^*]*\*\*/;
const NUMLIST_RE = /(^|\n)\d+\.\s+/;
const BLOCKQUOTE_RE = /(^|\n)>\s+/;
// "- [ ] " / "- [x] " — a checklist marker, which prose never produces.
const TASK_RE = /(^|\n)\s*[-*+]\s+\[[ xX]\]\s+/;
// Any list line, bullet or ordered. Counted (not just tested) so two or more
// can stand in for the two-distinct-markers rule.
const LIST_LINE_RE = /(^|\n)\s*(?:[-*+]\s+|\d+\.\s+)/g;

export function looksLikeMarkdown(text) {
  if (!text || typeof text !== "string") return false;
  // A fenced code block is unambiguous, accept on its own.
  if (FENCE_RE.test(text)) return true;
  // A task marker is equally unambiguous — prose does not open a line with
  // "- [ ] ". Without this, copying a checklist item and pasting it back
  // inserted the literal text "- [ ] make default font size 17 by default",
  // because the two-distinct-markers rule below can never be satisfied by a
  // list: a list is ONE marker type. Worse, it compounded — once a literal
  // "- [ ]" sat inside a task item, copying that item again prefixed another,
  // giving "- [ ] - [ ] …".
  if (TASK_RE.test(text)) return true;
  // Several list lines are likewise not prose. One line stays ambiguous (a
  // lone "- foo" is a plausible sentence fragment, and diff hunks open with
  // "-"), so this needs at least two.
  if ((text.match(LIST_LINE_RE) || []).length >= 2) return true;
  // Otherwise require two distinct markers, so single-pattern plain
  // text (shell comments, diff hunks, email quotes, numbered lists in
  // prose) doesn't trip the check.
  let hits = 0;
  if (HEADING_RE.test(text)) hits++;
  if (BOLD_RE.test(text)) hits++;
  if (BULLET_RE.test(text)) hits++;
  if (NUMLIST_RE.test(text)) hits++;
  if (BLOCKQUOTE_RE.test(text)) hits++;
  return hits >= 2;
}

export function serializeSelection(editor) {
  if (!editor) return "";
  const slice = editor.state.selection.content();
  // Build a minimal Page wrapper for the serializer. content_json is
  // the wire shape it expects; we hand it a doc whose children are the
  // selection's content fragment.
  const doc = {
    type: "doc",
    content: slice.content.toJSON() ?? [],
  };
  const fakePage = {
    id: "selection",
    date: "1970-01-01",
    page_number: 1,
    what_matters_now: null,
    created_at: "",
    updated_at: "",
    content_json: JSON.stringify(doc),
  };
  // A selection is not a page: what lands in another app should be the
  // writing, so the only block lines are a decision's kind, state and date,
  // which a cut and paste inside the app must keep (markdown.js,
  // clipboardBlockLine). No ids and no pins: a paste is a new block.
  const full = serializePage({ page: fakePage, pins: [], blockLines: "clipboard" });
  // Strip the YAML frontmatter — clipboard recipients don't want it.
  const m = full.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return m ? m[1] : full;
}

/**
 * What a plain-text target receives when a selection is copied.
 *
 * PLAIN TEXT IS NOT MARKDOWN WITH THE SYNTAX TAKEN OUT, and the defect this
 * replaces is what happens when it is treated that way. The copy handler
 * built `text/plain` by stripping `#`, `*`, backticks and `~~` out of the
 * markdown `serializeSelection` had just produced — but that markdown is
 * ESCAPED, because the exporter backslash-escapes ` \ ` * _ { } [ ] < > ` so
 * a page survives a round trip through a file. The strip left every one of
 * those backslashes in place, and where the escape was `\*` it took the
 * asterisk and left the backslash alone, so the character the writer typed
 * was destroyed:
 *
 *     typed  2*3 = 6      pasted into another app  2\3 = 6
 *     typed  snake_case   pasted into another app  snake\_case
 *
 * Reported from a real paste ("when copying from shizumu and paste in
 * another app it get \ for text"), and it is corruption rather than
 * cosmetics: the second one is ugly, the first one is wrong.
 *
 * So this asks ProseMirror for the text instead. `textBetween` over the
 * selection's own fragment is what TipTap's default clipboard serializer
 * does, and it is the only answer that cannot disagree with what is on
 * screen — there is no serializer in the path to disagree with.
 *
 * Blocks are joined by a blank line, which is the separator the editor's
 * own exporter uses between paragraphs and what a reader expects when a
 * multi-block selection lands in a mail composer.
 *
 * `text/markdown` is untouched by this: an app that reads markdown wants
 * the escapes, which is why they are there.
 *
 * @param {{state?: {selection?: {content?: () => {content: any}}}}|null} editor
 * @returns {string} "" when there is nothing to read, which tells the caller
 *   to leave the clipboard to TipTap's own default rather than writing a
 *   blank over it.
 */
export function selectionPlainText(editor) {
  const fragment = editor?.state?.selection?.content?.()?.content;
  if (!fragment || typeof fragment.textBetween !== "function") return "";
  return fragment.textBetween(0, fragment.size, "\n\n", (leaf) => leaf?.textContent ?? "");
}

export function parseAndInsert(editor, md) {
  if (!editor || typeof md !== "string" || md.length === 0) return false;
  // parsePage expects frontmatter; synthesise a minimal one so the
  // parser's splitter is happy. parse.js returns { frontmatter, doc }
  // where doc is the TipTap doc shape.
  const wrapped = `---\nshizumu: 1\npage_id: paste\ndate: 1970-01-01\npage_number: 1\n---\n${md}`;
  let parsed;
  try {
    parsed = parsePage(wrapped);
  } catch {
    return false;
  }
  const docContent = (parsed?.doc?.content ?? []).map(asNewBlock);
  if (docContent.length === 0) return false;
  editor.chain().focus().insertContent(docContent).run();
  return true;
}

/**
 * A pasted block is a new block: markdown pasted from an exported page file
 * carries `id=` and `pin=`, and inserted as-is the copy would share the
 * source's id and be bound to its pin. Both are dropped, at every depth; the
 * block-id plugin gives the new block its own id. State, date and title stay.
 */
export function asNewBlock(node) {
  if (!node || typeof node !== "object") return node;
  const out = { ...node };
  if (node.attrs) {
    const { blockId, pinId, ...rest } = node.attrs;
    out.attrs = rest;
  }
  if (Array.isArray(node.content)) out.content = node.content.map(asNewBlock);
  return out;
}
