// Does this key turn the page, and which way?
//
// Page.svelte listens on the window, so it saw ctrl+←/→ typed inside the
// writing and turned the page — the writer, moving the caret by a word as
// every other editor does, was taken to yesterday mid-sentence (GitHub
// issue #2). In text, the arrows belong to the text. mod+PageUp/PageDown
// turns the page from anywhere, so the writing still has a way to do it.

const TEXT = ".ProseMirror, input, textarea, [contenteditable]";

/**
 * @param {{key: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altKey?: boolean, target?: any}} event
 * @returns {-1 | 0 | 1} the page step, or 0 when the key is not a page turn
 */
export function pageNavStep(event) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return 0;
  if (event.key === "PageUp") return -1;
  if (event.key === "PageDown") return 1;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return 0;
  if (event.target?.closest?.(TEXT)) return 0;
  return event.key === "ArrowLeft" ? -1 : 1;
}
