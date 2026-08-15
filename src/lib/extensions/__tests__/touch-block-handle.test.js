import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TouchBlockHandle, TouchBlockHandlePluginKey } from "../touch-block-handle.js";
import { BLOCK_ACTIONS_EVENT, BLOCK_INSERT_EVENT } from "../dispatch-block-actions.js";

function makeEditor(doc) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [StarterKit, TouchBlockHandle],
    content: doc,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

function widgets(editor) {
  return TouchBlockHandlePluginKey.getState(editor.state).decorations.find();
}

// The plugin tracks focus via handleDOMEvents (view.dom's own native "focus"
// / "blur" listeners) — not via editor.commands.focus(), which in jsdom
// doesn't reliably dispatch a real focus event against a contenteditable
// element. Dispatching directly at the exact listener target sidesteps
// jsdom's own focus/focusability rules and still exercises the real
// plugin prop, since handleDOMEvents.focus fires from the dispatch alone.
function focusEditor(editor) {
  editor.view.dom.dispatchEvent(new FocusEvent("focus"));
}
function blurEditor(editor) {
  editor.view.dom.dispatchEvent(new FocusEvent("blur"));
}

describe("TouchBlockHandle", () => {
  it("renders no widget while the editor is unfocused, even with the caret in a chip-less block", () => {
    // A ProseMirror doc always resolves to a valid default selection (doc
    // start) whether or not the user has ever touched the page — an
    // untouched page must not show the handle just because that default
    // selection happens to land inside a paragraph.
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
    });
    try {
      expect(widgets(editor).length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("renders one widget at the paragraph holding the caret once focused", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "first" }] },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
      ],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1); // inside the first paragraph
      expect(widgets(editor).length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("clears the widget again on blur", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1);
      expect(widgets(editor).length).toBe(1);
      blurEditor(editor);
      expect(widgets(editor).length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("moves the widget when the selection moves to a different top-level block", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "first" }] },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
      ],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1);
      const firstPos = widgets(editor)[0].from;
      editor.commands.setTextSelection(9); // inside the second paragraph
      const secondPos = widgets(editor)[0].from;
      expect(secondPos).not.toBe(firstPos);
    } finally {
      cleanup();
    }
  });

  it("renders no widget when the caret sits in a board block (it already has a chip)", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }],
        },
      ],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(3);
      expect(widgets(editor).length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("the widget's own text is empty — the glyph is CSS-only so it can never pollute the block's textContent", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph" }], // empty paragraph — must stay reading as empty
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1);
      const p = editor.view.dom.querySelector("p");
      expect(p.textContent.trim()).toBe("");
      expect(p.querySelector(".touch-block-handle")).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it("tapping the handle dispatches shizumu-block-actions with the paragraph as the block", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1);
      const p = editor.view.dom.querySelector("p");
      const handle = p.querySelector(".touch-block-handle");
      let detail = null;
      editor.view.dom.addEventListener(BLOCK_ACTIONS_EVENT, (e) => { detail = e.detail; });
      handle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(detail?.block).toBe(p);
    } finally {
      cleanup();
    }
  });

  // Gutter restoration: the handle now splits by content, mirroring the
  // desktop hover column's own insert-vs-act split (handleShowPlus &&
  // !handleHasContent). An empty block gets the insert entry; a block
  // with content gets the actions entry. Not "nothing happens" either
  // way — each asserts a different, real dispatch.
  it("on an EMPTY paragraph the handle is marked data-empty and taps dispatch shizumu-block-insert, not the actions sheet", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1);
      const p = editor.view.dom.querySelector("p");
      const handle = p.querySelector(".touch-block-handle");
      expect(handle.dataset.empty).toBe("true");

      let insertDetail = null;
      let actionsDetail = null;
      editor.view.dom.addEventListener(BLOCK_INSERT_EVENT, (e) => { insertDetail = e.detail; });
      editor.view.dom.addEventListener(BLOCK_ACTIONS_EVENT, (e) => { actionsDetail = e.detail; });
      handle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(insertDetail?.block).toBe(p);
      expect(actionsDetail).toBe(null);
    } finally {
      cleanup();
    }
  });

  it("on a paragraph WITH content the handle carries no data-empty attribute and taps dispatch shizumu-block-actions, not insert", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1);
      const p = editor.view.dom.querySelector("p");
      const handle = p.querySelector(".touch-block-handle");
      expect(handle.dataset.empty).toBeUndefined();

      let insertDetail = null;
      let actionsDetail = null;
      editor.view.dom.addEventListener(BLOCK_INSERT_EVENT, (e) => { insertDetail = e.detail; });
      editor.view.dom.addEventListener(BLOCK_ACTIONS_EVENT, (e) => { actionsDetail = e.detail; });
      handle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(actionsDetail?.block).toBe(p);
      expect(insertDetail).toBe(null);
    } finally {
      cleanup();
    }
  });
});
