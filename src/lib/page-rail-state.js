// page-rail-state.js — publishes whether the page currently on screen sits
// at the right edge of its rail (no next page to pull in).
//
// The edge-swipe gesture lives in App.svelte, outside Page.svelte's tree,
// and lib/swipe-intent.js needs this boolean to tell a "nothing further
// along the rail" swipe from a "there's a next page" swipe. Page.svelte
// already computes the identical boundary in navigateNext() — idx >= 0 &&
// idx === railFocuses.length - 1 — to decide whether Ctrl/Cmd+Right should
// move the rail or spawn a page; this store mirrors that same state out
// rather than re-deriving it from scratch at the App level.
//
// Page.svelte is the only writer. App.svelte is the only reader (via
// get(), same pattern as keyboard-state.js's keyboardOpen).
import { writable } from "svelte/store";

export const atLastPage = writable(false);
