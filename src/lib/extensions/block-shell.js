// block-shell.js — shared chrome factory for block NodeViews.
//
// Builds the outer wrapper DOM (div.block-shell) with a title slot, a
// type-appropriate content DOM element, and a block-type chip. Returns
// { dom, contentDOM, titleSlot, chip, setTitle }.
//
// This factory is intentionally free of editing logic (no commit timers, no
// keyboard handlers). Those responsibilities remain in block-title.js. The
// one dispatch it does own is the chip's own tap -> shizumu-block-actions
// (see dispatch-block-actions.js) — the chip IS the block-actions handle,
// so wiring that here rather than in every NodeView that calls this
// factory keeps it a single dispatch site. The view / getPos / ext
// arguments are accepted for forward-compatibility but are not used in
// this minimal implementation.

import { nodeKind, nodeFamily } from "../pin-display.js";
import { dispatchBlockActionsEvent } from "./dispatch-block-actions.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createContentDOM(typeName) {
  let el;
  if (typeName === "list") {
    el = document.createElement("ul");
    el.dataset.list = "";
  } else if (typeName === "blockquote") {
    el = document.createElement("blockquote");
  } else if (typeName === "qaBlock") {
    el = document.createElement("div");
    el.dataset.type = "qa-block";
    el.classList.add("qa-block");
  } else if (typeName === "recipeBlock") {
    el = document.createElement("div");
    el.dataset.type = "recipe-block";
    el.classList.add("recipe-block");
  } else if (typeName === "decisionBlock") {
    el = document.createElement("div");
    el.dataset.type = "decision-block";
    el.classList.add("decision-block");
  } else {
    el = document.createElement("div");
  }
  el.classList.add("board-content");
  return el;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * createBlockShell({ node, view, getPos, ext })
 *
 * @param {object} node    - ProseMirror Node (or compatible fake in tests)
 * @param {object} view    - EditorView (accepted for forward-compat; unused here)
 * @param {Function} getPos - () => number (accepted for forward-compat; unused here)
 * @param {object} ext     - Tiptap extension instance (forward-compat; unused here)
 * @returns {{ dom, contentDOM, titleSlot, chip, setTitle }}
 */
export function createBlockShell({ node, view, getPos, ext }) {
  const typeName = node.type.name;

  // Outer wrapper
  const dom = document.createElement("div");
  dom.className = "block-shell";
  dom.dataset.type = typeName;
  dom.dataset.board = typeName;

  // Title slot — native <input> so it is an atomic focus target inside the
  // outer contenteditable region (a nested contenteditable div would silently
  // lose focus to the outer editor when empty on WebKit/webkit2gtk).
  const titleSlot = document.createElement("input");
  titleSlot.type = "text";
  titleSlot.className = "board-title-slot";
  titleSlot.placeholder = "+ title";
  titleSlot.spellcheck = false;
  titleSlot.autocomplete = "off";

  // Content DOM — type-appropriate element that ProseMirror renders into
  const contentDOM = createContentDOM(typeName);

  // Block-type chip
  const chip = document.createElement("span");
  chip.className = "block-type-chip";

  const kind = nodeKind(node);
  const family = nodeFamily(node);

  chip.dataset.family = family || "none";
  chip.textContent = kind || "";
  if (!kind) {
    chip.style.display = "none";
  }

  // The chip is the block-actions handle (touch-actions redesign: tapping
  // it, not a long-press anywhere on the block, opens the sheet — a
  // long-press is the platform's own text-selection gesture on Android).
  // Harmless on desktop too — the hover pill keeps working exactly as it
  // does today, this just gives the chip a second, equivalent way in.
  chip.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dispatchBlockActionsEvent(chip, dom);
  });

  // Assemble: titleSlot → contentDOM → chip
  dom.append(titleSlot, contentDOM, chip);

  // ---------------------------------------------------------------------------
  // setTitle — READ path only. PM attrs are the source of truth; this method
  // reflects the current attr value onto the DOM (input value + data attribute).
  // ---------------------------------------------------------------------------
  function setTitle(value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    titleSlot.value = trimmed;
    if (trimmed) {
      dom.setAttribute("data-block-title", trimmed);
    } else {
      dom.removeAttribute("data-block-title");
    }
  }

  return { dom, contentDOM, titleSlot, chip, setTitle };
}
