// gesture-arming.js — whether a view-switch gesture may arm, decided at
// touchstart. Allowlist, not blacklist: the flick used to be suppressed by
// an ignoreSelector list that every new overlay had to remember to join —
// settings didn't, and scrolling it switched views. Now the gesture arms
// only when nothing is open AND the scroll container has nowhere left to
// go in the flick direction (scroll wins; canon's swipe-up-to-memory
// still works from the settled position). keyboardOpen is a third gate:
// the soft keyboard being up means the user is typing, and a flick that
// lands on the editor mid-keystroke (e.g. a fast return-key drag) must
// never be read as swipe-to-memory.
export function gestureArmed({ overlayOpen, scrollAtBoundary, keyboardOpen = false }) {
  return !overlayOpen && !keyboardOpen && !!scrollAtBoundary;
}

export function atScrollBoundary(el, direction) {
  if (!el) return true;
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 1) return true; // nothing scrolls
  if (direction === "up") return el.scrollTop >= max - 1; // at bottom
  return el.scrollTop <= 1; // "down" flick needs the top
}
