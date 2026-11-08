// block-state.js — what state a block is in, and what a toggle does to it.
// Spec: docs/superpowers/specs/2026-11-01-block-ids-and-meaning-design.md,
// "Block state (groundwork)".
//
// Two kinds of state, deliberately different:
//
//   STORED. A decision is `standing` until the writer says it is
//   `superseded`. That is a fact about the decision the words alone cannot
//   carry, so it lives on the node as `blockState`, with `blockStateAt`
//   (the local ISO date of the last change) beside it, and travels in
//   content_json like any attr: saved, synced, exported.
//
//   COMPUTED. A question is `open` while its answer is empty. That IS in the
//   words, so it is read off the node at render and never stored: storing it
//   would let the chip and the answer disagree.
//
// CLAUDE.md: decisions live in a pure module. The NodeView, the keymap and
// the decoration all ask this file; none of them decides on its own.

/** The states each type can be in. The first is the default. */
export const BLOCK_STATES = Object.freeze({
  decisionBlock: Object.freeze(["standing", "superseded"]),
});

/** @param {string} typeName @returns {readonly string[]|null} */
export function allowedStates(typeName) {
  return BLOCK_STATES[typeName] || null;
}

/** @param {string} typeName @returns {string|null} */
export function defaultState(typeName) {
  return allowedStates(typeName)?.[0] ?? null;
}

/** Does this type carry a stored state at all? */
export function carriesState(typeName) {
  return !!allowedStates(typeName);
}

/**
 * The state a block is in. A missing or unknown value reads as the default:
 * a decision written before 0.8.2 has no blockState and is standing, and a
 * value from a newer build this one does not know is not shown as garbage.
 * @param {string} typeName @param {any} value  @returns {string|null}
 */
export function stateOf(typeName, value) {
  const states = allowedStates(typeName);
  if (!states) return null;
  return states.includes(value) ? value : states[0];
}

/** The state after a toggle: the next one, wrapping. */
export function nextState(typeName, value) {
  const states = allowedStates(typeName);
  if (!states) return null;
  const i = states.indexOf(stateOf(typeName, value));
  return states[(i + 1) % states.length];
}

/** Local calendar date as YYYY-MM-DD: the day the writer changed it. */
export function isoDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The attrs a toggle writes: the next state and today's date. Every other
 * attr (blockId, pinId, blockTitle) is kept as it is.
 * @param {string} typeName @param {object} attrs @param {Date} [now]
 * @returns {object|null} null when the type carries no state
 */
export function toggledAttrs(typeName, attrs, now = new Date()) {
  const next = nextState(typeName, attrs?.blockState);
  if (!next) return null;
  return { ...(attrs || {}), blockState: next, blockStateAt: isoDate(now) };
}

/**
 * May the writer toggle it here? Read-only stays read-only: a past page
 * shows the chip, and the chip says what the decision was, but a tap on it
 * changes nothing.
 */
export function mayToggleState({ typeName, editable }) {
  return !!editable && carriesState(typeName);
}

/**
 * The chip's accessible name: what it is now and what pressing it does.
 * @param {string} state @param {string} next @param {boolean} editable
 */
export function stateChipLabel(state, next, editable) {
  return editable ? `decision ${state}. mark ${next}` : `decision ${state}`;
}

function textOf(node) {
  if (!node) return "";
  if (typeof node.textContent === "string") return node.textContent;
  if (typeof node.text === "string") return node.text;
  return Array.isArray(node.content) ? node.content.map(textOf).join("") : "";
}

function childAt(node, i) {
  if (!node) return null;
  if (typeof node.child === "function") return i < node.childCount ? node.child(i) : null;
  return Array.isArray(node.content) ? node.content[i] ?? null : null;
}

/**
 * Is this qaPair an open question: asked, and not yet answered?
 *
 * The spec says "answer paragraph empty". A pair whose question is empty
 * too is not open: it is a blank pair (a fresh q&a block, or the next pair
 * Enter just made), and an `open` chip on it would mark nothing anyone
 * asked. Whitespace counts as empty on both sides.
 *
 * Accepts a ProseMirror node or its JSON.
 * @param {any} qaPair  @returns {boolean}
 */
export function isOpenQuestion(qaPair) {
  if (!qaPair) return false;
  const typeName = qaPair.type?.name ?? qaPair.type;
  if (typeName !== "qaPair") return false;
  const question = textOf(childAt(qaPair, 0)).trim();
  const answer = textOf(childAt(qaPair, 1)).trim();
  return question !== "" && answer === "";
}
