// The BlockId extension: a lasting `blockId` on every pinnable block.
// The rules live in src/lib/block-id.js; this file is where they meet the
// editor. Spec: docs/superpowers/specs/2026-11-01-block-ids-and-meaning-design.md.
//
// THE ATTRIBUTE. Global, on the same types as pinId, rendered as
// data-block-id and parsed back from it. `keepOnSplit: false`: the second
// half of a split block is a new block and arrives without one.
//
// TWO KINDS OF TRANSACTION, and the plugin treats them differently.
//
//   A LOAD — a page opened, switched to, or re-read after a sync pull; the
//   first render of a Y.Doc. Blocks saved before 0.8.2 get DERIVED ids, the
//   same on every load. A load must never write (d0604141 — an editor that
//   saved a page it had only loaded emptied the other device's writing), so
//   the ids are part of the load itself, never an edit after it:
//     - EditorCore hands the editor its content with the derived ids already
//       in it (fillDerivedBlockIds), and loads a page switch or a pull
//       through setContentAsLoad below, which does the same;
//     - whatever the parse adds on top (TrailingNode's paragraph) gets its
//       derived id in an appended transaction marked BLOCK_ID_BACKFILL_META,
//       kept out of the undo history, in the same dispatch as the load;
//     - EditorCore takes its echo baseline AFTER that dispatch
//       (pull-reload.js, isEchoOfPull), so neither the debounce nor leaving
//       the page saves an untouched page.
//   EditorCore-block-ids.test.js is the proof, an undo pressed straight
//   after opening included.
//
//   AN EDIT — everything else. A block that arrives without an id (a split,
//   a paste, a carried-forward pin, a slash insert) gets a NEW one, and of
//   two blocks sharing an id the one that already had it keeps it: its old
//   position is mapped through the edit, so a copy pasted ABOVE its original
//   does not take the original's id. A block whose original is gone (a
//   drag, a cut then paste) keeps its id, since nothing shares it. That
//   fix-up rides the edit's own history event, so undo takes both back.
//
// `assign: false` registers the attribute and nothing else. The read-only
// list and the pin editors use it: they must KEEP ids (a schema without the
// attr drops it on parse, and a pin edit spliced back would lose its
// block's id), but must not invent them — a pin editor holds blocks of a
// page it does not know the id of.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { BLOCK_ID_TYPES, assignBlockIds, dedupeBlockIds, fillDerivedBlockIds, newBlockId, walkBlocks } from "../block-id.js";

/** Set on a transaction that LOADS content (setContent of a stored page). */
export const BLOCK_ID_LOAD_META = "blockIdLoad";
/** Set on the appended transaction that gives a loaded page its derived ids. */
export const BLOCK_ID_BACKFILL_META = "blockIdBackfill";
/** Set on every transaction this plugin appends, so it does not walk its own. */
const BLOCK_ID_FIX_META = "blockIdFix";

export const blockIdPluginKey = new PluginKey("blockId");

/** Is this transaction, or the root it was appended to, a load? */
function isLoadTr(tr) {
  if (tr.getMeta(BLOCK_ID_LOAD_META)) return true;
  // A Y.Doc rendering into the editor: the first render of a continuous
  // page, or the other device's edit arriving. Either way the words came
  // from storage, not from this writer, so the ids are derived — and two
  // devices deriving for the same block agree.
  if (tr.getMeta(ySyncPluginKey) !== undefined) return true;
  const root = tr.getMeta("appendedTransaction");
  return !!root && root !== tr && isLoadTr(root);
}

/**
 * Was any transaction in this batch a load?
 * @param {Array<import("@tiptap/pm/state").Transaction>} trs
 */
function isBlockIdLoad(trs) {
  return trs.some(isLoadTr);
}

/** Where the block that had `id` before these transactions sits now. */
function preferOriginal(oldDoc, trs) {
  let mapping = null;
  return (id) => {
    let oldPos = null;
    walkBlocks(oldDoc, (_node, _path, pos, _type, nodeId) => {
      if (oldPos === null && nodeId === id) oldPos = pos;
    });
    if (oldPos === null) return null;
    if (!mapping) {
      mapping = new Mapping();
      for (const tr of trs) mapping.appendMapping(tr.mapping);
    }
    const mapped = mapping.mapResult(oldPos, 1);
    return mapped.deleted ? null : mapped.pos;
  };
}

/**
 * Load a stored document into the editor as a LOAD. Same arguments as
 * TipTap's setContent.
 *
 * A JSON doc gets its derived ids before it is parsed — the ids the same
 * page gets on every load and in an export (fillDerivedBlockIds), so the
 * document the editor holds after a load is the same whichever way it was
 * loaded. That matters beyond tidiness: a setContent is an undoable step,
 * and undoing it restores the document before it; were that document's ids
 * different, an undo the writer presses on a page they only opened would
 * change the page. Anything the parse adds (the trailing paragraph) is
 * given its derived id by the plugin, in the same load.
 */
export function setContentAsLoad(editor, content, options) {
  const pageId = pageIdOf(editor);
  const filled = pageId && content && typeof content === "object" && !Array.isArray(content)
    ? fillDerivedBlockIds(content, pageId)
    : content;
  return editor.chain().setMeta(BLOCK_ID_LOAD_META, true).setContent(filled, options).run();
}

function pageIdOf(editor) {
  const ext = editor?.extensionManager?.extensions?.find((e) => e.name === "blockId");
  try { return ext?.options?.assign ? ext.options.getPageId?.() || null : null; } catch { return null; }
}

export const BlockId = Extension.create({
  name: "blockId",

  addOptions() {
    return {
      // false: the attribute only (read-only mounts, pin editors).
      assign: true,
      // The open page's id, read at the moment of a load. Without one there
      // is nothing to derive from, and loads fall back to new ids.
      getPageId: () => null,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_ID_TYPES,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute("data-block-id") || null,
            renderHTML: (attrs) => (attrs.blockId ? { "data-block-id": attrs.blockId } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    if (!this.options.assign) return [];
    const getPageId = () => {
      try { return this.options.getPageId?.() || null; } catch { return null; }
    };
    return [
      new Plugin({
        key: blockIdPluginKey,
        appendTransaction(trs, oldState, newState) {
          if (trs.every((tr) => tr.getMeta(BLOCK_ID_FIX_META))) return null;
          const load = isBlockIdLoad(trs);
          if (!load && !trs.some((tr) => tr.docChanged)) return null;

          let fixes;
          if (load) {
            const pageId = getPageId();
            fixes = pageId
              ? assignBlockIds(newState.doc, pageId)
              : dedupeBlockIds(newState.doc);
          } else {
            fixes = dedupeBlockIds(newState.doc, {
              makeId: () => newBlockId(),
              prefer: preferOriginal(oldState.doc, trs),
            });
          }
          if (fixes.length === 0) return null;

          const tr = newState.tr;
          for (const [pos, id] of fixes) tr.setNodeAttribute(pos, "blockId", id);
          tr.setMeta(BLOCK_ID_FIX_META, true);
          if (load) {
            tr.setMeta(BLOCK_ID_BACKFILL_META, true);
            tr.setMeta("addToHistory", false);
          }
          return tr;
        },
      }),
    ];
  },

  // Content handed to `new Editor({ content })` arrives without a
  // transaction, so nothing above has seen it. Load it here, once the
  // editor exists: an empty transaction marked as a load, kept out of the
  // history and out of the update event (which is what schedules a save).
  // EditorCore prefills its content, so there this finds nothing to do; it
  // is the net for any other editor built with this extension.
  onCreate() {
    if (!this.options.assign) return;
    const { editor } = this;
    if (!editor || editor.isDestroyed) return;
    const tr = editor.state.tr
      .setMeta(BLOCK_ID_LOAD_META, true)
      .setMeta("addToHistory", false)
      .setMeta("preventUpdate", true);
    editor.view.dispatch(tr);
  },
});
