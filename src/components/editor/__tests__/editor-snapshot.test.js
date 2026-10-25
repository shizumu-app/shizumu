// computeSnapshot is what every chrome (desktop today, the phone shell's
// toolbar-model later) reads to decide what to show. It must be pure over
// the editor's state — no DOM, no timers.
import { describe, it, expect, afterEach } from "vitest";
import { Editor, Extension } from "@tiptap/core";
import { Plugin, AllSelection } from "@tiptap/pm/state";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { Gapcursor } from "@tiptap/extension-gapcursor";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Image } from "@tiptap/extension-image";
import { UndoRedo } from "@tiptap/extensions";
import { BlockTitle } from "../../../lib/extensions/block-title.js";
import { SlashCommandsPluginKey } from "../../../lib/slash-commands.js";
import { computeSnapshot, EMPTY_SNAPSHOT } from "../editor-snapshot.js";
import { UnifiedListExtensions } from "../../../lib/extensions/unified-list.js";
import { QABlock } from "../../../lib/extensions/qa-block.js";
import { QAPair } from "../../../lib/extensions/qa-pair.js";

// a list item may hold a q&a block, so the schema needs it to build
const LISTS = [...UnifiedListExtensions, QABlock, QAPair];

let cleanup = () => {};
afterEach(() => cleanup());

function makeEditor(content, extra = []) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [Document, Paragraph, Text, Blockquote, BlockTitle, UndoRedo, ...extra],
    content,
  });
  cleanup = () => { editor.destroy(); host.remove(); };
  return editor;
}

const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

// makeEditor above builds a real TipTap editor rather than a stub, so a
// genuine NodeSelection is exactly as reachable as the text selections the
// other tests build with setTextSelection — no separate stub shape needed.
// Image is a real top-level atom (group: "block", atom: true by default),
// which is what selecting an image/chart/dayMarker/rule actually produces.
function editorWithNodeSelectionOnAtom() {
  const editor = makeEditor({ type: "doc", content: [{ type: "image", attrs: { src: "x.png" } }] }, [Image]);
  editor.commands.setNodeSelection(0);
  return editor;
}

// A stand-in for the real slash Suggestion plugin, registered under the
// SAME PluginKey so the snapshot's lookup path is the one production uses.
const FakeSlash = (state) => Extension.create({
  name: "fakeSlash",
  addProseMirrorPlugins() {
    return [new Plugin({ key: SlashCommandsPluginKey, state: { init: () => state, apply: (_tr, v) => v } })];
  },
});

describe("computeSnapshot", () => {
  it("returns the empty snapshot without an editor", () => {
    expect(computeSnapshot(null)).toBe(EMPTY_SNAPSHOT);
  });

  it("describes an empty paragraph at the start", () => {
    const editor = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    const s = computeSnapshot(editor);
    expect(s.selectionEmpty).toBe(true);
    expect(s.activeBlock).toEqual({ type: "paragraph", pos: 0, isBoard: false, isTitled: false, isEmpty: true });
    expect(s.query).toBeNull();
    expect(s.canUndo).toBe(false);
  });

  it("reports a non-empty selection with its range", () => {
    const editor = makeEditor({ type: "doc", content: [para("hello")] });
    editor.commands.setTextSelection({ from: 2, to: 4 });
    const s = computeSnapshot(editor);
    expect(s.selectionEmpty).toBe(false);
    expect([s.from, s.to]).toEqual([2, 4]);
  });

  it("follows the selection head into a later block", () => {
    const editor = makeEditor({ type: "doc", content: [para("a"), para("b")] });
    editor.commands.setTextSelection(4);
    expect(computeSnapshot(editor).activeBlock).toMatchObject({ type: "paragraph", pos: 3, isEmpty: false });
  });

  it("marks a titled board", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "blockquote", attrs: { blockTitle: "plan" }, content: [para("x")] }],
    });
    editor.commands.setTextSelection(2);
    expect(computeSnapshot(editor).activeBlock).toMatchObject({ type: "blockquote", pos: 0, isBoard: true, isTitled: true });
  });

  it("turns on canUndo after an edit", () => {
    const editor = makeEditor({ type: "doc", content: [para("a")] });
    editor.commands.insertContent("b");
    expect(computeSnapshot(editor).canUndo).toBe(true);
  });

  it("surfaces an active slash query", () => {
    const editor = makeEditor({ type: "doc", content: [para("a")] }, [FakeSlash({ active: true, query: "ch" })]);
    expect(computeSnapshot(editor).query).toEqual({ kind: "slash", text: "ch" });
  });

  it("reports no query when the suggestion is inactive", () => {
    // null, not {kind, text:""}: the phone toolbar swaps strips on the
    // presence of a query, so an inactive plugin must read as absent.
    const editor = makeEditor({ type: "doc", content: [para("a")] }, [FakeSlash({ active: false, query: "" })]);
    expect(computeSnapshot(editor).query).toBeNull();
  });

  it("reports the node itself as the active block for a top-level NodeSelection", () => {
    // Selecting an image, chart, dayMarker or rule is a NodeSelection at
    // depth 0. Reporting "no active block" there hid the gutter handle on
    // exactly the blocks that cannot be addressed any other way — there is
    // no caret inside an atom to fall back to.
    const editor = editorWithNodeSelectionOnAtom();   // see helper below
    const snap = computeSnapshot(editor);
    expect(snap.activeBlock).not.toBeNull();
    expect(snap.activeBlock.type).toBe("image");
    expect(typeof snap.activeBlock.pos).toBe("number");
  });

  it("still reports no active block when there is no selection at all", () => {
    // Null remains correct for a destroyed or empty editor: there is no
    // block to address, as opposed to one we failed to name.
    expect(computeSnapshot(null).activeBlock).toBeNull();
  });

  it("gives the atom branch the same five-field shape as the text-selection path", () => {
    // chart is the type that actually proves this: chart is atom: true
    // (chart.js) AND a member of BOARD_TYPES (block-title.js), so
    // isBoardType("chart") is true — and blockActionsFor's delete action
    // falls back to isBoard when canPin is false, so a missing isBoard
    // silently drops delete from the sheet for exactly that node. Chart's
    // NodeView mounts an async mermaid render (chart.js loadMermaid), which
    // this file's synchronous editors don't otherwise pull in, so image
    // stands in here: it proves all five fields are present and computed
    // with the same formulas as the text path, even though image's own
    // isBoard/isTitled happen to both be false.
    const editor = editorWithNodeSelectionOnAtom();
    const snap = computeSnapshot(editor);
    expect(snap.activeBlock).toEqual({
      type: "image",
      pos: 0,
      isBoard: false,
      isTitled: false,
      isEmpty: false,
    });
  });
});

describe("computeSnapshot — a cursor between blocks", () => {
  // THE DEVICE REPORT: on a Galaxy A34 the gutter handle vanished, and with
  // it `turn into` and `pin` — the three things that read activeBlock. A
  // GapCursor is depth 0 with no `selection.node`, so it fell into the
  // depth guard and reported "no active block" for a cursor the writer can
  // see on screen. Tapping the margin under the last block is the ordinary
  // way to produce one on a phone.
  //
  // PageScreen.test.js used to claim in a comment that no live editor can
  // reach a null activeBlock — "a caret at depth 1 or a NodeSelection at
  // depth 0". This is the third case, and it was reachable all along.

  function gapCursorEditor(content) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor({
      element: host,
      extensions: [Document, Paragraph, Text, Blockquote, BlockTitle, Image, UndoRedo, Gapcursor],
      content,
    });
    cleanup = () => { editor.destroy(); host.remove(); };
    return editor;
  }

  it("names the block the cursor sits after", () => {
    const editor = gapCursorEditor({
      type: "doc",
      content: [para("one"), { type: "image", attrs: { src: "x.png" } }],
    });
    const { state } = editor;
    // The gap after the image, at the very end of the doc.
    const $pos = state.doc.resolve(state.doc.content.size);
    editor.view.dispatch(state.tr.setSelection(new GapCursor($pos)));

    const block = computeSnapshot(editor).activeBlock;
    expect(block).not.toBeNull();
    expect(block.type).toBe("image");
    // The node's own start, not the gap's position: a pos pointing at the
    // gap would hand view.nodeDOM something that is not a node, and the
    // handle would come back null one layer up (PageScreen's gutterHandle).
    expect(editor.state.doc.nodeAt(block.pos).type.name).toBe("image");
  });

  it("falls to the block after it when there is nothing before", () => {
    // A gap above the first block has no nodeBefore. Reporting null here
    // would be the original bug with one extra step.
    const editor = gapCursorEditor({
      type: "doc",
      content: [{ type: "image", attrs: { src: "x.png" } }, para("one")],
    });
    const { state } = editor;
    editor.view.dispatch(state.tr.setSelection(new GapCursor(state.doc.resolve(0))));

    const block = computeSnapshot(editor).activeBlock;
    expect(block).not.toBeNull();
    expect(block.type).toBe("image");
    expect(block.pos).toBe(0);
  });

  it("reports no block when every block is selected", () => {
    // NOT an oversight, and not the bug above wearing a different hat.
    // AllSelection is depth 0 with no `node` too, so it reaches the same
    // guard — but there is no single block to name when the writer has
    // selected all of them, and naming the first would be a claim about
    // the selection that is false. The strip has already swapped to the
    // selection's own controls by then; the only thing left reading this
    // is the gutter handle, which correctly shows nothing.
    const editor = makeEditor({ type: "doc", content: [para("one"), para("two")] });
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    expect(computeSnapshot(editor).activeBlock).toBeNull();
  });

  describe("list indent (the phone strip's indent and outdent)", () => {
    const item = (t, extra = []) => ({ type: "listItem", attrs: { marker: "bullet" }, content: [para(t), ...extra] });
    const list = (...items) => ({ type: "list", content: items });
    const at = (editor, text) => {
      let pos = null;
      editor.state.doc.descendants((n, p) => { if (pos === null && n.isText && n.text === text) pos = p + 1; });
      editor.commands.setTextSelection(pos);
      return computeSnapshot(editor);
    };

    it("a second item can be indented, and a top-level one outdented out of the list", () => {
      const editor = makeEditor({ type: "doc", content: [list(item("milk"), item("eggs"))] }, LISTS);
      expect(at(editor, "eggs")).toMatchObject({ inListItem: true, canIndent: true, canOutdent: true });
    });

    it("the first item cannot be indented: there is no item above to nest under", () => {
      const editor = makeEditor({ type: "doc", content: [list(item("milk"), item("eggs"))] }, LISTS);
      expect(at(editor, "milk")).toMatchObject({ inListItem: true, canIndent: false });
    });

    it("outside a list there is nothing to indent or outdent", () => {
      // all false: a paragraph has no list item to sink or lift, and the
      // strip shows the two buttons only where they can act
      const editor = makeEditor({ type: "doc", content: [para("plain")] }, LISTS);
      expect(at(editor, "plain")).toMatchObject({ inListItem: false, canIndent: false, canOutdent: false });
    });
  });
});
