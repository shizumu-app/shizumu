// block-pinnable.js — does this block hold anything a pin could keep?
//
// The third device pass: "pin a block does not appear as option if title
// not set at creation". The photograph was a q&a board titled `Cccccc`
// with its question and answer still empty, and its block sheet offered
// title · turn into · move up · move down · delete — no pin, and no copy.
//
// The shared rule (block-pin-guard.js, `mayPinBlock`) asks the node's
// TEXT, and a board's title is not text: it lives in `attrs.blockTitle`,
// which `textContent` never walks. So a board the writer had named and
// not yet filled read as an empty line. That rule is shared with main and
// right for what it was written for — an empty paragraph, a divider — so
// the shell answers the one case it misses here rather than widening it:
// a board with a name the writer typed has content, because the name IS
// writing, and it is what the pin row will show (pin-intent.js takes
// `blockTitle` as its first answer for a title).
//
// Everything else is the shared rule's, unchanged: text that trims to
// something, or content that does not live in the text (an attachment, a
// chart).

/**
 * @param {object} args
 * @param {string} [args.text]              the node's textContent
 * @param {boolean} [args.isBoard]          `isBoardType(node.type.name)`
 * @param {string} [args.blockTitle]        `attrs.blockTitle`
 * @param {boolean} [args.hasNonTextContent] attachment or chart
 * @returns {boolean}
 */
export function blockPinnable({ text = "", isBoard = false, blockTitle = "", hasNonTextContent = false } = {}) {
  if (hasNonTextContent) return true;
  if (typeof text === "string" && text.trim() !== "") return true;
  return !!isBoard && typeof blockTitle === "string" && blockTitle.trim() !== "";
}
