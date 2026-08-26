import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { BlockMovement, moveBlockAtPos } from "../block-movement.js";
import { BlockTitle } from "../block-title.js";
import { UnifiedListExtensions } from "../unified-list.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";

// ProseMirror may append a trailing paragraph when a selection is first set
// into a document that ends with block (non-text) nodes. All assertions that
// inspect top-level node order must filter to board/item nodes only.
const BOARD_TYPES = new Set(["list", "blockquote", "qaBlock", "table"]);

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      ...UnifiedListExtensions,
      QABlock,
      QAPair,
      BlockTitle,
      BlockMovement,
    ],
    content,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

function boardTitles(editor) {
  return editor.getJSON().content
    .filter(n => BOARD_TYPES.has(n.type))
    .map(n => n.attrs?.blockTitle ?? null);
}

// Place cursor inside a node identified by its blockTitle attr.
function setCursorByTitle(editor, title) {
  let targetPos = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs?.blockTitle === title && targetPos === -1) {
      targetPos = pos + 2; // open token + paragraph open
      return false;
    }
  });
  if (targetPos < 0) throw new Error(`No node with blockTitle="${title}" found`);
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.near(editor.state.doc.resolve(targetPos))
    )
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const threeBlockquotes = {
  type: "doc",
  content: [
    { type: "blockquote", attrs: { blockTitle: "A" }, content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
    { type: "blockquote", attrs: { blockTitle: "B" }, content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
    { type: "blockquote", attrs: { blockTitle: "C" }, content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }] },
  ],
};

// A top-level list containing three listItems.
const listWithThreeItems = {
  type: "doc",
  content: [
    {
      type: "list",
      attrs: { blockTitle: "L", marker: "bullet" },
      content: [
        { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "item 1" }] }] },
        { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "item 2" }] }] },
        { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "item 3" }] }] },
      ],
    },
  ],
};

// Two top-level lists, first containing two listItems. Used for moveParentUnit.
const twoListsForParent = {
  type: "doc",
  content: [
    {
      type: "list",
      attrs: { blockTitle: "List1", marker: "bullet" },
      content: [
        { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "item A" }] }] },
        { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "item B" }] }] },
      ],
    },
    {
      type: "list",
      attrs: { blockTitle: "List2", marker: "bullet" },
      content: [
        { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "item C" }] }] },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// moveUnit("up") — top-level blockquote
// ---------------------------------------------------------------------------

describe("BlockMovement.moveUnit up on top-level blockquotes", () => {
  let env;
  beforeEach(() => { env = makeEditor(threeBlockquotes); });
  afterEach(() => env?.cleanup());

  it("moves blockquote B up past A", () => {
    setCursorByTitle(env.editor, "B");
    env.editor.commands.moveUnit("up");
    expect(boardTitles(env.editor)).toEqual(["B", "A", "C"]);
  });

  it("is a no-op when already at the first sibling (A)", () => {
    setCursorByTitle(env.editor, "A");
    const before = boardTitles(env.editor);
    env.editor.commands.moveUnit("up");
    expect(boardTitles(env.editor)).toEqual(before);
  });

  it("moves blockquote C up past B", () => {
    setCursorByTitle(env.editor, "C");
    env.editor.commands.moveUnit("up");
    expect(boardTitles(env.editor)).toEqual(["A", "C", "B"]);
  });
});

// ---------------------------------------------------------------------------
// moveUnit("down") — top-level blockquote
// ---------------------------------------------------------------------------

describe("BlockMovement.moveUnit down on top-level blockquotes", () => {
  let env;
  beforeEach(() => { env = makeEditor(threeBlockquotes); });
  afterEach(() => env?.cleanup());

  it("moves blockquote A down past B", () => {
    setCursorByTitle(env.editor, "A");
    env.editor.commands.moveUnit("down");
    expect(boardTitles(env.editor)).toEqual(["B", "A", "C"]);
  });

  it("is a no-op when already at the last sibling (C)", () => {
    setCursorByTitle(env.editor, "C");
    const before = boardTitles(env.editor);
    env.editor.commands.moveUnit("down");
    expect(boardTitles(env.editor)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// moveUnit("up") on listItem
// ---------------------------------------------------------------------------

describe("BlockMovement.moveUnit up on listItem", () => {
  let env;
  beforeEach(() => { env = makeEditor(listWithThreeItems); });
  afterEach(() => env?.cleanup());

  it("moves item 2 up past item 1", () => {
    // Cursor inside item 2 (second listItem).
    let item2Pos = -1;
    env.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "listItem" && item2Pos === -1) {
        // Skip first — we want the second listItem.
        item2Pos = 0; // sentinel: first found
      } else if (node.type.name === "listItem" && item2Pos === 0) {
        item2Pos = pos + 2;
        return false;
      }
    });
    env.editor.view.dispatch(
      env.editor.state.tr.setSelection(TextSelection.near(env.editor.state.doc.resolve(item2Pos)))
    );
    env.editor.commands.moveUnit("up");
    // Item texts in order after move.
    const items = env.editor.getJSON().content
      .find(n => n.type === "list")
      ?.content?.map(li => li.content?.[0]?.content?.[0]?.text) ?? [];
    expect(items).toEqual(["item 2", "item 1", "item 3"]);
  });

  it("is a no-op for the first listItem", () => {
    // Cursor at start of first listItem.
    let firstPos = -1;
    env.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "listItem" && firstPos === -1) {
        firstPos = pos + 2;
        return false;
      }
    });
    env.editor.view.dispatch(
      env.editor.state.tr.setSelection(TextSelection.near(env.editor.state.doc.resolve(firstPos)))
    );
    const before = env.editor.getJSON();
    env.editor.commands.moveUnit("up");
    const after = env.editor.getJSON();
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// moveParentUnit — moves containing list past its sibling
// ---------------------------------------------------------------------------

describe("BlockMovement.moveParentUnit up", () => {
  let env;
  beforeEach(() => { env = makeEditor(twoListsForParent); });
  afterEach(() => env?.cleanup());

  it("moves List1 up past nothing (no-op at first sibling)", () => {
    // Cursor inside List1 / item A.
    let itemPos = -1;
    env.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "listItem" && itemPos === -1) {
        itemPos = pos + 2;
        return false;
      }
    });
    env.editor.view.dispatch(
      env.editor.state.tr.setSelection(TextSelection.near(env.editor.state.doc.resolve(itemPos)))
    );
    const before = boardTitles(env.editor);
    env.editor.commands.moveParentUnit("up");
    expect(boardTitles(env.editor)).toEqual(before);
  });

  it("moves List2 up past List1 (cursor in listItem inside List2)", () => {
    // Find last listItem (inside List2).
    let lastItemPos = -1;
    env.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "listItem") {
        lastItemPos = pos + 2;
      }
    });
    env.editor.view.dispatch(
      env.editor.state.tr.setSelection(TextSelection.near(env.editor.state.doc.resolve(lastItemPos)))
    );
    env.editor.commands.moveParentUnit("up");
    expect(boardTitles(env.editor)).toEqual(["List2", "List1"]);
  });
});

// ---------------------------------------------------------------------------
// moveParentUnit no-ops when no parent exists
// ---------------------------------------------------------------------------

describe("BlockMovement.moveParentUnit no parent", () => {
  let env;
  beforeEach(() => { env = makeEditor(threeBlockquotes); });
  afterEach(() => env?.cleanup());

  it("is a no-op when cursor is in a top-level blockquote with no deeper parent", () => {
    setCursorByTitle(env.editor, "B");
    // B is top-level; its unit is "top" at depth 1, no parent at depth 0.
    const before = boardTitles(env.editor);
    env.editor.commands.moveParentUnit("up");
    expect(boardTitles(env.editor)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// TODO: tableRow movement
// Table extension integration in jsdom is brittle (requires proper
// contenteditable DOM contract). Test moveUnit("up") on a tableRow in a
// real browser or Playwright e2e suite instead.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// moveBlockAtPos — moving a block WITHOUT relying on the selection.
//
// Why this exists: a board's title is an <input> the NodeView renders as
// chrome, OUTSIDE the contenteditable, and the NodeView's stopEvent()
// returns true for it. So keys pressed in the title never reach
// ProseMirror's keymap at all, and Alt+Arrow — which moves the block from
// anywhere else — did nothing there. The user's report: "when we are in
// the title it should move the whole block up/down, similar to bullets".
//
// The title handler cannot use moveUnit(): with focus in the input the PM
// selection is wherever it was last left, which is some other block (or
// nothing). It has to say WHICH block to move, by position.
// ---------------------------------------------------------------------------

function posOfTitle(editor, title) {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.attrs?.blockTitle === title) { found = pos; return false; }
  });
  if (found < 0) throw new Error(`No node with blockTitle="${title}"`);
  return found;
}

describe("moveBlockAtPos", () => {
  let env;
  beforeEach(() => { env = makeEditor(threeBlockquotes); });
  afterEach(() => env?.cleanup());

  it("moves the addressed block up regardless of where the selection is", () => {
    // Selection parked on A; the move addresses B. moveUnit() would have
    // moved A — which is exactly the bug when focus sits in B's title.
    setCursorByTitle(env.editor, "A");
    const pos = posOfTitle(env.editor, "B");
    const { view } = env.editor;
    expect(moveBlockAtPos(view.state, view.dispatch, pos, "up")).not.toBe(null);
    expect(boardTitles(env.editor)).toEqual(["B", "A", "C"]);
  });

  it("moves the addressed block down", () => {
    setCursorByTitle(env.editor, "A");
    const pos = posOfTitle(env.editor, "B");
    const { view } = env.editor;
    expect(moveBlockAtPos(view.state, view.dispatch, pos, "down")).not.toBe(null);
    expect(boardTitles(env.editor)).toEqual(["A", "C", "B"]);
  });

  it("returns the block's new position so the caller can refocus its title", () => {
    // The NodeView is destroyed and rebuilt by the move, taking the focused
    // <input> with it. The caller needs the new position to find the
    // replacement slot and put focus back, or every Alt+Arrow would drop
    // the user out of the title after one step.
    const posB = posOfTitle(env.editor, "B");
    const { view } = env.editor;
    const newPos = moveBlockAtPos(view.state, view.dispatch, posB, "up");
    expect(newPos).toBe(posOfTitle(env.editor, "B"));
    expect(newPos).not.toBe(posB);
  });

  it("returns null at the first sibling, so the caller knows nothing moved", () => {
    // Not 0 and not a thrown error: 0 is a valid document position, and the
    // caller distinguishes "moved to 0" from "could not move".
    const pos = posOfTitle(env.editor, "A");
    const { view } = env.editor;
    expect(moveBlockAtPos(view.state, view.dispatch, pos, "up")).toBe(null);
    expect(boardTitles(env.editor)).toEqual(["A", "B", "C"]);
  });

  it("returns null at the last sibling", () => {
    const pos = posOfTitle(env.editor, "C");
    const { view } = env.editor;
    expect(moveBlockAtPos(view.state, view.dispatch, pos, "down")).toBe(null);
    expect(boardTitles(env.editor)).toEqual(["A", "B", "C"]);
  });

  it("leaves the selection alone — focus belongs to the title input", () => {
    // Moving the selection into the moved block would yank focus out of the
    // title the user is typing in, which is the whole surface this serves.
    setCursorByTitle(env.editor, "A");
    const before = env.editor.state.selection.from;
    const pos = posOfTitle(env.editor, "C");
    const { view } = env.editor;
    moveBlockAtPos(view.state, view.dispatch, pos, "up");
    // A did not move, so its text is still at the same offset.
    expect(env.editor.state.selection.from).toBe(before);
  });

  it("returns null for a position that holds no node", () => {
    const { view } = env.editor;
    expect(moveBlockAtPos(view.state, view.dispatch, 99999, "up")).toBe(null);
  });

  it("moves a list the same way it moves a blockquote", () => {
    // "verify all blocks behavior": the title contract must not be
    // blockquote-only. A list is the type most users meet it on.
    env.cleanup();
    env = makeEditor({
      type: "doc",
      content: [
        listWithThreeItems.content[0],
        { type: "blockquote", attrs: { blockTitle: "Q" }, content: [{ type: "paragraph", content: [{ type: "text", text: "q" }] }] },
      ],
    });
    const pos = posOfTitle(env.editor, "L");
    const { view } = env.editor;
    expect(moveBlockAtPos(view.state, view.dispatch, pos, "down")).not.toBe(null);
    expect(boardTitles(env.editor)).toEqual(["Q", "L"]);
  });
});
