// New-behavior tests from the block keymap rewrite.
//
// Coverage for the behaviors added by the rewrite that aren't naturally
// covered by the existing test files:
//   - Shift+Enter inserts a hardBreak inside a list item.
//   - Escape inside a board (list / blockquote / qaBlock) exits to a
//     paragraph after the board.
//   - Blockquote Enter at end of empty content preserves the board.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockTitle } from "../block-title.js";
import { UnifiedListExtensions } from "../unified-list.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";
import { BlockEscExit } from "../block-esc-exit.js";
import { TextSelection } from "@tiptap/pm/state";

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false }),
      ...UnifiedListExtensions,
      BlockTitle,
      QABlock,
      QAPair,
      BlockEscExit,
    ],
    content,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

describe("Shift+Enter inserts a hardBreak", () => {
  it("inside a list item, mid-text, Shift+Enter splits into a soft line break", () => {
    const env = makeEditor({
      type: "doc",
      content: [{
        type: "list",
        content: [{
          type: "listItem",
          attrs: { marker: "bullet" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
        }],
      }],
    });
    try {
      // Place cursor between "a" and "bc".
      let textPos = -1;
      env.editor.state.doc.descendants((node, pos) => {
        if (textPos >= 0) return false;
        if (node.isText && node.text === "abc") { textPos = pos + 1; return false; }
      });
      env.editor.view.dispatch(env.editor.state.tr.setSelection(
        TextSelection.near(env.editor.state.doc.resolve(textPos))
      ));

      const ok = env.editor.commands.setHardBreak();
      expect(ok).toBe(true);

      const json = env.editor.getJSON();
      const para = json.content[0].content[0].content[0];
      const types = para.content.map((n) => n.type);
      expect(types).toContain("hardBreak");
    } finally {
      env.cleanup();
    }
  });
});

describe("Escape exits the current board to a paragraph after", () => {
  it("inside a list body, Esc lands cursor in a paragraph after the list", () => {
    const env = makeEditor({
      type: "doc",
      content: [{
        type: "list",
        content: [{
          type: "listItem",
          attrs: { marker: "bullet" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
        }],
      }],
    });
    try {
      env.editor.commands.focus("end");
      env.editor.commands.blockEscExit();

      const { $from } = env.editor.state.selection;
      let insideList = false;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "list") { insideList = true; break; }
      }
      expect(insideList).toBe(false);
      expect($from.parent.type.name).toBe("paragraph");
    } finally {
      env.cleanup();
    }
  });

  it("inside a blockquote body, Esc lands cursor in a paragraph after", () => {
    const env = makeEditor({
      type: "doc",
      content: [{
        type: "blockquote",
        attrs: { blockTitle: "title" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
      }],
    });
    try {
      env.editor.commands.focus("end");
      env.editor.commands.blockEscExit();

      const { $from } = env.editor.state.selection;
      let insideBQ = false;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "blockquote") { insideBQ = true; break; }
      }
      expect(insideBQ).toBe(false);
      expect($from.parent.type.name).toBe("paragraph");
    } finally {
      env.cleanup();
    }
  });
});

describe("Backspace on empty first list item merges upward", () => {
  it("with a paragraph above the list, removes the empty first item and lands cursor at end of paragraph above", () => {
    const env = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        {
          type: "list",
          content: [
            { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph" }] },
            { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
          ],
        },
      ],
    });
    try {
      // Place cursor in the empty first listItem.
      let pos = -1;
      env.editor.state.doc.descendants((node, p) => {
        if (pos >= 0) return false;
        if (node.type.name === "paragraph" && node.content.size === 0 && p > 0) {
          pos = p + 1;
          return false;
        }
      });
      env.editor.view.dispatch(env.editor.state.tr.setSelection(
        TextSelection.near(env.editor.state.doc.resolve(pos))
      ));

      const ev = new KeyboardEvent("keydown", { key: "Backspace" });
      env.editor.view.someProp("handleKeyDown", (f) => f(env.editor.view, ev));

      const json = env.editor.getJSON();
      // List should still exist (it had two items; only the empty first one is gone).
      const list = json.content.find((n) => n.type === "list");
      expect(list).toBeTruthy();
      expect(list.content.length).toBe(1);
      expect(list.content[0].content[0].content[0].text).toBe("second");

      // Cursor at end of "before" paragraph.
      const { $from } = env.editor.state.selection;
      expect($from.parent.type.name).toBe("paragraph");
      expect($from.parent.textContent).toBe("before");
      expect($from.parentOffset).toBe("before".length);
    } finally {
      env.cleanup();
    }
  });

  it("with paragraph above and SOLE empty item, removes the whole list", () => {
    const env = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "above" }] },
        {
          type: "list",
          content: [{ type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph" }] }],
        },
      ],
    });
    try {
      env.editor.commands.focus("end");
      const ev = new KeyboardEvent("keydown", { key: "Backspace" });
      env.editor.view.someProp("handleKeyDown", (f) => f(env.editor.view, ev));

      const json = env.editor.getJSON();
      // No list anywhere.
      const hasList = json.content.some((n) => n.type === "list");
      expect(hasList).toBe(false);
      // "above" paragraph survives.
      expect(json.content[0].type).toBe("paragraph");
      expect(json.content[0].content[0].text).toBe("above");

      // Cursor lands at end of "above".
      const { $from } = env.editor.state.selection;
      expect($from.parentOffset).toBe("above".length);
    } finally {
      env.cleanup();
    }
  });
});

describe("Blockquote Enter at end of empty preserves the board", () => {
  it("empty paragraph at end of blockquote, Enter exits without dropping the board", () => {
    const env = makeEditor({
      type: "doc",
      content: [{
        type: "blockquote",
        attrs: { blockTitle: null },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "first" }] },
          { type: "paragraph" },
        ],
      }],
    });
    try {
      env.editor.commands.focus("end");
      const ev = new KeyboardEvent("keydown", { key: "Enter" });
      env.editor.view.someProp("handleKeyDown", (f) => f(env.editor.view, ev));

      const json = env.editor.getJSON();
      // Blockquote must survive.
      const hasBlockquote = json.content.some((n) => n.type === "blockquote");
      expect(hasBlockquote).toBe(true);
      // A paragraph follows the blockquote.
      const bqIdx = json.content.findIndex((n) => n.type === "blockquote");
      expect(json.content[bqIdx + 1]?.type).toBe("paragraph");
    } finally {
      env.cleanup();
    }
  });

  it("empty paragraph in an UNTITLED, body-otherwise-empty blockquote still preserves the board", () => {
    const env = makeEditor({
      type: "doc",
      content: [{
        type: "blockquote",
        attrs: { blockTitle: null },
        content: [{ type: "paragraph" }],
      }],
    });
    try {
      env.editor.commands.focus("end");
      const ev = new KeyboardEvent("keydown", { key: "Enter" });
      env.editor.view.someProp("handleKeyDown", (f) => f(env.editor.view, ev));

      const json = env.editor.getJSON();
      // Even when fully empty, the board persists (no dropBoard path anymore).
      const hasBlockquote = json.content.some((n) => n.type === "blockquote");
      expect(hasBlockquote).toBe(true);
    } finally {
      env.cleanup();
    }
  });
});
