// src/lib/bar-visibility.js — the MobileActionBar's visibility as a pure
// function of current state. The bar vanished until app-restart when a
// sheet's hideBar navstack entry outlived the sheet (never popped) — a
// latch. Deriving visibility per-render from live inputs (and sweeping
// stale entries on space change via navstack's navPopAll) leaves nothing
// to stick: there is no stored "hidden" flag anywhere for a stale entry
// to freeze.
export function barVisible({ hideBarNav, keyboardOpen }) {
  return !hideBarNav && !keyboardOpen;
}
