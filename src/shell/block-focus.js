// Which block a focused element belongs to, when the focus is not a caret.
//
// ── THE REPORT ────────────────────────────────────────────────────────
//
// "when tap on title it does not show the 3 dots". A table, a board, a
// recipe and a chart each carry a TITLE, and that title is a real `<input>`
// inside the node's NodeView — not prose. Tapping it moves the browser's
// focus and does NOT move ProseMirror's selection, so `computeSnapshot`
// keeps answering with whatever block the caret was last in, or with none
// at all (editor-snapshot.js reads `$from` and nothing else). The gutter
// handle follows `activeBlock`, so it never appeared.
//
// What the writer sees: they tap the name of their table, the keyboard
// comes up, they can type — and the one control that would let them turn
// it into something else, move it, or pin it is simply absent. Every other
// way into a block offers it.
//
// ── WHY A DOM WALK, AND NOT A PROSEMIRROR ANSWER ──────────────────────
//
// There is no selection to ask. `view.posAtDOM` can map an element to a
// document position, but only once something has decided WHICH element to
// map — and the focused input is several levels inside the node's view
// (a caption inside a header inside the table's wrapper). The decision is
// "walk up to the child of the editor root", which is a DOM fact, which is
// why it is here and testable rather than inline in a component where
// nothing can reach it (CLAUDE.md's first testing rule).
//
// ── WHAT IT REFUSES ───────────────────────────────────────────────────
//
// An element outside the editor entirely — a toolbar button, a sheet's
// field. Those take focus constantly and none of them is a block; answering
// one would park the handle beside whatever block happened to be nearest
// the last time the caret was in the doc.

/**
 * The top-level block element containing a focused node.
 *
 * @param {Element|null} target  the focused element
 * @param {Element|null} root    the editor's own `.ProseMirror` element
 * @returns {Element|null} the child of `root` that contains `target`, or
 *   null when the focus is not inside the editor at all.
 */
export function blockElementFor(target, root) {
  if (!target || !root) return null;
  if (target === root) return null;
  if (!root.contains(target)) return null;
  let el = target;
  while (el && el.parentElement && el.parentElement !== root) {
    el = el.parentElement;
  }
  // A text node's parent can be the root itself, which is not a block.
  return el && el.parentElement === root ? el : null;
}

/**
 * Whether a focused element is one whose block the handle should follow.
 *
 * PROSE IS NOT IN HERE, and that is the whole point: when the caret is in
 * prose the selection already answers, `computeSnapshot` is right, and a
 * second opinion derived from the DOM could only disagree with it. This is
 * for the focus a NodeView takes for itself — a title input, a cell's own
 * field — which the selection cannot see.
 *
 * `contenteditable` is the test rather than a tag list: every one of these
 * titles is an `input` or a `textarea` today, but the question that
 * actually matters is whether ProseMirror is managing this focus, and a
 * future title built as its own contenteditable region would answer the tag
 * test wrongly while answering this one right.
 *
 * @param {Element|null} target
 * @returns {boolean}
 */
export function focusEscapesProse(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // An element ProseMirror explicitly does not manage.
  return target.getAttribute?.("contenteditable") === "false";
}
