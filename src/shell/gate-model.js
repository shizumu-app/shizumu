// The gates: what onboarding and lock show, and what their one control does.
//
// A "gate" is a surface that stands in FRONT of the shell rather than inside
// it — App.svelte's chain is onboarding → lock → the boot fork, and the fork
// sits below both on purpose (shell-boot.test.js asserts it, because a fork
// above the lock branch renders the shell over a locked database). So neither
// of these is a root, neither is a pushed screen, and neither has a nav bar
// or a tab bar: §2 gives them the bands with "nav bar hidden, content centred,
// bottom slot holds the primary action".
//
// ONE FUNCTION ANSWERS BOTH HALVES of a step, and that is the whole reason
// this module exists rather than two expressions inside ShellGate. Onboarding
// asks two questions of the same index — "what does the button say" and "does
// this tap finish" — and they are one off-by-one apart. Answered separately
// they can disagree, and both disagreements ship a visible defect: a last
// slide labelled `next` that completes onboarding anyway, or one labelled
// `begin` that shows another slide after it. `gateStep` returns `action` and
// `last` off one comparison, so there is nothing to keep in step.
//
// THE COPY HERE IS NEW, and deliberately not the desktop's. The desktop's six
// slides live in src/components/onboarding/slides/ and three of them carry
// the retired word (CLAUDE.md's "Retired word — sink"); retiring it there is
// its own spec, because all six have VR snapshot coverage a wording change
// would break. Nothing in this file is copied from them, so nothing here
// inherits it. Four slides rather than six: the canon's rule is fewest words,
// and a phone gate the writer taps through before they have written anything
// is the last place to spend two extra screens.
//
// Each body is the canon's own shape rather than a paraphrase — the write ·
// pin · trail verbs in order, then where the rest lives. The trail slide is
// CLAUDE.md's "Context clause (compressed, for copy)" almost verbatim, which
// is the one shape the canon says to reuse rather than re-derive.

/** @typedef {{id: string, title: string, body: string}} Slide */

/** @type {Slide[]} */
export const ONBOARDING_SLIDES = [
  {
    id: "write",
    title: "write",
    body: "write to think. every page starts empty, so nothing you write today has to be worth keeping.",
  },
  {
    id: "pin",
    title: "pin",
    body: "pin what matters. your thinking happens on the page. the pins are where you left it.",
  },
  {
    id: "trail",
    title: "trail",
    body:
      "a trail is for a project, not a day: a book, a job search, anything you'll come back to tomorrow. " +
      "choose a trail and the page picks up context: the pins you already kept there, already on the page.",
  },
  {
    id: "memory",
    title: "memory",
    body: "everything else stays in memory. search it, or open one trail, one date, pages, or pins.",
  },
];

/**
 * What this gate is showing right now, and what its one control does.
 *
 * Total over the two kinds this shell has: neither ever resolves to a step
 * with no action, which is what lets `toolbarFor` take a single `gateAction`
 * input instead of the liveness-plus-content pair its suggestion row needs.
 * An unknown kind resolves to no action at all rather than to a guess — a
 * band with a button that does nothing is worse on a gate than no band.
 *
 * @param {object} input
 * @param {"onboarding"|"lock"|string} input.kind
 * @param {number} [input.index]  which onboarding slide; ignored by lock
 * @returns {{slide: Slide|null, action: string|null, last: boolean}}
 */
export function gateStep({ kind, index = 0 }) {
  if (kind === "lock") return { slide: null, action: "unlock", last: true };
  if (kind !== "onboarding") return { slide: null, action: null, last: false };
  // Clamped rather than trusted. `index` is host state, and an index past
  // the end would resolve `slide` to undefined and render an empty gate —
  // a screen with a title, no words and one button, which reads as a load
  // that failed rather than as the end of onboarding.
  const at = Math.min(Math.max(index, 0), ONBOARDING_SLIDES.length - 1);
  const last = at === ONBOARDING_SLIDES.length - 1;
  return {
    slide: ONBOARDING_SLIDES[at],
    action: last ? "gate-begin" : "gate-next",
    last,
  };
}

/**
 * Where the primary action leaves this step.
 *
 * Reads `last` off `gateStep` rather than recomputing the comparison, so the
 * label and the destination cannot come apart — see the header.
 *
 * @param {object} input
 * @param {"onboarding"|"lock"|string} input.kind
 * @param {number} [input.index]
 * @returns {{done: boolean, index: number}}  `done` means the gate is over
 */
export function gateAdvance({ kind, index = 0 }) {
  const { action, last } = gateStep({ kind, index });
  // `!action` is the unknown-kind arm, and it says DONE rather than
  // advancing. A kind with no step to show has no next step either, and the
  // alternative — falling through to `index + 1` — walks an unknown gate's
  // index up for as long as anything keeps pressing, which on a surface
  // with one control is for as long as the user is stuck on it.
  if (!action || last) return { done: true, index };
  return { done: false, index: index + 1 };
}
