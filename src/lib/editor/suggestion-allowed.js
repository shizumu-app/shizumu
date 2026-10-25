// suggestion-allowed.js — may a typed trigger character open its menu here?
//
// The bug: `@` typed in a code block opened the mention menu, and the Return
// that ends the line committed its "+ create" row. A BibTeX entry —
// `@book{kubler1962shape,` then Return — made a new trail called
// `book{kubler1962shape,`, opened a page on it, and every following line of
// the entry was typed onto that page instead of into the code block. Nothing
// errored; the code block was simply left behind with nothing in it.
//
// In code, every character is literal: `@` is a decorator, an email address,
// a BibTeX entry type. The schema already says which places those are — a
// node whose spec carries `code: true` (codeBlock) and the inline `code`
// mark — so the rule reads that rather than keeping a list of names.

/**
 * @param {import("@tiptap/pm/state").EditorState} state
 * @param {{from: number, to: number}} range - the trigger match, `@` first.
 * @returns {boolean} false when the trigger sits in code.
 */
export function suggestionAllowedAt(state, range) {
  let $at;
  try {
    $at = state.doc.resolve(range.from);
  } catch {
    return false;
  }
  if ($at.parent.type.spec.code) return false;
  // The trigger character itself is the one that would carry the mark, and
  // it sits AFTER range.from, so read the marks of the text at range.from + 1
  // rather than $at.marks() (which leans on the character before it).
  const end = Math.min(range.from + 1, state.doc.content.size);
  let inCodeMark = false;
  state.doc.nodesBetween(range.from, end, (node) => {
    if (node.isText && node.marks.some((m) => m.type.spec.code)) inCodeMark = true;
  });
  return !inCodeMark;
}
