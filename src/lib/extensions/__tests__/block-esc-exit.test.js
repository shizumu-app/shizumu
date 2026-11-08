// Unit tests for BlockEscExit. Esc walks up to the nearest frame
// (list, blockquote, codeBlock, recipeBlock, decisionBlock, qaBlock) and moves
// the cursor to a sibling-after paragraph. If no sibling exists,
// the command inserts an empty paragraph after the frame. Inside
// a top-level paragraph or heading the command returns false.
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { UnifiedListExtensions } from "../unified-list.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";
import { RecipeBlock } from "../recipe-block.js";
import { BlockEscExit } from "../block-esc-exit.js";

function makeEditor(doc) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false }),
      ...UnifiedListExtensions,
      QABlock,
      QAPair,
      RecipeBlock,
      BlockEscExit,
    ],
    content: doc,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

describe("BlockEscExit", () => {
  it("returns false in a top-level paragraph (no frame to exit)", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    });
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3, 3))
      );
      const handled = editor.commands.blockEscExit();
      expect(handled).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("exits a blockquote into an existing following paragraph", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }],
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    });
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3, 3))
      );
      const handled = editor.commands.blockEscExit();
      expect(handled).toBe(true);
      const $from = editor.state.selection.$from;
      expect($from.parent.textContent).toBe("after");
    } finally {
      cleanup();
    }
  });

  it("creates a paragraph after the frame when no sibling exists", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }],
        },
      ],
    });
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3, 3))
      );
      const handled = editor.commands.blockEscExit();
      expect(handled).toBe(true);
      expect(editor.state.doc.childCount).toBe(2);
      expect(editor.state.doc.child(1).type.name).toBe("paragraph");
      const $from = editor.state.selection.$from;
      expect($from.parent.type.name).toBe("paragraph");
      expect($from.parent.textContent).toBe("");
    } finally {
      cleanup();
    }
  });

  it("exits a list (top-level frame) on Esc", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        {
          type: "list",
          content: [
            {
              type: "listItem",
              attrs: { marker: "bullet", checked: false, blockTitle: null, pinId: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }],
            },
          ],
        },
      ],
    });
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4, 4))
      );
      const handled = editor.commands.blockEscExit();
      expect(handled).toBe(true);
      expect(editor.state.doc.childCount).toBe(2);
      expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    } finally {
      cleanup();
    }
  });
});

describe("leaving a list nested in an item", () => {
  const li = (t, kids) => ({
    type: "listItem",
    attrs: { marker: "bullet" },
    content: [
      { type: "paragraph", content: t ? [{ type: "text", text: t }] : undefined },
      ...(kids ? [{ type: "list", content: kids }] : []),
    ],
  });
  const tree = (n) => (n.type === "text" ? n.text
    : n.type === "paragraph" ? `P(${(n.content || []).map(tree).join("")})`
    : `${n.type}[${(n.content || []).map(tree).join(", ")}]`);
  const at = (doc, word) => {
    const { editor } = makeEditor({ type: "doc", content: [{ type: "list", content: doc }, { type: "paragraph", content: [{ type: "text", text: "after" }] }] });
    let pos = null;
    editor.state.doc.descendants((n, p) => { if (n.type.name === "paragraph" && n.textContent === word && pos == null) pos = p + 1; });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
    return editor;
  };
  const shape = (editor) => tree(editor.state.doc.toJSON().content[0]);
  const caretParent = (editor) => editor.state.selection.$from.node(-1).type.name;

  it("from an item with words: a new item one level up, and no empty line inside the item above", () => {
    const editor = at([li("beds", [li("carrots")]), li("shed")], "carrots");
    expect(editor.commands.blockEscExit()).toBe(true);
    expect(shape(editor)).toBe("list[listItem[P(beds), list[listItem[P(carrots)]]], listItem[P()], listItem[P(shed)]]");
    expect(caretParent(editor)).toBe("listItem");
    expect(editor.state.selection.$from.depth).toBe(3);
  });

  it("from an empty item: that item goes, it does not stay behind as an empty bullet", () => {
    const editor = at([li("beds", [li("carrots"), li("")]), li("shed")], "");
    expect(editor.commands.blockEscExit()).toBe(true);
    expect(shape(editor)).toBe("list[listItem[P(beds), list[listItem[P(carrots)]]], listItem[P()], listItem[P(shed)]]");
  });

  it("a new item takes the outer list's kind, and starts unticked", () => {
    const task = (t, kids) => ({ ...li(t, kids), attrs: { marker: "task", checked: true } });
    const editor = at([task("beds", [li("carrots")])], "carrots");
    editor.commands.blockEscExit();
    const fresh = editor.state.selection.$from.node(-1);
    expect(fresh.attrs.marker).toBe("task");
    expect(fresh.attrs.checked).toBe(false);
  });

  it("the second Escape leaves the list whole, with no empty item left behind", () => {
    const editor = at([li("beds", [li("carrots")])], "carrots");
    editor.commands.blockEscExit();
    editor.commands.blockEscExit();
    expect(shape(editor)).toBe("list[listItem[P(beds), list[listItem[P(carrots)]]]]");
    expect(editor.state.selection.$from.parent.textContent).toBe("after");
  });

  it("a list's only item stays: removing it would take the list with it", () => {
    const editor = at([li("")], "");
    expect(editor.commands.blockEscExit()).toBe(true);
    expect(shape(editor)).toBe("list[listItem[P()]]");
  });
});
