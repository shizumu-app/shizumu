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

/** What a pin over a selection says when it cannot pin, on both trees. The control
 *  used to go dead on such a range with nothing said, and a writer who
 *  selected three blocks with one already pinned read the dead button as
 *  "pin is not working" (2026-10-28). A single block that is already
 *  pinned keeps the quiet answer above: its dimmed `pin` says "kept". A
 *  range is the writer's own act, made a moment ago, and deserves words. */
export const PART_PINNED = "part of this is already pinned. unpin it first, or select around it.";

/**
 * Does this block hold a pin anywhere — its own stamp, or a block inside
 * it (a pinned paragraph indented into a list keeps its stamp one level
 * down)? Stamping the outer block over an inner pin hides the inner one
 * from the save's walk, which stops at the outer stamp, and orphans it.
 * A `pinRef` is a mention of a pin, not one (`holdsPin`).
 * @param {any} node  a ProseMirror node or TipTap JSON
 * @returns {boolean}
 */
export function holdsAnyPin(node) {
  const isPin = (n) => holdsPin(n);
  if (!node) return false;
  if (isPin(node)) return true;
  if (typeof node.descendants === "function") {
    let found = false;
    node.descendants((n) => {
      if (found) return false;
      if (isPin(n)) found = true;
      return !found;
    });
    return found;
  }
  return Array.isArray(node.content) && node.content.some(holdsAnyPin);
}

/**
 * Every pin id stamped on this block or inside it, mentions excluded. A
 * stamp can outlive its pin (unpinning leaves it on the page by design), so
 * a caller that must know whether a block still holds a LIVE pin checks
 * these ids against the pins, as `pinAlreadyHolds` does
 * (src/lib/editor/block-already-pinned.js).
 * @param {any} node  a ProseMirror node or TipTap JSON
 * @returns {string[]}
 */
export function stampedPinIds(node) {
  const ids = new Set();
  const take = (n) => { if (holdsPin(n)) ids.add(n.attrs.pinId); };
  if (!node) return [];
  take(node);
  if (typeof node.descendants === "function") node.descendants((n) => { take(n); return true; });
  else {
    const walk = (n) => (Array.isArray(n?.content) ? n.content : []).forEach((c) => { take(c); walk(c); });
    walk(node);
  }
  return [...ids];
}
