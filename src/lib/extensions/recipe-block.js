import { Node, mergeAttributes } from "@tiptap/core";
import {
  locateSlotContext,
  isLastTextblockOfSlot,
  advanceFromStructuralSlot,
  paragraphSlotEnter,
} from "./slot-block.js";

const TYPE_NAME = "recipeBlock";
const STRUCTURAL_SLOT_INDEX = 1;

/**
 * `recipeBlock` — typeset structure for procedural thinking.
 *
 * Three slots, fixed order:
 *   1. paragraph  · given   · "given X"
 *   2. block      · do      · the steps (one block; usually a list)
 *   3. paragraph  · result  · "produce Y"
 *
 * Slot labels and placeholders are CSS-only (prose.css). The node itself
 * carries no extra attrs.
 *
 * Cursor flow (mechanics live in slot-block.js, shared with decisionBlock):
 *   - Enter on an empty paragraph in the given or do slot advances to the
 *     next slot (consumes the empty paragraph by moving past it). Matches
 *     the unified "Enter advances structure" idiom.
 *   - Enter at end of an empty result paragraph exits the block to a
 *     fresh paragraph below
 *   - Click between slots to move freely
 *   - Escape exit is handled by the shared BlockEscExit extension.
 *
 * Renamed from `algorithmBlock`. The node type changed; migrateRecipeSchema
 * rewrites stored docs so existing pages render under the new type.
 */
export const RecipeBlock = Node.create({
  name: TYPE_NAME,
  group: "block",
  // Strict three-slot shape: given paragraph, middle block, result paragraph.
  content: "paragraph block paragraph",
  defining: true,

  parseHTML() {
    // Accept the legacy algorithm-block tag too so pasted HTML from older
    // exports lands as a recipeBlock without the migration walker.
    return [
      { tag: 'div[data-type="recipe-block"]' },
      { tag: 'div[data-type="algorithm-block"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "recipe-block",
        class: "recipe-block",
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        const ctx = locateSlotContext($from, TYPE_NAME);
        if (!ctx) return false;

        if (ctx.childIndex === STRUCTURAL_SLOT_INDEX) {
          // The do slot is a structural block (list / blockquote): let its
          // own keymap handle Enter. Only intercept the "end of empty
          // trailing textblock" case to advance to the result slot.
          if ($from.parent.textContent !== "") return false;
          if (!isLastTextblockOfSlot($from, ctx, STRUCTURAL_SLOT_INDEX)) return false;
          return advanceFromStructuralSlot(editor, ctx);
        }

        // Given (0) and Result (2) are single paragraphs; their schema
        // doesn't allow splitting into siblings — paragraphSlotEnter owns
        // that policy (empty → advance/exit, non-empty → hardBreak).
        return paragraphSlotEnter(editor, ctx);
      },
    };
  },
});
