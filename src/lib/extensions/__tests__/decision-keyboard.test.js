// Mirrors recipe-keyboard.test.js. decisionBlock's structural slot
// ("considered") sits at index 0 instead of recipe's index 1 ("do") — the
// one reindexing slot-block.js's extraction exists to prove correct.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { UnifiedListExtensions } from "../unified-list.js";
import { DecisionBlock } from "../decision-block.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";
import { BlockTitle } from "../block-title.js";
import { BlockEscExit } from "../block-esc-exit.js";

function para(text) {
  return {
    type: "paragraph",
    content: text ? [{ type: "text", text }] : undefined,
  };
}

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false }),
      ...UnifiedListExtensions,
      DecisionBlock,
      QABlock,
      QAPair,
      BlockTitle,
      BlockEscExit,
    ],
    content,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

function decisionDoc() {
  return {
    type: "doc",
    content: [
      {
        type: "decisionBlock",
        content: [
          {
            type: "list",
            content: [
              {
                type: "listItem",
                attrs: { marker: "bullet" },
                content: [para()],
              },
            ],
          },
          para(),
          para(),
        ],
      },
    ],
  };
}

function findFirstTextblockPos(doc, predicate) {
  let pos = -1;
  doc.descendants((node, p) => {
    if (pos >= 0) return false;
    if (node.isTextblock && predicate(node, p)) {
      pos = p;
      return false;
    }
    return true;
  });
  return pos;
}

function pressKey(editor, key) {
  const ev = new KeyboardEvent("keydown", { key });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev)) || false;
}

function isInsideName(editor, typeName) {
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === typeName) return true;
  }
  return false;
}

describe("DecisionBlock Enter behavior", () => {
  let env;

  beforeEach(() => {
    env = makeEditor(decisionDoc());
  });

  afterEach(() => {
    if (env) env.cleanup();
  });

  it("Enter in an empty considered item advances to chose", () => {
    const { editor } = env;
    const itemPos = findFirstTextblockPos(editor.state.doc, () => true);
    expect(itemPos).toBeGreaterThan(-1);
    editor.chain().setTextSelection(itemPos + 1).focus().run();

    pressKey(editor, "Enter");

    // Cursor now sits in decisionBlock's 2nd child (chose, index 1).
    const $from = editor.state.selection.$from;
    let decisionDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "decisionBlock") { decisionDepth = d; break; }
    }
    expect(decisionDepth).toBeGreaterThan(-1);
    expect($from.index(decisionDepth)).toBe(1);
    expect($from.parent.type.name).toBe("paragraph");
  });

  it("Enter on a considered slot with only a single never-typed-into item is left alone", () => {
    const { editor } = env;
    // The sole listItem's empty paragraph.
    let itemParaPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (itemParaPos >= 0) return false;
      if (node.type.name === "listItem") { itemParaPos = pos + 2; return false; }
      return true;
    });
    expect(itemParaPos).toBeGreaterThan(-1);
    editor.chain().setTextSelection(itemParaPos).focus().run();

    pressKey(editor, "Enter"); // advances to chose; sole item is empty but left alone

    let listNode = null;
    editor.state.doc.descendants((node) => { if (node.type.name === "list") listNode = node; });
    expect(listNode.childCount).toBe(1);

    // "left alone" is only half the claim — the Enter still ADVANCES, it just
    // doesn't consume the sole item on the way. Without this the test passed
    // on an Enter that did nothing at all.
    const $from = editor.state.selection.$from;
    let decisionDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "decisionBlock") { decisionDepth = d; break; }
    }
    expect(decisionDepth).toBeGreaterThan(-1);
    expect($from.index(decisionDepth)).toBe(1);
    expect($from.parent.type.name).toBe("paragraph");
  });

  it("Enter in empty chose advances to because", () => {
    const { editor } = env;
    const $doc = env.editor.state.doc;
    let decisionNode = null;
    let decisionPos = -1;
    $doc.forEach((n, offset) => { decisionNode = n; decisionPos = offset; });
    // chose paragraph is the 2nd child (index 1).
    const choseStart = decisionPos + 1 + decisionNode.child(0).nodeSize;
    editor.chain().setTextSelection(choseStart + 1).focus().run();
    expect(isInsideName(editor, "decisionBlock")).toBe(true);

    pressKey(editor, "Enter");

    const $from = editor.state.selection.$from;
    let decisionDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "decisionBlock") { decisionDepth = d; break; }
    }
    expect(decisionDepth).toBeGreaterThan(-1);
    expect($from.index(decisionDepth)).toBe(2);
  });

  it("Enter in non-empty chose inserts a hardBreak", () => {
    const env2 = makeEditor({
      type: "doc",
      content: [
        {
          type: "decisionBlock",
          content: [
            {
              type: "list",
              content: [{ type: "listItem", attrs: { marker: "bullet" }, content: [para()] }],
            },
            para("keep it simple"),
            para(),
          ],
        },
      ],
    });
    try {
      const { editor } = env2;
      let endPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "keep it simple") endPos = pos + node.nodeSize;
      });
      expect(endPos).toBeGreaterThan(-1);
      editor.chain().setTextSelection(endPos).focus().run();

      pressKey(editor, "Enter");

      let hasHardBreak = false;
      editor.state.doc.descendants((node) => { if (node.type.name === "hardBreak") hasHardBreak = true; });
      expect(hasHardBreak).toBe(true);
    } finally {
      env2.cleanup();
    }
  });

  it("Enter in empty because exits to a paragraph below the block", () => {
    const { editor } = env;
    const doc = editor.state.doc;
    let decisionNode = null;
    let decisionPos = -1;
    doc.forEach((n, offset) => { decisionNode = n; decisionPos = offset; });
    // because paragraph is the 3rd child (index 2).
    const becauseStart = decisionPos + 1 + decisionNode.child(0).nodeSize + decisionNode.child(1).nodeSize;
    editor.chain().setTextSelection(becauseStart + 1).focus().run();
    expect(isInsideName(editor, "decisionBlock")).toBe(true);

    pressKey(editor, "Enter");

    expect(isInsideName(editor, "decisionBlock")).toBe(false);
    const $from = editor.state.selection.$from;
    expect($from.parent.type.name).toBe("paragraph");
  });

  it("Escape exits (via blockEscExit)", () => {
    // From the chose slot (a plain paragraph, not the nested list frame) —
    // escaping from inside the considered list would exit only the list,
    // its own nested frame, matching BlockEscExit's innermost-frame-wins
    // walk (see block-esc-exit.js).
    const { editor } = env;
    const doc = editor.state.doc;
    let decisionNode = null;
    let decisionPos = -1;
    doc.forEach((n, offset) => { decisionNode = n; decisionPos = offset; });
    const choseStart = decisionPos + 1 + decisionNode.child(0).nodeSize;
    editor.chain().setTextSelection(choseStart + 1).focus().run();
    expect(isInsideName(editor, "decisionBlock")).toBe(true);

    editor.commands.blockEscExit();
    expect(isInsideName(editor, "decisionBlock")).toBe(false);
  });
});

// D-7 at slot 0 (task-4-brief.md): recipe's D-7 fix consumes a trailing
// scratch list item created by Enter-on-a-filled-item before advancing
// slots. decisionBlock's structural slot moved to index 0 — this proves
// isLastTextblockOfSlot's reindexing (slot start == block start for
// index 0) rather than just re-testing recipe's own slot-1 case.
describe("DecisionBlock considered-slot Enter advance consumes the trailing empty item (D-7 at slot 0)", () => {
  function docWithOneConsideredItem() {
    return {
      type: "doc",
      content: [
        {
          type: "decisionBlock",
          content: [
            {
              type: "list",
              content: [
                { type: "listItem", attrs: { marker: "bullet" }, content: [para("option A")] },
              ],
            },
            para(),
            para(),
          ],
        },
      ],
    };
  }

  it("Enter twice from a filled considered item advances to chose without leaving an orphaned empty bullet", () => {
    const env = makeEditor(docWithOneConsideredItem());
    const { editor } = env;
    try {
      // Cursor at the end of "option A".
      let itemEndPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "option A") itemEndPos = pos + node.nodeSize;
      });
      expect(itemEndPos).toBeGreaterThan(-1);
      editor.chain().setTextSelection(itemEndPos).focus().run();

      // First Enter: non-empty item -> the list's own keymap splits off a
      // fresh (empty) sibling item.
      pressKey(editor, "Enter");
      let listNode = null;
      editor.state.doc.descendants((node) => { if (node.type.name === "list") listNode = node; });
      expect(listNode.childCount).toBe(2);

      // Second Enter: on that now-empty trailing item -> advances to the
      // chose slot AND removes the scratch item (no orphaned second bullet).
      pressKey(editor, "Enter");
      listNode = null;
      editor.state.doc.descendants((node) => { if (node.type.name === "list") listNode = node; });
      expect(listNode.childCount).toBe(1);
      expect(listNode.child(0).textContent).toBe("option A");

      // Cursor now sits in the chose slot (decisionBlock's 2nd child, index 1).
      const $from = editor.state.selection.$from;
      let decisionDepth = -1;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "decisionBlock") { decisionDepth = d; break; }
      }
      expect(decisionDepth).toBeGreaterThan(-1);
      expect($from.index(decisionDepth)).toBe(1);
    } finally {
      env.cleanup();
    }
  });
});
