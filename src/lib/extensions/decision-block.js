import { Node, mergeAttributes } from "@tiptap/core";
import {
  locateSlotContext,
  isLastTextblockOfSlot,
  advanceFromStructuralSlot,
  paragraphSlotEnter,
} from "./slot-block.js";

const TYPE_NAME = "decisionBlock";
const STRUCTURAL_SLOT_INDEX = 0;

/**
 * `decisionBlock` — typeset structure for a decision: what was weighed,
 * what was chosen, and why. Structurally a sibling of recipeBlock (see
 * slot-block.js for the shared Enter mechanics); pins are mostly
 * decisions, so a dedicated shape for them is on-brand.
 *
 * Three slots, fixed order:
 *   1. block      · considered · the options weighed (a list by default)
 *   2. paragraph  · chose      · what was picked
 *   3. paragraph  · because    · why
 *
 * Slot labels and placeholders are CSS-only (prose.css). The node itself
 * carries no extra attrs — blockTitle and pinId arrive via the global
 * attributes registered in block-title.js / pin-id.js.
 *
 * Cursor flow (mechanics live in slot-block.js, shared with recipeBlock):
 *   - Enter on an empty paragraph in the chose slot advances to because.
 *   - Enter at end of an empty because paragraph exits the block to a
 *     fresh paragraph below.
 *   - Enter on the considered list's own trailing empty item (created by
 *     the list's own keymap splitting a filled item) advances to chose and
 *     consumes the scratch item.
 *   - Click between slots to move freely.
 *   - Escape exit is handled by the shared BlockEscExit extension.
 *
 * The structural slot moves from index 1 (recipe's "do") to index 0
 * ("considered") — the only reindexing needed, handled generically by
 * slot-block.js's isLastTextblockOfSlot.
 */
export const DecisionBlock = Node.create({
  name: TYPE_NAME,
  group: "block",
  content: "block paragraph paragraph",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="decision-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "decision-block",
        class: "decision-block",
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
          // The considered slot is a structural block (list): let its own
          // keymap handle Enter. Only intercept the "end of empty trailing
          // textblock" case to advance to the chose slot.
          if ($from.parent.textContent !== "") return false;
          if (!isLastTextblockOfSlot($from, ctx, STRUCTURAL_SLOT_INDEX)) return false;
          return advanceFromStructuralSlot(editor, ctx);
        }

        // Chose (1) and Because (2) are single paragraphs; their schema
        // doesn't allow splitting into siblings — paragraphSlotEnter owns
        // that policy (empty → advance/exit, non-empty → hardBreak).
        return paragraphSlotEnter(editor, ctx);
      },
    };
  },
});
