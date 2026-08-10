// Rail appearance order — a session-scope map of focus_id → first-appeared
// timestamp. Used by Page.svelte's loadRailFocuses to sort the rail in
// "order of appearance today" so a continuous canonical picked after a
// discrete page sits to its right rather than jumping to the leftmost slot.
//
// Why this module-level singleton: Page.svelte unmounts when the user
// navigates to Memory and remounts on return. A `let` inside Page would
// reset to an empty Map on every remount, which makes the rail re-sort
// by `created_at` fallback — pushing continuous canonicals (old
// created_at) to the leftmost slot and breaking the user's mental
// position for keyboard navigation. A module-scope Map survives those
// remounts. Cleared only on full app reload.

const appearanceOrder = new Map();

export function recordAppearance(id) {
  if (!id) return;
  if (!appearanceOrder.has(id)) {
    appearanceOrder.set(id, Date.now());
  }
}

// Force-rewrite the appearance timestamp. Used when the user deliberately
// picks a continuous canonical via trail assignment: without this, a
// canonical seen earlier this session keeps its old timestamp and sorts
// to the leftmost rail slot instead of staying where the user was working.
export function bumpAppearance(id) {
  if (!id) return;
  appearanceOrder.set(id, Date.now());
}

export function getAppearance(id) {
  return appearanceOrder.get(id);
}

export function hasAppearance(id) {
  return appearanceOrder.has(id);
}
