import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

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
 * Cursor flow:
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
  name: "recipeBlock",
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

        const ctx = locateRecipeContext($from);
        if (!ctx) return false;

        // Given (0) and Result (2) are single paragraphs; their schema
        // doesn't allow splitting into siblings. Enter behavior:
        //   - empty paragraph → advance to next slot (or exit for result)
        //   - non-empty paragraph → insert a hardBreak so the user can
        //     write multi-line content in the slot
        if (ctx.childIndex === 0) {
          if ($from.parent.textContent === "") {
            return moveBetweenSlots(editor, +1);
          }
          return editor.commands.setHardBreak();
        }

        if (ctx.childIndex === 1) {
          // Slot 1 is a structural block (list / blockquote): let its own
          // keymap handle Enter. Only intercept the "end of empty trailing
          // textblock" case to advance to the result slot.
          if ($from.parent.textContent !== "") return false;
          if (!isLastTextblockOfSlot($from, ctx)) return false;
          return advanceFromDoSlot(editor);
        }

        if (ctx.childIndex === 2) {
          if ($from.parent.textContent === "") {
            // Empty result paragraph: exit the block to a fresh paragraph.
            const algoPos = $from.before(ctx.algoDepth);
            const afterAlgo = algoPos + ctx.algoBlock.nodeSize;
            const para = state.schema.nodes.paragraph.create();
            let tr = state.tr.insert(afterAlgo, para);
            tr = tr.setSelection(TextSelection.near(tr.doc.resolve(afterAlgo + 1)));
            editor.view.dispatch(tr);
            return true;
          }
          return editor.commands.setHardBreak();
        }

        return false;
      },
    };
  },
});

/** Walk up from $from to find the recipeBlock ancestor. */
function locateRecipeContext($from) {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "recipeBlock") {
      return {
        algoDepth: d,
        childIndex: $from.index(d),
        algoBlock: $from.node(d),
      };
    }
  }
  return null;
}

/** Is $from inside the last textblock of slot 1 (middle block)? */
function isLastTextblockOfSlot($from, ctx) {
  const slotNode = ctx.algoBlock.child(1);
  // Find the position where slot 1 starts inside the doc.
  const algoStart = $from.before(ctx.algoDepth) + 1;
  const slot1Start = algoStart + ctx.algoBlock.child(0).nodeSize;
  const slot1End = slot1Start + slotNode.nodeSize;
  // The cursor's containing textblock starts at $from.before($from.depth).
  const myTextblockStart = $from.before($from.depth);
  // Walk slot1 to find the last textblock's start position.
  let lastTextblockStart = -1;
  slotNode.descendants((node, relPos) => {
    if (node.isTextblock) {
      lastTextblockStart = slot1Start + 1 + relPos;
    }
    return true;
  });
  // If the slot has no nested structure (slot1 is itself a textblock),
  // slot1Start + 1 is where its content begins.
  if (lastTextblockStart < 0 && slotNode.isTextblock) {
    lastTextblockStart = slot1Start;
  }
  return myTextblockStart === lastTextblockStart && myTextblockStart < slot1End;
}

// D-7 (QA sweep): advancing from the do slot (childIndex 1) to result used
// to just call moveBetweenSlots(+1), contradicting recipe-block.js's own
// doc comment ("consumes the empty paragraph by moving past it"). Filling
// the do-list with two items then pressing Enter twice to reach result
// left a stray empty trailing list item ("3.") behind — the FIRST Enter
// (on a non-empty item) is deferred to the list's own keymap, which splits
// off a fresh empty item as normal list behavior; the SECOND Enter (now on
// that empty item) is what this handler intercepts to advance slots, but
// it only moved the selection, never removed the scratch item Enter had
// just created. Consume it here — but only when there's more than one
// item, so a do-slot the user never typed into (a single empty item) is
// left alone.
function advanceFromDoSlot(editor) {
  const { state } = editor;
  const $from = state.selection.$from;
  const ctx = locateRecipeContext($from);
  if (!ctx) return false;

  const itemDepth = $from.depth - 1;
  const isRemovableTrailingItem =
    itemDepth > ctx.algoDepth &&
    $from.node(itemDepth)?.type.name === "listItem" &&
    $from.node(itemDepth - 1)?.type.name === "list" &&
    $from.node(itemDepth - 1).childCount > 1;

  if (isRemovableTrailingItem) {
    const itemFrom = $from.before(itemDepth);
    const itemTo = $from.after(itemDepth);
    editor.view.dispatch(state.tr.delete(itemFrom, itemTo));
  }
  return moveBetweenSlots(editor, +1);
}

/** Move cursor between the three slots. delta = +1 (next) or -1 (prev). */
function moveBetweenSlots(editor, delta) {
  const { state } = editor;
  const { $from } = state.selection;
  const ctx = locateRecipeContext($from);
  if (!ctx) return false;

  const nextIndex = ctx.childIndex + delta;
  if (nextIndex < 0 || nextIndex > 2) return false;

  const algoPos = $from.before(ctx.algoDepth);
  let offset = algoPos + 1;
  for (let i = 0; i < nextIndex; i++) {
    offset += ctx.algoBlock.child(i).nodeSize;
  }
  const target = ctx.algoBlock.child(nextIndex);
  let cursor;
  if (target.isTextblock) {
    cursor = offset + 1;
  } else {
    let found = -1;
    target.descendants((descNode, descPos) => {
      if (found >= 0) return false;
      if (descNode.isTextblock) {
        found = offset + 1 + descPos + 1;
        return false;
      }
      return true;
    });
    cursor = found >= 0 ? found : offset + 1;
  }

  try {
    const $pos = state.doc.resolve(cursor);
    const tr = state.tr.setSelection(TextSelection.near($pos, 1));
    editor.view.dispatch(tr);
    return true;
  } catch {
    return false;
  }
}
