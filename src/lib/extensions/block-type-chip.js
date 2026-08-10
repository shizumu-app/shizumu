// BlockTypeChip — emits widget decorations on nodes whose type is in
// CHIP_TARGET_TYPES, rendering a `.block-type-chip` span at the end
// of the block. Used for chart, table, attachment — node types whose
// NodeView is outside block-title.js / code-block.js but still benefit
// from the per-block type chip. Lists, blockquote, qaBlock, recipeBlock,
// codeBlock already get the chip from their own NodeView and are NOT
// targeted here.
//
// The widget wraps the chip in a zero-size relative anchor span so the
// absolutely-positioned chip lands at the trailing edge of the block,
// not at the editor's positioned ancestor.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { nodeKind, nodeFamily } from "../pin-display.js";

// `table` is intentionally NOT here: a widget at the table node's trailing
// edge anchors to a zero-width span at the bottom-left of the table, so the
// chip (right-aligned) extends off the left page edge and gets clipped. The
// table's chip is rendered by ShellTableView instead (bottom-right of the
// table wrapper), matching how the other block NodeViews own their chip.
// `attachment` is intentionally NOT here: it now renders as a compact
// inline chip (AttachmentBlock.svelte) that's self-evidently a file, so a
// trailing "file" type chip is redundant — and the widget anchored at the
// node's trailing edge clipped off the left page edge anyway.
const CHIP_TARGET_TYPES = new Set(["chart"]);

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
