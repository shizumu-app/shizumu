// The VR scene catalog. Each scene maps to a real app space plus a fixture
// that seeds its data. onboarding:true renders the onboarding flow (driven
// by the mock's check_onboarding_complete defaulting to false when the
// fixture seeds no completion). Ground was removed (memory now carries its
// data); lock-screen is deferred to a follow-up (needs extra app hooks; see
// plan note).
import { FIXTURES } from "./fixtures.js";

export const THEMES = ["cream", "white", "dark"];

// Interaction states a scene can be captured in, beyond the load-time one.
//
// Every scene used to be a single screenshot taken the moment the app
// settled, which meant anything you had to *do* something to see was
// invisible to the suite. That is where the phone bugs lived: block
// controls only exist after a reveal, the header only collapses once the
// keyboard is up, a sheet only covers content after you open it.
//
// The capture spec drives these with real input (tests/vr/states.js) —
// there is deliberately no code here that puts the app into a state, since
// that would test the hook rather than the path.
export const STATES = {
  KEYBOARD: "keyboard",
  PIN_PANEL: "pin-panel",
  WHAT_SETTLED: "what-settled",
  BLOCK_TITLE_TOUCH: "block-title-touch",
  // Gutter-polish pass: the chip-less touch handle (touch-block-handle.js)
  // renders "+" only on an EMPTY block, into the left gutter — this state
  // proves that glyph and position.
  TOUCH_INSERT_HANDLE: "touch-insert-handle",
  // Gutter-polish pass, the actual bug fix ("tap on block does not show
  // the toolbar in the left space"): a tap on a chip-less block that
  // already has content reveals that block's pin/copy/delete controls in
  // the gutter — the same .block-handles column desktop hover populates,
  // just touch-triggered (see TipTapEditor.svelte's handleEditorPointerDown
  // → revealBlockHandlesForNode). This replaces the earlier BottomSheet
  // path a chip-less block used to reach via a synthetic "⋯" handle — that
  // handle is gone; a plain tap on the block itself is the whole gesture
  // now. Deliberately targets the FIRST (one-line) fixture paragraph, the
  // tallest-risk case: three stacked controls next to a single text line
  // are taller than the block itself, so this is the capture that proves
  // the overflow spills down the gutter rather than over any text.
  // A board's own actions sheet (its .block-type-chip, unchanged by this
  // pass) has no dedicated state here — page-board-content below only
  // drives BLOCK_TITLE_TOUCH, and always has.
  //
  // The value MUST be "block-handles" — TipTapEditor.svelte's
  // armTouchHandleHide() freezes its own auto-hide timer keyed on exactly
  // this string via document.documentElement.dataset.vrState, so the VR
  // harness can photograph the reveal before it clears itself.
  BLOCK_HANDLES_TOUCH: "block-handles",
  // /chart builder modal (ChartBuilder.svelte), reached the real way: type
  // "/chart" in the editor and pick the row from the slash menu, same as a
  // user would — no hook that sets chartBuilderState directly, which is a
  // private local in TipTapEditor.svelte with no VR seam of its own, and
  // reaching in from outside would test the hook rather than the slash-menu
  // path the reported bug actually travels through.
  CHART_BUILDER: "chart-builder",
  // Same, plus the soft keyboard up (shrunk viewport, same technique as
  // KEYBOARD above) — the reported bug involved fields with the IME open.
  CHART_BUILDER_KEYBOARD: "chart-builder-keyboard",
};



export const SCENES = {
  "page-blank": {
    space: "page", fixture: FIXTURES.emptyPage, onboarding: false,
    states: [STATES.TOUCH_INSERT_HANDLE, STATES.CHART_BUILDER, STATES.CHART_BUILDER_KEYBOARD],
  },
  "page-content": {
    space: "page", fixture: FIXTURES.pageWithContent, onboarding: false,
    states: [STATES.BLOCK_HANDLES_TOUCH, STATES.KEYBOARD, STATES.PIN_PANEL, STATES.WHAT_SETTLED],
  },
  "page-board-content": {
    space: "page", fixture: FIXTURES.pageWithBoardContent, onboarding: false,
    states: [STATES.BLOCK_TITLE_TOUCH],
  },
  "memory-list": { space: "memory", fixture: FIXTURES.memoryWithPages, onboarding: false },
  "pin-view": { space: "memory", fixture: FIXTURES.pinsRich, onboarding: false },
  "trail-continuous": { space: "page", fixture: FIXTURES.continuousTrail, onboarding: false },
  "dead-image-ref": { space: "page", fixture: FIXTURES.deadImageRef, onboarding: false },
  "onboarding": { space: "page", fixture: FIXTURES.emptyPage, onboarding: true },
};

/** The interaction states declared for a scene (never undefined). */
export function sceneStates(scene) {
  return Array.isArray(scene?.states) ? scene.states : [];
}

export function getScene(id) {
  const s = SCENES[id];
  if (!s) throw new Error(`unknown VR scene: ${id}`);
  return s;
}
