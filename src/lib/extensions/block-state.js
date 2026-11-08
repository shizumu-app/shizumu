// The BlockState extension: where src/lib/block-state.js meets the editor.
// Spec: docs/superpowers/specs/2026-11-01-block-ids-and-meaning-design.md,
// "Block state (groundwork)".
//
//   - toggleBlockState: the decision holding the caret (or the one at a given
//     position) goes standing <-> superseded, in one ordinary transaction, so
//     it is saved, synced and undone like any edit. Never on a read-only page.
//   - Mod-Enter runs it while the caret is inside a decision: the desktop's
//     keyboard way to the chip, since Tab never leaves the editor
//     (block-tab-noop.js). Outside a decision it returns false and Mod-Enter
//     keeps its hard break.
//   - the `open` chip on a qaPair whose question has no answer: a widget
//     decoration, computed from the words on every change, never stored.
//
// The decision chip itself is drawn by the board NodeView (block-title.js,
// via createStateChip below), which both shells share. The attrs live on
// DecisionBlock itself, not here, so the read-only and pin-editor schemas
// (which do not load this extension) keep them too: a pin edit spliced back
// must not drop the decision's state.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  carriesState, stateOf, nextState, toggledAttrs, mayToggleState, stateChipLabel, isOpenQuestion,
} from "../block-state.js";

export const blockStatePluginKey = new PluginKey("blockState");

/**
 * The transaction that toggles the stateful block at `pos`, or null when
 * there is none there or the page is read-only.
 * @param {import("@tiptap/pm/state").EditorState} state
 * @param {number} pos  @param {{ editable: boolean, now?: Date }} opts
 */
export function toggleStateTr(state, pos, { editable, now = new Date() }) {
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  const typeName = node.type.name;
  if (!mayToggleState({ typeName, editable })) return null;
  const attrs = toggledAttrs(typeName, node.attrs, now);
  return attrs ? state.tr.setNodeMarkup(pos, undefined, attrs) : null;
}

/** Position of the innermost stateful block around the selection, or -1. */
export function stateBlockAround(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if (carriesState($from.node(d).type.name)) return $from.before(d);
  }
  // A selected decision (a NodeSelection on the block itself).
  const sel = /** @type {any} */ (state.selection);
  if (sel.node && carriesState(sel.node.type.name)) return sel.from;
  return -1;
}

function openQuestionDecorations(doc) {
  const decorations = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "qaPair") return true;
    if (isOpenQuestion(node)) {
      decorations.push(Decoration.widget(pos + node.nodeSize - 1, () => {
        const chip = document.createElement("span");
        chip.className = "block-state-chip block-state-open";
        chip.dataset.state = "open";
        chip.contentEditable = "false";
        chip.textContent = "open";
        return chip;
      }, { side: -1, ignoreSelection: true, key: "qa-open" }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export const BlockState = Extension.create({
  name: "blockState",
  // Ahead of HardBreak (100), which binds Mod-Enter too. With today's list
  // the decision toggle wins without it ("mod+enter inside a decision"
  // stays green at the default priority), so this is insurance against a
  // reordered list, not the reason the test passes.
  priority: 200,

  addCommands() {
    return {
      toggleBlockState: (pos) => ({ state, dispatch, editor }) => {
        const at = typeof pos === "number" ? pos : stateBlockAround(state);
        if (at < 0) return false;
        const tr = toggleStateTr(state, at, { editable: editor.isEditable });
        if (!tr) return false;
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.editor.commands.toggleBlockState(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockStatePluginKey,
        state: {
          init: (_, state) => openQuestionDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? openQuestionDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return blockStatePluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

/**
 * The decision chip a board NodeView carries: a real button, named for
 * screen readers, that toggles the decision it sits on. On a read-only page
 * it still says what the decision is, and a press changes nothing.
 *
 * @param {object} args
 * @param {any} args.node  @param {any} args.view  @param {() => number} args.getPos
 * @param {HTMLElement} args.wrap  the NodeView's root, which carries data-block-state
 * @returns {{ el: HTMLButtonElement, refresh: (node: any) => void }}
 */
export function createStateChip({ node, view, getPos, wrap }) {
  const typeName = node.type.name;
  const el = document.createElement("button");
  el.type = "button";
  el.className = "block-state-chip";
  el.contentEditable = "false";

  let current = node;
  function refresh(n) {
    current = n;
    const state = stateOf(typeName, n.attrs.blockState);
    const editable = !!view.editable;
    el.textContent = state;
    el.dataset.state = state;
    el.setAttribute("aria-label", stateChipLabel(state, nextState(typeName, state), editable));
    el.setAttribute("aria-disabled", editable ? "false" : "true");
    // Only when it changed: the root's attributes are watched by
    // ProseMirror, and a write of the same value is still a mutation.
    if (wrap.dataset.blockState !== state) wrap.dataset.blockState = state;
  }

  // Keep the caret and focus where they are: a press is a toggle, not a
  // move into the block.
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Read at press time: a page turns read-only (or back) without the
    // NodeView being rebuilt.
    refresh(current);
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    const tr = toggleStateTr(view.state, pos, { editable: !!view.editable });
    if (tr) view.dispatch(tr);
  });

  refresh(node);
  return { el, refresh };
}
