// Whether the phone header collapses to its one-line pill.
//
// The header collapses while the soft keyboard is up so the writing surface
// keeps its room. That is right when the user is typing ON THE CANVAS — and
// destructive when they are typing into an overlay the header itself owns.
//
// The trail sheet lives inside the header subtree (Page.svelte's `.eh` row
// holds LineageSelector, which renders the BottomSheet). Collapsing applies
// `display: none` to that row. An element inside a `display: none` subtree is
// not rendered and cannot hold focus, so the browser drops focus and the IME
// closes. The user sees the keyboard flash open and vanish the instant they
// tap the trail field, over and over, with the sheet still sitting there.
//
// That bug was diagnosed once before as an UNMOUNT problem and "fixed" by
// switching from `{#if}` to `display: none` (see the comment in Page.svelte's
// header markup). It was never fixed: hiding a subtree kills focus exactly as
// thoroughly as unmounting it. The real rule is that the header must not
// collapse while it is hosting the thing the user is typing into.
//
// Overlay depth is the navstack's depth — every sheet, modal and panel pushes
// onto it — so "an overlay is open" covers the trail sheet, the date sheet,
// the pin panel and anything added later, without this module having to know
// what any of them are.

/**
 * @param {object} state
 * @param {boolean} state.isPhone       phone-sized viewport
 * @param {boolean} state.keyboardOpen  soft keyboard is covering the viewport
 * @param {number}  state.overlayDepth  navstack depth (0 = nothing open)
 * @returns {boolean} true when the header should collapse to its pill
 */
export function shouldCollapseHeader({ isPhone, keyboardOpen, overlayDepth = 0 }) {
  if (!isPhone || !keyboardOpen) return false;
  // An open overlay is, or contains, whatever has focus. Collapsing now would
  // hide it mid-type and drop the keyboard.
  return overlayDepth === 0;
}
