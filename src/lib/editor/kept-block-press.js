// A press on the gutter's pin handle of a block that is already kept. It used
// to say "already pinned" and stop, which left the block's own control a dead
// end: unpinning meant finding the row in the pins panel. Unpinning asks first,
// everywhere (PinRow, the phone's sheet), and in a gutter the ask is the second
// press on the same pin while the first is still fresh.

export const KEPT_PRESS_LABEL = "already pinned. press again to unpin";
export const KEPT_PRESS_FRESH_MS = 3000;

/** @returns {{action:"ask"|"unpin", armedFor:string|null}} */
export function keptBlockPress(pinId, armedFor) {
  if (pinId && armedFor === pinId) return { action: "unpin", armedFor: null };
  return { action: "ask", armedFor: pinId ?? null };
}

/** The stored pin a block answers to: its stamp first, its content otherwise. */
export function pinHeldBy(pins, { pinId = null, content = "" } = {}) {
  const all = pins || [];
  return all.find((p) => pinId && p.id === pinId) ?? all.find((p) => content && p.content === content) ?? null;
}
