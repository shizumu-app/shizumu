// What the editor last told the shell, for the one surface allowed to look
// at it: the diagnostic readout (ViewportReadout, off in every normal
// build).
//
// WHY IT EXISTS. On a Galaxy A34 the gutter handle stopped appearing. Three
// things read `activeBlock` — the handle, the `turn into` chip and `pin` —
// and the photographs showed two different failures wearing one symptom: in
// one, the chip was there and the handle was not (so the handle was in the
// DOM and invisible); in the next, the chip was gone and `undo` was dead
// (so there was no snapshot at all). Those are different hunts, and nothing
// in a photograph separates them.
//
// A SECOND SUBSCRIBER IS WHAT THIS AVOIDS. EditorCore publishes its
// snapshot to exactly one consumer — PageScreen's effect — which forwards
// it to ShellApp. A readout that subscribed to the editor itself would be a
// second reader of live state, which is the rule keyboard-state.js already
// carries for the visual viewport and for the same reason: two readers
// disagree, and their disagreements are user-visible bugs. So ShellApp
// publishes here from the value it already holds, and the overlay reads
// this. Inert when nothing is rendering the readout: one store write per
// editor transaction, which is the cadence the snapshot already has.
import { writable } from "svelte/store";

/** @type {import("svelte/store").Writable<{
 *   activeBlock: {type: string, pos: number}|null,
 *   canUndo: boolean,
 *   seen: boolean,
 * }>} */
export const editorReadout = writable({
  // `seen` is the whole point of the shape. A snapshot that has never
  // arrived and a snapshot that arrived empty are indistinguishable by
  // their fields and are opposite diagnoses: the first means the
  // subscription never delivered, the second means the editor really has
  // nothing to report. The readout prints them differently.
  activeBlock: null,
  canUndo: false,
  seen: false,
});

/** Why the gutter handle is or is not on screen, from the one component
 *  that decides it.
 *
 *  PageScreen's `gutterHandle` has five ways to answer null and they are
 *  five different hunts: no block, no canvas element, no editor, a
 *  document position the editor no longer has, and a position whose DOM is
 *  not an element. From a photograph they are one symptom — no dots — and
 *  two rounds of this bug were spent choosing between them by reasoning.
 *
 *  PageScreen WRITES here; it does not read anything new. That is the same
 *  ownership rule the store above follows: the component that makes the
 *  decision is the one that reports it, and a diagnostic never becomes a
 *  second source for a decision somebody else already makes.
 *
 *  @type {import("svelte/store").Writable<{
 *    why: "ok"|"no-block"|"no-canvas"|"no-editor"|"bad-pos"|"not-element",
 *    top: number|null,
 *  }>}
 */
export const handleReadout = writable({ why: "no-block", top: null });
