// Keeps `--app-height` equal to the viewport the user can actually see.
//
// The shell is a fixed-height flex column: header, scrolling canvas,
// bottom bar. That only works if its height matches the visible area. With
// a soft keyboard up it didn't. `100dvh` resolves against the LAYOUT
// viewport, and whether the keyboard shrinks that is not ours to decide —
// it depends on the viewport meta's `interactive-widget` mode and, on
// Android, on the activity's windowSoftInputMode, which lives in a
// generated manifest CI rebuilds from scratch. Under the default
// (`resizes-visual`) the layout viewport keeps the full screen height, so
// the shell stayed taller than the screen, and focusing the bottom-anchored
// "what settled" field made the browser scroll the whole shell up to reveal
// it — pushing the header and every block off the top and leaving the user
// looking at the empty tail of the canvas.
//
// visualViewport.height is the one number that means "what's visible" in
// every mode, so the height is driven from it directly rather than from a
// unit whose meaning changes underneath us.

/**
 * Start syncing `--app-height` on <html>. Fires once immediately.
 * @param {Window} [win]
 * @returns {() => void} unsubscribe
 */
export function syncAppHeight(win = typeof window !== "undefined" ? window : null) {
  if (!win || !win.document) return () => {};
  const root = win.document.documentElement;

  const apply = () => {
    const h = win.visualViewport?.height ?? win.innerHeight;
    if (!h) return;
    root.style.setProperty("--app-height", `${Math.round(h)}px`);
    // Under resizes-visual the browser scrolls the layout viewport to keep
    // a focused field visible. Now that the shell is exactly the visible
    // height there is nothing legitimate to scroll to, and any offset is
    // the shell being dragged out from under the user — put it back.
    if (win.scrollY) win.scrollTo(0, 0);
  };

  apply();

  const vv = win.visualViewport;
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  win.addEventListener("resize", apply);
  win.addEventListener("orientationchange", apply);

  return () => {
    vv?.removeEventListener("resize", apply);
    vv?.removeEventListener("scroll", apply);
    win.removeEventListener("resize", apply);
    win.removeEventListener("orientationchange", apply);
  };
}
