// block-pin-guard.js — may this block be pinned at all?
//
// The bug this exists for: create a `/bullet`, type NOTHING, hover, click
// the gutter's pin handle. The pin popup opened, and confirming produced a
// real pin titled "list" whose entire content was the word "list".
//
// handlePinBlock's guard read the emptiness off the DOM:
//
//     const blockText = hoveredBlock.textContent?.trim() || "";
//     if (!blockText) return;
//
// `hoveredBlock` is the block SHELL, and its NodeView chrome is made of real
// text nodes inside it — `.block-type-chip` (block-shell.js, and the one
// table-shell-view.js renders itself), a code block's copy button. Measured
// in a live editor:
//
//     empty bullet shell.textContent  →  "list"
//     filled bullet shell.textContent →  "milkeggslist"
//     code block shell.textContent    →  "copyconst sink = truecode"
//
// So the guard could never fire on a board: the chip alone kept every empty
// one "non-empty". Reading the ProseMirror NODE instead is chrome-free by
// construction — the chip is not in the document, it is decoration the
// NodeView draws.
//
// CLAUDE.md: decisions live in pure modules, not inside a `.svelte` file
// where nothing can reach them. This is that decision.

/**
 * mayPinBlock — is there anything here worth pinning?
 *
 * @param {object} args
 * @param {string|null|undefined} args.nodeText - `topLevelNode.textContent`,
 *   the block's text as ProseMirror sees it: chrome-free, and (see below)
 *   blind to atoms. Pass `null`/`undefined` when the DOM block could not be
 *   mapped to a top-level node at all; `elementText` is then the only fact
 *   available and is used instead. That fallback is not a compromise on the
 *   chip: a block with no resolvable node is not a NodeView shell, so it has
 *   no chrome to leak.
 * @param {string|null|undefined} args.elementText - `hoveredBlock.textContent`,
 *   used only for that fallback.
 * @param {boolean} args.hasNonTextContent - this block's content does not
 *   live in its text, so "no text" says nothing about whether it is empty.
 *   Two cases today, and the caller passes `isAttachment || isChart`:
 *
 *     - an attachment (`/image`, `/file`) is an inline ATOM, so
 *       `node.textContent` skips it entirely — an image line has no node
 *       text at all, by construction, and is still exactly the thing the
 *       user meant to pin. handlePinBlock's `isBoard || isAttachment` path
 *       stores the NODE JSON rather than text, so it never wanted text.
 *     - a chart is `atom: true` too (chart.js), with its whole dataset in
 *       attrs. A chart full of data has no more node text than an empty one.
 *
 *   NOT exempt, deliberately: `/divider`. A horizontalRule is an atom whose
 *   content is empty everywhere — text, attrs, anywhere — so there is
 *   nothing to pin and it stays unpinnable, which is the documented
 *   behaviour and not a bug to fix here.
 * @returns {boolean} true when the pin flow may proceed.
 */
export function mayPinBlock({
  nodeText,
  elementText,
  hasNonTextContent = false,
} = {}) {
  if (hasNonTextContent) return true;
  const text = typeof nodeText === "string" ? nodeText : (typeof elementText === "string" ? elementText : "");
  return text.trim() !== "";
}

// ── who gets the attachment exemption ─────────────────────────────────
//
// The second bug this file exists for, same shape as the first. The caller
// used to answer `hasNonTextContent` for attachments by sniffing a CSS
// class off the rendered DOM:
//
//     el.classList.contains("attachment-block") || el.querySelector(".attachment-block")
//
// AttachmentBlock.svelte has TWO render branches and only one of them
// carries that class. A FILE renders `<span class="attachment-block">`; an
// IMAGE renders `<div class="local-image-wrap attachment-image">`, which
// has it nowhere in the subtree — and collapsed, it renders a filename chip
// instead. So the exemption never fired for an image, and since an
// attachment is `inline: true, atom: true` (attachment.js) the paragraph
// holding one has no node text either. Not exempt + no text = an EMPTY
// LINE: the gutter offered `["insert"]` on an image and nothing else, while
// the identical file line offered pin/copy/delete.
//
// `Ctrl+P` pinned both correctly the whole time, because that path never
// looked at the DOM — it read the node. Two pin paths disagreeing about
// what an attachment is, with the node-based one right. These two exports
// are that read, so both paths ask the same question and the answer no
// longer depends on which branch rendered, or on whether it is collapsed.

/** The type name of a PM node or of a node's JSON form. */
function typeNameOf(node) {
  const t = node?.type;
  if (typeof t === "string") return t;              // JSON: { type: "attachment" }
  return typeof t?.name === "string" ? t.name : null; // PM node: node.type.name
}

/** A node's children, PM or JSON. A PM node's `content` is a Fragment (not
 *  an array), so the array branch only ever catches JSON. */
function childrenOf(node) {
  if (Array.isArray(node?.content)) return node.content;
  if (typeof node?.childCount === "number" && typeof node?.child === "function") {
    const out = [];
    for (let i = 0; i < node.childCount; i += 1) out.push(node.child(i));
    return out;
  }
  return [];
}

/**
 * isAttachmentBlockNode — does this top-level block hold an attachment?
 *
 * True for a bare attachment, for the paragraph that wraps one (the normal
 * shape — attachment is schema-inline), and for a line mixing text with an
 * inline file. That last case is deliberate and matches the DOM sniff it
 * replaces: it feeds `hasNonTextContent`, and a mixed line has real text
 * anyway, so widening here changes no answer it used to get right.
 *
 * @param {object|null|undefined} blockNode - a ProseMirror node or its JSON.
 * @returns {boolean}
 */
export function isAttachmentBlockNode(blockNode) {
  if (!blockNode) return false;
  if (typeNameOf(blockNode) === "attachment") return true;
  return childrenOf(blockNode).some((child) => isAttachmentBlockNode(child));
}

/**
 * soleAttachmentNode — the attachment when the line is ONLY that attachment.
 *
 * A line that is nothing but a file pins as a file, titled from its
 * filename. A line mixing text with an inline file pins as a note — the
 * whole line — with the file riding along inside the note's JSON. This is
 * the test that tells them apart, and it is the same expression
 * quickPinFromCursor used to carry as its own copy.
 *
 * @param {object|null|undefined} blockNode - a ProseMirror node or its JSON.
 * @returns {object|null} the attachment node, or null.
 */
export function soleAttachmentNode(blockNode) {
  if (!blockNode) return null;
  if (typeNameOf(blockNode) === "attachment") return blockNode;
  const children = childrenOf(blockNode);
  if (children.length === 1 && typeNameOf(children[0]) === "attachment") return children[0];
  return null;
}
