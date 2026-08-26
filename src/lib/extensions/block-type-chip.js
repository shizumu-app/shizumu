// BlockTypeChip — emits widget decorations on nodes whose type is in
// CHIP_TARGET_TYPES, rendering a `.block-type-chip` span at the end
// of the block.
//
// The widget wraps the chip in a zero-size relative anchor span so the
// absolutely-positioned chip lands at the trailing edge of the block,
// not at the editor's positioned ancestor.
//
// Plan 1c (task-1-brief.md): chart used to be the last board type without
// its own chip-owning NodeView, so it was targeted here as a widget
// decoration. It now adopts createBlockShell (chart.js) the same way
// list/blockquote/qaBlock/recipeBlock/codeBlock/table already do, and
// createBlockShell builds a real chip with its own click handler as part
// of the shell — a chart no longer needs (or wants) a second, chip-less
// one layered on top from here. That leaves every board owning its own
// chip and this plugin's target set empty. Kept registered (not deleted)
// rather than ripping the extension out of every extension list that
// wires it in — a future non-board node type that needs a trailing-edge
// chip without its own NodeView has a home to add itself to.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { nodeKind, nodeFamily } from "../pin-display.js";

const CHIP_TARGET_TYPES = new Set([]);

export const BlockTypeChipPluginKey = new PluginKey("blockTypeChip");

export const BlockTypeChip = Extension.create({
  name: "blockTypeChip",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: BlockTypeChipPluginKey,
        state: {
          init: (_, state) => buildDecorations(state.doc),
          apply: (tr, old) => {
            if (tr.docChanged) return buildDecorations(tr.doc);
            return old;
          },
        },
        props: {
          decorations(state) {
            return BlockTypeChipPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

function buildDecorations(doc) {
  if (!doc) return DecorationSet.empty;
  const decorations = [];
  doc.forEach((node, offset) => {
    if (!CHIP_TARGET_TYPES.has(node.type.name)) return;
    const kind = nodeKind(node);
    const family = nodeFamily(node);
    if (!kind) return;
    decorations.push(
      Decoration.widget(offset + node.nodeSize - 1, () => {
        const anchor = document.createElement("span");
        anchor.className = "block-type-chip-anchor";
        const span = document.createElement("span");
        span.className = "block-type-chip";
        span.dataset.family = family || "none";
        span.textContent = kind;
        anchor.appendChild(span);
        return anchor;
      }, { side: 1, ignoreSelection: true, key: `chip-${offset}-${node.type.name}` }),
    );
  });
  return DecorationSet.create(doc, decorations);
}
