// The editor's state, reduced to what a chrome needs to decide what to
// show. Pure over editor.state: no DOM reads, no timers. EditorCore
// publishes computeSnapshot(editor) on every transaction through its
// `snapshot` store; the desktop chrome and the phone shell both render
// from it (spec §3, "The split that makes it possible").
import { SlashCommandsPluginKey } from "../../lib/slash-commands.js";
import { MentionCommandPluginKey } from "../../lib/extensions/mention-command.js";
import { isBoardType } from "../../lib/extensions/block-title.js";

export const EMPTY_SNAPSHOT = Object.freeze({
  selectionEmpty: true,
  from: 0,
  to: 0,
  canUndo: false,
  canRedo: false,
  activeBlock: null,
  query: null,
  inListItem: false,
  canIndent: false,
  canOutdent: false,
});

const QUERY_SOURCES = [
  ["slash", SlashCommandsPluginKey],
  ["mention", MentionCommandPluginKey],
];

function readQuery(state) {
  for (const [kind, key] of QUERY_SOURCES) {
    const s = key.getState(state);
    if (s && s.active) return { kind, text: s.query ?? "" };
  }
  return null;
}

// Has a title been TYPED on this block. Deliberately NOT the gate for the
// actions sheet's `title` row: that row exists to put a title on a board
// that has none, and `blockActionsFor` asks a different question —
// `hasTitleSlot`, whether the block renders a `.board-title-slot` to focus,
// which is a DOM fact this module (pure over editor.state, no DOM reads)
// cannot answer and must not guess at from the node type.
//
// Both were called `hasTitle` until 2026-08-31. Same name, same type,
// opposite meaning, so nothing type-checked the difference: passing this
// one through to `blockActionsFor` would have offered `title` only on
// boards that already have one and never on the untitled board the row is
// for. Two names that cannot be read as each other is the fix; the shared
// module throws on the retired one rather than defaulting it closed.
function isTitledNode(node) {
  return !!(node?.attrs?.blockTitle || "").trim();
}

function readActiveBlock($from, selection) {
  // A NodeSelection selects a whole node rather than placing a caret inside
  // one — images, charts, dayMarkers, horizontal rules. At the top level
  // $from.depth is 0, which used to fall straight into the depth guard
  // below and report "no active block" on exactly the blocks whose gutter
  // handle has no caret to fall back to. Handle it before that guard.
  if (selection?.node && $from.depth === 0) {
    const node = selection.node;
    return {
      type: node.type.name,
      pos: $from.pos,
      isBoard: isBoardType(node.type.name),
      isTitled: isTitledNode(node),
      // Not node.content.size === 0: that's trivially true for every atom
      // (images, charts, dayMarkers, rules never have content), but isEmpty
      // means "an empty paragraph/heading you can convert" (block-actions.js
      // JSDoc). Reusing the text-path formula here would mark every atom as
      // that and hand the actions sheet a nonsensical insert-below. false is
      // the deliberately correct constant, not a shortcut.
      isEmpty: false,
    };
  }
  // A CURSOR BETWEEN BLOCKS, which is also depth 0 and has no `node`.
  //
  // ProseMirror's GapCursor sits in the gap beside a block that cannot hold
  // a caret — above the first block, below the last, between two atoms —
  // and a phone produces one easily: tapping the margin under the final
  // block is the usual way. It fell into the guard below and reported "no
  // active block", which takes the gutter handle, the `turn into` chip and
  // `pin` off screen at once, for a cursor the writer can plainly see.
  //
  // The block it means is the one it is beside. Before, not after: the gap
  // the writer reached by tapping under their last line belongs to that
  // line, and a cursor above the first block has nothing before it, so it
  // falls through to the node after.
  //
  // EMPTY ONLY, which is what makes this a cursor rather than a range.
  // AllSelection — Android's long-press → Select all — is the other depth-0
  // selection with no `node`, and it must NOT land here: it would name the
  // first block as "the" block while the writer has selected every one of
  // them. A range already swaps the strip to the selection's own controls
  // (toolbar-model.js), so the only thing activeBlock still feeds there is
  // the gutter handle, and a handle pointing at block one during select-all
  // is a claim about the selection that is not true.
  if ($from.depth === 0 && !selection?.node && selection?.empty) {
    const before = $from.nodeBefore;
    const after = $from.nodeAfter;
    const beside = before || after;
    if (beside) {
      // `pos` must address the node, not the gap: nodeBefore ends AT pos,
      // so its start is pos minus its own size; nodeAfter starts at pos.
      const pos = before ? $from.pos - before.nodeSize : $from.pos;
      return {
        type: beside.type.name,
        pos,
        isBoard: isBoardType(beside.type.name),
        isTitled: isTitledNode(beside),
        isEmpty: beside.content.size === 0,
      };
    }
    // Nothing on either side is an empty document, and `null` is right:
    // there is no block to address. Falls through to the guard below.
  }
  if ($from.depth < 1) return null;
  const node = $from.node(1);
  if (!node) return null;
  return {
    type: node.type.name,
    pos: $from.before(1),
    isBoard: isBoardType(node.type.name),
    isTitled: isTitledNode(node),
    isEmpty: node.content.size === 0,
  };
}

// Collaboration-bound editors run without UndoRedo (history: false in
// shared-extensions.js) and expose undo/redo through y-tiptap instead;
// a build with neither has no undo command at all, so guard the lookup.
function canRun(editor, command) {
  return typeof editor.commands[command] === "function" && editor.can()[command]();
}

// The caret's list item, for the phone strip's indent and outdent: Tab and
// Shift-Tab on a keyboard (unified-list.js), the only other way to nest.
function inListItem($from) {
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "listItem") return true;
  return false;
}

export function computeSnapshot(editor) {
  if (!editor || editor.isDestroyed) return EMPTY_SNAPSHOT;
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  return {
    selectionEmpty: empty,
    from,
    to,
    canUndo: canRun(editor, "undo"),
    canRedo: canRun(editor, "redo"),
    activeBlock: readActiveBlock($from, state.selection),
    query: readQuery(state),
    inListItem: inListItem($from),
    canIndent: canRun(editor, "sinkListItemOnce"),
    canOutdent: canRun(editor, "liftListItemOnce"),
  };
}
