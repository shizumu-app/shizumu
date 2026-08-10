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
  BLOCK_HANDLES: "block-handles",
  KEYBOARD: "keyboard",
  PIN_PANEL: "pin-panel",
  WHAT_SETTLED: "what-settled",
};



export const SCENES = {
  "page-blank": { space: "page", fixture: FIXTURES.emptyPage, onboarding: false },
  "page-content": {
    space: "page", fixture: FIXTURES.pageWithContent, onboarding: false,
    states: [STATES.BLOCK_HANDLES, STATES.KEYBOARD, STATES.PIN_PANEL, STATES.WHAT_SETTLED],
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
