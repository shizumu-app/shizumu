// May a bare Escape send the writer back to the page?
//
// Page.svelte listens for Escape on the window so that, from anywhere else
// on the screen, Escape puts the caret back in the writing. It used to ask
// only whether an overlay was open, and the window sees every Escape the
// editor sees — after the editor has acted on it. So an Escape that had
// just walked the caret out of a recipe's steps into its result slot was
// followed by focus("end"), and the caret landed at the bottom of the page,
// out of the recipe entirely. Any block mid-page did the same.
//
// ProseMirror prevents the default of a key it handled, which is the
// answer: an Escape already spent on something is not a request to come
// back. Nor is one pressed in the editor itself — the writer is already
// there, and the end of the doc is not where they were.

/**
 * @param {{key: string, defaultPrevented?: boolean, target?: any}} event
 * @param {{overlayOpen: boolean}} state
 * @returns {boolean}
 */
export function escapeReturnsToPage(event, { overlayOpen }) {
  if (event.key !== "Escape" || overlayOpen) return false;
  if (event.defaultPrevented) return false;
  const inEditor = !!event.target?.closest?.(".ProseMirror");
  return !inEditor;
}
