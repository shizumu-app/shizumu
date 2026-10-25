// A board pin's title, written into the doc that holds it.
//
// The shell's pin sheet can rename a pin whose node is on some other page,
// or on this page while the editor is not mounted. For a board the title
// has to reach the NODE (pin-title-authority.js: the doc is authoritative
// for a `blockTitle` slot, and a row write would be overwritten by the
// next save of that page), so the source page is loaded, the node carrying
// the pinId gets its slot rewritten, and the page is saved back with the
// pin-refresh hook. This is the walk. It is the desktop's `walkAndSetTitle`
// (SharedObjectsPanel.svelte) as a pure function, here rather than shared
// because that file is the stability session's and this tree carries its
// own copy of the rename route.
//
// The whole doc is walked, not just the top level: a pinned board can sit
// inside a list item, and `spliceNodeAtPinId` finds it at any depth too.

/**
 * @param {object} node a TipTap doc or any node inside one
 * @param {string} pinId
 * @param {string|null} title null clears the slot, which is what the pin
 *   sheet sends for an emptied title field — and what `extract_block_title`
 *   (commands.rs) reads as "the key is there and empty; clear the row".
 * @returns {object} a new tree; the input is not mutated
 */
export function withTitleAtPinId(node, pinId, title) {
  if (!node || typeof node !== "object") return node;
  if (node.attrs?.pinId === pinId) {
    return { ...node, attrs: { ...(node.attrs || {}), blockTitle: title } };
  }
  if (Array.isArray(node.content)) {
    return { ...node, content: node.content.map((c) => withTitleAtPinId(c, pinId, title)) };
  }
  return node;
}

/**
 * The same walk, replacing the whole NODE rather than one of its attrs:
 * the pinned block becomes `nodes`, in place, in a copy of the doc.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 *
 * A pin is a pointer plus a cached copy (CLAUDE.md's pointer clause), and
 * the shell wrote an edited pin to the CACHE alone. A writer who fixed a
 * table on its pin screen then found the page it came from still showing
 * the old one: "updating pins does not reflect change in the page where
 * pin exist". The desktop's panel has always spliced — same-page through
 * the live editor, cross-page through a load, this walk and a save — and
 * `refresh_pin_caches` (commands.rs) re-derives the cache from the node
 * afterwards, which is what keeps the two from disagreeing. This is the
 * cross-page half of that.
 *
 * MANY NODES, NOT ONE. The desktop keeps the first node of its editor's
 * doc and drops the rest; a writer who split a pinned block in two would
 * lose the second half. All of them are spliced in here, and the pin then
 * points at the first — `refresh_pin_caches` re-derives its cache from
 * the node carrying the id, so the pin covers one block and the page
 * keeps everything that was written.
 *
 * THE ID RIDES ON THE FIRST NODE. Whatever the editor handed back, the
 * block that replaces a pinned block is that pin's block: the id is
 * stamped rather than trusted, because a doc rebuilt by a serializer can
 * come back without the attr, and a spliced page with no pinId in it is a
 * pin orphaned by its own save.
 *
 * @param {object} node a TipTap doc or any node inside one
 * @param {string} pinId
 * @param {object[]} nodes the blocks to put in its place; an empty list
 *   leaves the doc alone, because deleting a pinned block is `unpin`'s
 *   job and not a save's.
 * @returns {object} a new tree; the input is not mutated
 */
export function withNodesAtPinId(node, pinId, nodes) {
  const replacement = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  if (!node || typeof node !== "object" || replacement.length === 0) return node;
  if (!Array.isArray(node.content)) return node;
  const out = [];
  let hit = false;
  for (const child of node.content) {
    if (child?.attrs?.pinId === pinId) {
      hit = true;
      out.push(
        ...replacement.map((n, i) =>
          i === 0 ? { ...n, attrs: { ...(n.attrs || {}), pinId } } : n,
        ),
      );
    } else {
      out.push(withNodesAtPinId(child, pinId, replacement));
    }
  }
  return hit || out.some((child, i) => child !== node.content[i])
    ? { ...node, content: out }
    : node;
}
