// Unit tests for BlockTabNoop. The extension claims Tab and Shift-Tab
// outside list items and table cells so the browser doesn't tab-focus
// away from the editor and the doc doesn't gain a literal tab character.
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { UnifiedListExtensions } from "../unified-list.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";
import { BlockTabNoop } from "../block-tab-noop.js";

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
      BlockTabNoop,
    ],
    content: doc,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

describe("BlockTabNoop", () => {
  it("returns true (claims the key) when cursor is in a top-level paragraph", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    });
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3, 3))
      );
      const docBefore = editor.state.doc.toJSON();
      const handled = editor.commands.blockTabNoop();
      expect(handled).toBe(true);
      expect(editor.state.doc.toJSON()).toEqual(docBefore);
    } finally {
      cleanup();
    }
  });

  it("returns false (does NOT claim) when cursor is inside a listItem", () => {
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
      const handled = editor.commands.blockTabNoop();
      expect(handled).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("returns true inside a blockquote (not a listItem)", () => {
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
      const handled = editor.commands.blockTabNoop();
      expect(handled).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// D-4 (QA sweep): BlockTabNoop only exempted listItem, so Tab inside a
// table cell fell through to the no-op instead of the table extension's
// own Tab-to-next-cell keymap — typing "aaa" + Tab + "bbb" + Tab + "ccc"
// produced a single cell reading "aaabbbccc" with every other cell empty.
function makeTableEditor(doc) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      BlockTabNoop,
    ],
    content: doc,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

function pressKey(editor, key) {
  const ev = new KeyboardEvent("keydown", { key });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev)) || false;
}

function firstParagraphPosInCell(doc, cellIndex) {
  let seen = -1;
  let pos = -1;
  doc.descendants((node, p) => {
    if (pos >= 0) return false;
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      seen++;
      if (seen === cellIndex) {
        pos = p + 2; // step into the cell, then into its paragraph
        return false;
      }
      return false; // don't recurse into cells we're not targeting
    }
    return true;
  });
  return pos;
}

describe("Tab navigation inside a table (D-4)", () => {
  function twoCellTableDoc() {
    return {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph" }] },
                { type: "tableCell", content: [{ type: "paragraph" }] },
              ],
            },
          ],
        },
      ],
    };
  }

  it("Tab moves the cursor to the next cell instead of being swallowed", () => {
    const { editor, cleanup } = makeTableEditor(twoCellTableDoc());
    try {
      const firstCellPos = firstParagraphPosInCell(editor.state.doc, 0);
      editor.chain().setTextSelection(firstCellPos).insertContent("aaa").run();

      const handled = pressKey(editor, "Tab");
      expect(handled).toBe(true);

      editor.chain().insertContent("bbb").run();

      const cellTexts = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "tableCell") cellTexts.push(node.textContent);
      });
      // Previously: ["aaabbb", ""] — Tab was swallowed and both strings
      // landed in the first cell. Fixed: each string in its own cell.
      expect(cellTexts).toEqual(["aaa", "bbb"]);
    } finally {
      cleanup();
    }
  });

  it("blockTabNoop command steps aside (returns false) inside a table cell", () => {
    const { editor, cleanup } = makeTableEditor(twoCellTableDoc());
    try {
      const firstCellPos = firstParagraphPosInCell(editor.state.doc, 0);
      editor.chain().setTextSelection(firstCellPos).run();
      const handled = editor.commands.blockTabNoop();
      expect(handled).toBe(false);
    } finally {
      cleanup();
    }
  });
});
