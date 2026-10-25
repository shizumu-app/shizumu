// Which node in a document IS a pin.
//
// A pinned block carries `attrs.pinId`. So does a `pinRef` — an @-mention of
// a pin — because it has to name the pin it points at. Every walk that asks
// "where is this pin's node" must skip the mention: taking it for the block
// rewrote the pin's content with the mention and moved the pin to the page
// that only mentioned it. commands.rs `is_pin_mention` is the backend's copy.

const MENTION = "pinRef";

/** @param {any} node  a TipTap JSON node, or a ProseMirror node */
function typeName(node) {
  return typeof node?.type === "string" ? node.type : node?.type?.name;
}

/**
 * Is this node a pin's own block (optionally: this pin's)?
 * @param {any} node
 * @param {string} [pinId]
 */
export function holdsPin(node, pinId) {
  const id = node?.attrs?.pinId;
  if (!id || typeName(node) === MENTION) return false;
  return pinId === undefined || id === pinId;
}

/** Is this node an @-mention of a pin? */
export function isPinMention(node) {
  return typeName(node) === MENTION;
}
