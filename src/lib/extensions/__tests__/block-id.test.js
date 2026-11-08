// The BlockId extension in a real editor, built from the same list both
// shells use (buildEditingExtensions). The rules are unit-tested in
// src/lib/__tests__/block-id.test.js; this is where they meet ProseMirror:
// a split, a copy, a move, an undo, a carried-forward pin, and a stored
// page opened twice.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Slice, Fragment } from "@tiptap/pm/model";
import { buildEditingExtensions, PIN_EDITOR_EXTENSIONS } from "../../render/shared-extensions.js";
import { setContentAsLoad, BLOCK_ID_BACKFILL_META } from "../block-id.js";
import { derivedBlockId, fillDerivedBlockIds, walkBlocks, carriesBlockId } from "../../block-id.js";
import { pinToNodes } from "../../pin-carry-forward.js";

const editors = [];
afterEach(() => {
  while (editors.length) {
    const { editor, host } = editors.pop();
    editor.destroy();
    host.remove();
  }
});

const para = (t, attrs) => ({ type: "paragraph", ...(attrs ? { attrs } : {}), content: [{ type: "text", text: t }] });
const doc = (...nodes) => ({ type: "doc", content: nodes });

// A page as 0.8.1 stored it: a list, a quote, prose, a decision. No ids.
const STORED_081 = doc(
  para("the plan for the move"),
  { type: "list", attrs: { blockTitle: "before friday" }, content: [
    { type: "listItem", attrs: { marker: "task", checked: true }, content: [para("call the landlord")] },
    { type: "listItem", attrs: { marker: "task", checked: false }, content: [para("book the van")] },
  ] },
  { type: "blockquote", content: [para("pack the books last")] },
  para("then the rest"),
);

function make(content, { pageId = "page-1", extensions } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: extensions ?? buildEditingExtensions({ getPageId: () => pageId }),
    content,
  });
  editors.push({ editor, host });
  return editor;
}

// TipTap emits `create` (where the load backfill runs) on a zero timeout.
const created = () => new Promise((r) => setTimeout(r, 0));

/** [type, path, id] for every id-carrying block, in document order. */
function ids(editor) {
  const out = [];
  walkBlocks(editor.state.doc, (_n, path, _pos, type, id) => {
    if (carriesBlockId(type)) out.push([type, path.join("."), id]);
  });
  return out;
}
const idList = (editor) => ids(editor).map(([, , id]) => id);

function topLevelPos(editor, index) {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
  return pos;
}

describe("BlockId — a stored page opened", () => {
  it("gives every block of a pre-0.8.2 page its derived id", async () => {
    const editor = make(STORED_081, { pageId: "page-081" });
    await created();
    for (const [, path, id] of ids(editor)) {
      expect(id).toBe(derivedBlockId("page-081", path.split(".").map(Number)));
    }
    expect(ids(editor).length).toBe(7);
  });

  it("gives the same ids on two loads, and the same ids export code derives", async () => {
    const a = make(STORED_081, { pageId: "page-081" });
    const b = make(STORED_081, { pageId: "page-081" });
    await created();
    expect(idList(a)).toEqual(idList(b));
    const exported = [];
    walkBlocks(fillDerivedBlockIds(STORED_081, "page-081"), (_n, _p, _pos, type, id) => {
      if (carriesBlockId(type)) exported.push(id);
    });
    expect(idList(a)).toEqual(exported);
  });

  it("gives the same ids when the page is switched to (setContent) as when it is mounted", async () => {
    const mounted = make(STORED_081, { pageId: "page-081" });
    let pageId = "other";
    const switched = make(doc(para("another page")), { extensions: buildEditingExtensions({ getPageId: () => pageId }) });
    await created();
    pageId = "page-081";
    setContentAsLoad(switched, STORED_081);
    expect(idList(switched)).toEqual(idList(mounted));
  });

  it("gives the paragraph the parse adds after a closing list its derived id too, the same each load", async () => {
    // TrailingNode adds an empty paragraph after a doc that ends in a list.
    // It is part of the load, so its id is derived, not new: a read-only
    // page shows the same ids every time it is opened.
    const endsInList = doc(para("a"), { type: "list", content: [
      { type: "listItem", attrs: { marker: "bullet" }, content: [para("b")] },
    ] });
    const loads = [];
    for (let i = 0; i < 2; i++) {
      const editor = make(doc(para("blank")), { pageId: "pl" });
      await created();
      setContentAsLoad(editor, endsInList);
      expect(editor.state.doc.lastChild.type.name).toBe("paragraph");
      expect(editor.state.doc.lastChild.attrs.blockId).toBe(derivedBlockId("pl", [2]));
      loads.push(idList(editor));
    }
    expect(loads[0]).toEqual(loads[1]);
  });

  it("keeps the backfill out of the update event and out of the undo history", async () => {
    // The update event is what a host schedules its save from; history is
    // what ctrl+z walks. A load is neither an edit nor something to undo.
    const editor = make(STORED_081);
    const updates = [];
    const backfills = [];
    editor.on("update", () => updates.push(1));
    editor.on("transaction", ({ transaction, appendedTransactions }) => {
      for (const tr of [transaction, ...(appendedTransactions || [])]) {
        if (tr.getMeta(BLOCK_ID_BACKFILL_META)) backfills.push(tr);
      }
    });
    await created();
    expect(backfills.length).toBe(1);
    expect(updates).toEqual([]); // the load changed attrs only, and is not a writer's edit
    const before = JSON.stringify(editor.getJSON());
    editor.commands.undo();
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });

  it("leaves ids a page already has as they are", async () => {
    const withIds = doc(para("a", { blockId: "aaaaaaaaaaaa" }), para("b", { blockId: "bbbbbbbbbbbb" }));
    const editor = make(withIds);
    await created();
    expect(idList(editor)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  });

  it("settles a stored duplicate the same way on every load", async () => {
    const dup = doc(para("a", { blockId: "same" }), para("b", { blockId: "same" }));
    const a = make(dup, { pageId: "p" });
    const b = make(dup, { pageId: "p" });
    await created();
    expect(idList(a)).toEqual(["same", derivedBlockId("p", [1])]);
    expect(idList(b)).toEqual(idList(a));
  });
});

describe("BlockId — edits", () => {
  const settled = async (content = doc(para("one two", { blockId: "orig00000001" }), para("after", { blockId: "orig00000002" }))) => {
    const editor = make(content);
    await created();
    return editor;
  };

  it("a split keeps the id on the first half and gives the second a new one", async () => {
    const editor = await settled();
    // Caret between "one" and " two".
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    editor.commands.splitBlock();
    const list = idList(editor);
    expect(editor.state.doc.child(0).textContent).toBe("one");
    expect(editor.state.doc.child(1).textContent).toBe(" two");
    expect(list[0]).toBe("orig00000001");
    expect(list[1]).toMatch(/^[0-9a-z]{12}$/);
    expect(list[1]).not.toBe("orig00000001");
    expect(new Set(list).size).toBe(list.length);
  });

  it("Enter at the start of a paragraph leaves the id with its words, not the new blank line", async () => {
    const editor = await settled();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    editor.commands.splitBlock();
    expect(editor.state.doc.child(0).textContent).toBe("");
    expect(editor.state.doc.child(1).textContent).toBe("one two");
    const list = idList(editor);
    expect(list[1]).toBe("orig00000001");
    expect(list[0]).not.toBe("orig00000001");
    expect(new Set(list).size).toBe(list.length);
  });

  it("a pasted copy below its original gets a new id; the original keeps its own", async () => {
    const editor = await settled();
    const original = editor.state.doc.child(0);
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, original));
    const list = idList(editor);
    expect(list[0]).toBe("orig00000001");
    expect(list[2]).not.toBe("orig00000001");
    expect(new Set(list).size).toBe(list.length);
  });

  it("a pasted copy ABOVE its original gets the new id, not the original", async () => {
    // First-in-document-order alone would hand the original's id to the
    // copy, and anything pointing at the original would follow the copy.
    const editor = await settled();
    const original = editor.state.doc.child(1);
    editor.view.dispatch(editor.state.tr.insert(0, original));
    const list = idList(editor);
    expect(list[2]).toBe("orig00000002"); // the original, now third
    expect(list[0]).not.toBe("orig00000002");
    expect(new Set(list).size).toBe(list.length);
  });

  it("a paste through the view (the clipboard's HTML carries the id) gets a new id", async () => {
    const editor = await settled();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)));
    // jsdom has no ClipboardEvent; ProseMirror only hands the event on.
    const event = new Event("paste");
    editor.view.pasteHTML('<p data-block-id="orig00000001">one two</p><p>more</p>', event);
    const list = idList(editor);
    expect(list.filter((id) => id === "orig00000001").length).toBe(1);
    expect(list[0]).toBe("orig00000001");
    expect(new Set(list).size).toBe(list.length);
    expect(list.every(Boolean)).toBe(true);
  });

  it("a cut then a paste keeps the moved block's id", async () => {
    const editor = await settled();
    const moved = editor.state.doc.child(0);
    const size = moved.nodeSize;
    editor.view.dispatch(editor.state.tr.delete(0, size));
    expect(idList(editor)).toEqual(["orig00000002"]);
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, moved));
    expect(idList(editor)).toEqual(["orig00000002", "orig00000001"]);
  });

  it("a drag (delete and insert in one transaction) keeps the moved block's id", async () => {
    const editor = await settled();
    const moved = editor.state.doc.child(0);
    const tr = editor.state.tr.delete(0, moved.nodeSize);
    tr.insert(tr.doc.content.size, moved);
    editor.view.dispatch(tr);
    expect(idList(editor)).toEqual(["orig00000002", "orig00000001"]);
  });

  it("undo of a paste takes the copy and its new id back; redo brings both", async () => {
    const editor = await settled();
    const before = JSON.stringify(editor.getJSON());
    const original = editor.state.doc.child(0);
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, original));
    const pasted = idList(editor)[2];
    expect(pasted).not.toBe("orig00000001");
    editor.commands.undo();
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    editor.commands.redo();
    expect(idList(editor)).toEqual(["orig00000001", "orig00000002", pasted]);
  });

  it("a carried-forward pin lands with a fresh id, not its source block's", async () => {
    // The pin's cache holds the source block as it was saved: blockId
    // included (refresh_pin_caches stores the whole node).
    const pin = {
      id: "PIN1",
      object_type: "board",
      title: "before friday",
      content: JSON.stringify({ type: "list", attrs: { pinId: "PIN1", blockId: "src000000001", blockTitle: "before friday" }, content: [
        { type: "listItem", attrs: { marker: "task", checked: false }, content: [para("book the van", { blockId: "src000000002" })] },
      ] }),
    };
    for (const keepPinIds of [false, true]) {
      const editor = await settled();
      const nodes = pinToNodes(pin, { keepPinIds });
      const built = nodes.map((n) => editor.state.schema.nodeFromJSON(n));
      editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, Fragment.from(built)));
      const list = idList(editor);
      expect(list).not.toContain("src000000001");
      expect(list).not.toContain("src000000002");
      expect(list.every(Boolean)).toBe(true);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("a block inserted from outside the editor with no id gets one", async () => {
    const editor = await settled();
    const slice = new Slice(Fragment.from(editor.state.schema.nodeFromJSON(para("from the slash menu"))), 0, 0);
    editor.view.dispatch(editor.state.tr.replace(editor.state.doc.content.size, editor.state.doc.content.size, slice));
    expect(idList(editor).every(Boolean)).toBe(true);
  });
});

describe("BlockId — the pin editors", () => {
  it("keep the ids they are given and invent none", async () => {
    // A pin editor holds blocks of a page it does not know; an id it made up
    // would replace the block's own when the edit is spliced back.
    const editor = make(doc(para("kept", { blockId: "orig00000001" }), para("cached before 0.8.2")), {
      extensions: PIN_EDITOR_EXTENSIONS,
    });
    await created();
    editor.view.dispatch(editor.state.tr.insertText(" edited", 5));
    const json = editor.getJSON();
    expect(json.content[0].attrs.blockId).toBe("orig00000001");
    // No id was invented for the block that came without one: the page's
    // editor gives it one when the edit lands there.
    expect(json.content[1].attrs.blockId).toBe(null);
  });
});
