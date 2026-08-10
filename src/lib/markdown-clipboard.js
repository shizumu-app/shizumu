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
  const full = serializePage({ page: fakePage, pins: [] });
  // Strip the YAML frontmatter — clipboard recipients don't want it.
  const m = full.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return m ? m[1] : full;
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
  const docContent = parsed?.doc?.content ?? [];
  if (docContent.length === 0) return false;
  editor.chain().focus().insertContent(docContent).run();
  return true;
}
