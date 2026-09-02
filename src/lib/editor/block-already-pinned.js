// Is this block already kept?
//
// Two questions, and the content one alone was answering neither reliably.
// TipTapEditor's `existingPinContents` holds `pins.map(p => p.content)` —
// what was STORED — while both callers passed the block's plain text. That
// matches for `handlePinBlock`'s note path, which stores `textContent`. It
// can never match for `quickPinFromCursor`, which stores the node's JSON:
// the set holds JSON strings and the lookup asks with prose, so the guard
// missed and a second press re-stamped the node.
//
// That is not cosmetic. A node holds ONE `pinId`; `confirmPin` overwrites
// it, and `refresh_pin_caches` then orphans the pin whose id left the saved
// `content_json`. So pressing pin twice on the same block did not add a pin,
// it took one — the writer keeps the pin (its cache survives, per the pin
// pointer clause) and loses which block it came from.
//
// The stamp is the exact answer and it is already in the DOM: pin-id.js
// renders `data-pin-id` for any node carrying one. The content check stays
// alongside it because it answers a different and still useful question —
// this same text is kept somewhere else — which the stamp cannot see.
//
// The mobile shell reached the stamp rule independently and keys on the node
// attribute rather than the DOM (src/shell/pin-intent.js).

/**
 * @param {{pinId?: string|null, text?: string, pinnedContents?: Set<string>}} block
 * @returns {boolean} true when the pin affordance should read as already kept
 */
export function blockAlreadyPinned({ pinId = null, text = "", pinnedContents } = {}) {
  // The stamp: exact, and the only one of the two that survives the writer
  // rewording the block after keeping it.
  if (pinId) return true;

  // The content match: weaker, and deliberately kept. It is the only thing
  // that can say "these words are already kept somewhere else" — a block
  // pasted from a page whose pin lives on another one carries no stamp.
  if (!pinnedContents || !text) return false;
  return pinnedContents.has(text);
}
