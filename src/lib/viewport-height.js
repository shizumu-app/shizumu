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
// The visible viewport's height is the one number that means "what's
// visible" in every mode, so the height is driven from it directly rather
// than from a unit whose meaning changes underneath us.
//
// The actual listener now lives in keyboard-state.js — the app's single
// subscriber to that browser state, which also publishes `--kb-inset` and
// the `keyboardOpen` store. This file re-exports it under its original name
// so existing callers keep working unchanged.
export { startKeyboardState as syncAppHeight } from "./keyboard-state.js";
