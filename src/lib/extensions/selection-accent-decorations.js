// SelectionAccentDecorations — a ProseMirror decoration plugin wrapped
// in a TipTap extension. Emits one inline `.selection-accent`
// decoration per top-level block (and one per line within blocks) that
// the current selection covers, so CSS can paint a line-clean fill
// and a left-edge accent border around each selected line.
//
// Why a decoration (not pure ::selection CSS): ::selection doesn't
// render on empty ranges, can't paint a left-edge border on a block-
// level container, and can't survive line wrapping with consistent
// geometry. The plugin gives us per-line decoration spans we can style
// however we want.
//
// A NodeSelection on a first-class block (clicking a chart, or selecting a
// board as a unit) renders the same whole-frame accent, so a selected block
// always reads as selected — consistent with a text range that covers it.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Frame (textblock-bearing) boards.
const FRAME_TYPES = new Set([
  "blockquote",
  "list",
  "codeBlock",
  "recipeBlock",
  "decisionBlock",
  "qaBlock",
]);

// Every first-class block that gets the whole-frame accent when covered —
// frames plus the leaf/atom blocks (chart, attachment) and table. Keeps the
// selection highlight uniform across text and blocks, with no gap where an
// atom or table sits in the selected range.
const BLOCK_ACCENT_TYPES = new Set([
  ...FRAME_TYPES,
  "chart",
  "attachment",
  "table",
]);

export const SelectionAccentPluginKey = new PluginKey("selectionAccent");

export const SelectionAccentDecorations = Extension.create({
  name: "selectionAccentDecorations",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: SelectionAccentPluginKey,
        state: {
          init: (_, state) => buildDecorations(state),
          // Rebuild on every selection change OR doc change; both can
          // shift the visible decoration set.
          apply: (tr, old, oldState, newState) => {
            if (tr.docChanged || !tr.selection.eq(oldState.selection)) {
              return buildDecorations(newState);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return SelectionAccentPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

function buildDecorations(state) {
  const { selection } = state;
  if (selection.empty) return DecorationSet.empty;

  // NodeSelection: a whole block selected as a unit (clicking a chart /
  // attachment, or a board via the gutter). Render the frame accent on the
  // block so it reads as selected. Non-block node-selections (e.g. a bare
  // paragraph) get nothing.
  if (isNodeSelection(selection)) {
    const node = selection.node;
    if (node && BLOCK_ACCENT_TYPES.has(node.type.name)) {
      return DecorationSet.create(state.doc, [
        Decoration.node(selection.from, selection.from + node.nodeSize, {
          class: "selection-accent-frame",
        }),
      ]);
    }
    return DecorationSet.empty;
  }

  const { from, to } = selection;
  const decorations = [];

  state.doc.nodesBetween(from, to, (node, pos) => {
    // First-class blocks: emit the whole-frame accent ONLY when the block is
    // fully inside the selection or the selection is fully within it. When the
    // selection merely grazes a frame (a mixed text + block drag that crosses
    // the boundary), painting the entire block reads as broken — so we fall
    // through and let the inner textblocks paint their own per-line accents.
    if (BLOCK_ACCENT_TYPES.has(node.type.name)) {
      // Light the whole-frame accent when the selection fully COVERS the frame
      // or is fully WITHIN it (e.g. selecting code inside a codeBlock). The one
      // case we skip is a boundary-crossing partial overlap — a mixed text+block
      // drag — where the inner textblocks' per-line accents paint the covered
      // part, so grazing a block doesn't light the entire thing.
      const nodeEnd = pos + node.nodeSize;
      const covers = from <= pos && to >= nodeEnd;
      const within = from >= pos && to <= nodeEnd;
      if (covers || within) {
        decorations.push(
          Decoration.node(pos, nodeEnd, { class: "selection-accent-frame" })
        );
      }
      // Do NOT return — fall through. If this frame is also a
      // textblock (codeBlock), the textblock branch below emits
      // the inline accent. Otherwise, the !isTextblock branch
      // returns true to descend into the frame's children.
    }
    if (!node.isTextblock) return true; // descend
    const blockStart = pos + 1;
    const blockEnd = pos + node.nodeSize - 1;
    const segFrom = Math.max(from, blockStart);
    const segTo = Math.min(to, blockEnd);
    if (segFrom > segTo) return false;
    decorations.push(
      Decoration.inline(
        segFrom,
        segTo === segFrom ? segFrom + 1 : segTo,
        { class: "selection-accent" }
      )
    );
    return false;
  });
  return DecorationSet.create(state.doc, decorations);
}

function isNodeSelection(selection) {
  // Duck-typed check: NodeSelection exposes `.node`; TextSelection does not.
  return typeof selection.node !== "undefined" && selection.node !== null;
}
