import { TextSelection } from "@tiptap/pm/state";

/**
 * slot-block.js — generic N-slot Enter-key mechanics shared by every
 * fixed-shape "board" node whose content is a short sequence of slots
 * (a structural block among them) that Enter walks between.
 *
 * Extracted out of recipe-block.js (three slots: paragraph · block ·
 * paragraph, structural slot at index 1) so recipeBlock and decisionBlock
 * (three slots: block · paragraph · paragraph, structural slot at index 0)
 * share one implementation instead of two copies that can drift.
 *
 * A caller (recipe-block.js, decision-block.js) is a thin Node.create()
 * wrapper: it knows its own type name and which slot index is the
 * structural one, and dispatches Enter to the functions below. Slot COUNT
 * is never configured separately — it's read off the live node
 * (`ctx.slotBlock.childCount`), since the schema's content expression
 * fixes it at exactly N children.
 *
 * Three residual shape assumptions live in `advanceFromStructuralSlot`. None
 * is reachable from either caller today; they are written down so a third
 * caller, or a schema change, does not walk into them silently:
 *
 *   (i) It assumes the structural slot holds a `list` of `listItem`s. Both
 *       slots are typed "block" in the schema — a single arbitrary block —
 *       so a blockquote (or a table) is schema-legal there. With one, the
 *       `isRemovableTrailingItem` test is simply false and the function
 *       skips the scratch-item consume and just advances. That degrades
 *       gracefully rather than corrupting anything, but it is not the
 *       "consume the empty scratch item" behaviour the comment below
 *       promises.
 *
 *  (ii) It dispatches the delete BEFORE calling `moveBetweenSlots`. If the
 *       structural slot were the LAST slot, `moveBetweenSlots(+1)` would
 *       return false with the delete already committed — a half-action (the
 *       scratch item gone, the cursor unmoved). Both callers put the
 *       structural slot before the last: recipeBlock at index 1 of 3,
 *       decisionBlock at index 0 of 3.
 *
 * (iii) `slotCount` is read off `ctx.slotBlock` — the PRE-delete node — and
 *       used after the delete has been dispatched. Safe only because the
 *       schema fixes the child count at exactly N: deleting a listItem
 *       inside a slot never changes how many slots the block has.
 *
 * Neither caller (recipe slot 1, decision slot 0, both with 3 fixed slots)
 * reaches any of the three.
 */

/** Walk up from $from to find the ancestor node named `typeName`. */
export function locateSlotContext($from, typeName) {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === typeName) {
      return {
        blockDepth: d,
        childIndex: $from.index(d),
        slotBlock: $from.node(d),
        typeName,
      };
    }
  }
  return null;
}

/**
 * Move the cursor between slots. delta = +1 (next) or -1 (prev).
 * `slotCount` bounds which indices are valid; relocates the block context
 * fresh from the editor's CURRENT selection (not a stale `ctx` a caller may
 * be holding) because callers sometimes dispatch a mutating transaction
 * first (see advanceFromStructuralSlot) and doc positions shift underneath.
 */
export function moveBetweenSlots(editor, delta, { slotCount, typeName }) {
  const { state } = editor;
  const { $from } = state.selection;
  const ctx = locateSlotContext($from, typeName);
  if (!ctx) return false;

  const nextIndex = ctx.childIndex + delta;
  if (nextIndex < 0 || nextIndex >= slotCount) return false;

  const blockPos = $from.before(ctx.blockDepth);
  let offset = blockPos + 1;
  for (let i = 0; i < nextIndex; i++) {
    offset += ctx.slotBlock.child(i).nodeSize;
  }
  const target = ctx.slotBlock.child(nextIndex);
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

/**
 * Is $from inside the last textblock of slot `slotIndex`?
 *
 * The slot's start position is the block's own start plus the size of
 * every slot before it — for slotIndex 0 that sum is empty, so the slot
 * start IS the block start. No special case needed; the loop degenerates
 * correctly at index 0.
 */
export function isLastTextblockOfSlot($from, ctx, slotIndex) {
  const slotNode = ctx.slotBlock.child(slotIndex);
  const blockStart = $from.before(ctx.blockDepth) + 1;
  let slotStart = blockStart;
  for (let i = 0; i < slotIndex; i++) {
    slotStart += ctx.slotBlock.child(i).nodeSize;
  }
  const slotEnd = slotStart + slotNode.nodeSize;
  // The cursor's containing textblock starts at $from.before($from.depth).
  const myTextblockStart = $from.before($from.depth);
  // Walk the slot to find its last textblock's start position.
  let lastTextblockStart = -1;
  slotNode.descendants((node, relPos) => {
    if (node.isTextblock) {
      lastTextblockStart = slotStart + 1 + relPos;
    }
    return true;
  });
  // If the slot has no nested structure (the slot IS a textblock itself),
  // its own start position already points at its first content offset.
  if (lastTextblockStart < 0 && slotNode.isTextblock) {
    lastTextblockStart = slotStart;
  }
  return myTextblockStart === lastTextblockStart && myTextblockStart < slotEnd;
}

// D-7 (QA sweep, recipe-block.js originally): advancing from a structural
// slot to the next one used to just call moveBetweenSlots(+1), contradicting
// the "consumes the empty paragraph/item by moving past it" idiom the rest
// of this Enter behavior follows. Filling the structural slot's list with
// two items then pressing Enter twice to advance left a stray empty
// trailing list item behind — the FIRST Enter (on a non-empty item) is
// deferred to the list's own keymap, which splits off a fresh empty item as
// normal list behavior; the SECOND Enter (now on that empty item) is what
// the block's own handler intercepts to advance slots, but it used to only
// move the selection, never removing the scratch item Enter had just
// created. Consume it here — but only when there's more than one item, so
// a structural slot the user never typed into (a single empty item) is
// left alone.
//
// Works off $from.depth, not the slot index — moves unchanged whether the
// structural slot sits at index 0 (decisionBlock) or index 1 (recipeBlock).
export function advanceFromStructuralSlot(editor, ctx) {
  const { state } = editor;
  const $from = state.selection.$from;

  const itemDepth = $from.depth - 1;
  const isRemovableTrailingItem =
    itemDepth > ctx.blockDepth &&
    $from.node(itemDepth)?.type.name === "listItem" &&
    $from.node(itemDepth - 1)?.type.name === "list" &&
    $from.node(itemDepth - 1).childCount > 1;

  if (isRemovableTrailingItem) {
    const itemFrom = $from.before(itemDepth);
    const itemTo = $from.after(itemDepth);
    let tr = state.tr.delete(itemFrom, itemTo);
    // Explicitly bias the post-delete selection BACKWARD into the
    // structural slot (rather than trusting Transaction's own default
    // remap). The deleted range's boundary sits exactly at the edge of
    // the structural slot; a forward-biased (or default) remap can land
    // the cursor past it, in whatever sibling slot happens to follow —
    // for recipeBlock's structural slot (index 1 of 3, exactly one slot
    // before the last) that sibling IS the intended target, which masked
    // this; for decisionBlock's structural slot (index 0 of 3, two slots
    // still ahead) it overshoots by one, since the +1 below would then
    // advance a SECOND time. Forcing the selection back inside the slot
    // here makes moveBetweenSlots(+1) the only thing that ever advances a
    // slot, regardless of how many slots follow the structural one.
    try {
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(itemFrom), -1));
    } catch {
      // Fall through with whatever selection the delete itself produced;
      // moveBetweenSlots below re-locates from it and simply won't move
      // if that position no longer resolves inside this block.
    }
    editor.view.dispatch(tr);
  }
  return moveBetweenSlots(editor, +1, {
    slotCount: ctx.slotBlock.childCount,
    typeName: ctx.typeName,
  });
}

/**
 * Enter policy for a plain-paragraph slot (every slot that isn't the
 * structural one):
 *   - non-empty paragraph → insert a hardBreak (multi-line content within
 *     the slot)
 *   - empty paragraph, not the last slot → advance to the next slot
 *   - empty paragraph, the LAST slot → exit the block to a fresh paragraph
 *     below
 *
 * "Last slot" is read off the live node (`ctx.slotBlock.childCount - 1`),
 * not a config value, so this never drifts from the schema's actual shape.
 */
export function paragraphSlotEnter(editor, ctx) {
  const { state } = editor;
  const $from = state.selection.$from;

  if ($from.parent.textContent !== "") {
    return editor.commands.setHardBreak();
  }

  const isLastSlot = ctx.childIndex === ctx.slotBlock.childCount - 1;
  if (!isLastSlot) {
    return moveBetweenSlots(editor, +1, {
      slotCount: ctx.slotBlock.childCount,
      typeName: ctx.typeName,
    });
  }

  // Empty last-slot paragraph: exit the block to a fresh paragraph below.
  const blockPos = $from.before(ctx.blockDepth);
  const afterBlock = blockPos + ctx.slotBlock.nodeSize;
  const para = state.schema.nodes.paragraph.create();
  let tr = state.tr.insert(afterBlock, para);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(afterBlock + 1)));
  editor.view.dispatch(tr);
  return true;
}
