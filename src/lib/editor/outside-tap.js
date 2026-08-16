// outside-tap.js — the one decision behind "did this pointerdown land
// outside a given element." Used by slash-commands.js to dismiss the
// floating command menu on an outside tap: a phone has no Escape key, so
// without this the menu (createMenu()'s plain DOM node, appended straight
// to document.body — not inside the menu's own trigger element) was
// unclosable there once opened.
//
// Extracted per CLAUDE.md's testing rule ("decisions go in pure modules,
// not inside components") so the predicate can be unit-tested without a
// real Suggestion plugin, a ProseMirror view, or a mounted menu DOM node.

/**
 * isOutsideTap(event, containerEl) -> boolean
 *
 * @param {Event} event - a DOM event carrying a `target` (e.g. pointerdown).
 * @param {Element|null|undefined} containerEl - the element the tap must
 *   land inside of to count as "on the menu itself." null/undefined (menu
 *   not mounted, or already torn down) means every tap counts as outside.
 * @returns {boolean} true when the event's target is NOT inside containerEl
 *   — the signal to dismiss.
 */
export function isOutsideTap(event, containerEl) {
  if (!containerEl) return true;
  const target = event?.target;
  if (!(target instanceof Node)) return true;
  return !containerEl.contains(target);
}
