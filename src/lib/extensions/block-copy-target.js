// Resolves which node a block-copy should actually capture, given a doc
// position. Extracted from TipTapEditor.svelte's copyBlockAtPos so the
// boundary arithmetic is unit-testable on its own — the same reason
// resolveBlockPos lives in block-delete.js.
//
// The subtlety this exists for: resolveBlockPos returns `$pos.before(1)`,
// the position immediately BEFORE the hovered block. Resolving that lands
// at depth 0 sitting between two top-level blocks, where `nodeBefore` is
// the PRECEDING block and `nodeAfter` is the one actually hovered. Reading
// nodeBefore first therefore copies the block above the one you pointed at
// — right only for the very first block, where nodeBefore is null.
//
// Both real callers mean "the block starting at pos":
//   - hover handle  -> resolveBlockPos(...)  => before(1) of the target
//   - Ctrl+Shift+C  -> state.selection.from  => inside the block (depth>=1),
//     or, for a NodeSelection on an atom, the position before that atom
// so nodeAfter is checked first. nodeBefore stays as the fallback for a
// position at the very end of the doc (nodeAfter null), e.g. a gap cursor
// after a trailing atom.

/**
 * @param {import('@tiptap/pm/model').Node} doc
 * @param {number} pos
 * @param {{ preferListItem?: boolean }} [opts] preferListItem: walk up from
 *   pos and capture the enclosing listItem instead of the whole top-level
 *   list. Used by the keyboard path, which has a real cursor inside an item;
 *   the hover handle deliberately keeps the depth-1 grain it pointed at.
 * @returns {{ node: any, blockStart: number, blockEnd: number, grain: "block"|"listItem" } | null}
 */
export function resolveCopyTarget(doc, pos, opts = {}) {
  const { preferListItem = false } = opts;

  let $pos;
  try {
    $pos = doc.resolve(pos);
  } catch {
    return null;
  }

  let node, blockStart, blockEnd;

  if ($pos.depth >= 1) {
    // Standard non-atom block: pos is INSIDE a top-level block; depth 1
    // names that block.
    node = $pos.node(1);
    blockStart = $pos.before(1);
    blockEnd = blockStart + node.nodeSize;
  } else if ($pos.nodeAfter) {
    // Depth 0 boundary. The block STARTING here is the one meant.
    node = $pos.nodeAfter;
    blockStart = pos;
    blockEnd = pos + node.nodeSize;
  } else if ($pos.nodeBefore) {
    // End of doc: nothing starts here, so the block ending here is meant.
    node = $pos.nodeBefore;
    blockEnd = pos;
    blockStart = pos - node.nodeSize;
  } else {
    return null;
  }

  if (!node) return null;

  let grain = "block";
  if (preferListItem) {
    for (let d = $pos.depth; d > 0; d--) {
      const candidate = $pos.node(d);
      if (candidate.type.name === "listItem") {
        node = candidate;
        blockStart = $pos.before(d);
        blockEnd = blockStart + node.nodeSize;
        grain = "listItem";
        break;
      }
    }
  }

  return { node, blockStart, blockEnd, grain };
}
