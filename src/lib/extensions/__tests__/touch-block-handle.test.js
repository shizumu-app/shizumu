import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TouchBlockHandle, TouchBlockHandlePluginKey } from "../touch-block-handle.js";
import { BLOCK_INSERT_EVENT } from "../dispatch-block-actions.js";

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

  it("renders one widget at an EMPTY paragraph holding the caret once focused", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
      ],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1); // inside the empty first paragraph
      expect(widgets(editor).length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("renders no widget when the caret moves into a paragraph that already has content — that block's controls come from TipTapEditor.svelte's tap-reveal, not this decoration", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
      ],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1);
      expect(widgets(editor).length).toBe(1);
      editor.commands.setTextSelection(4); // inside the second, non-empty paragraph
      expect(widgets(editor).length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("clears the widget again on blur", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph" }],
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

  it("moves the widget when the selection moves to a different empty top-level block", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph" },
      ],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1);
      const firstPos = widgets(editor)[0].from;
      editor.commands.setTextSelection(3); // inside the second empty paragraph
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

  it("tapping the handle dispatches shizumu-block-insert with the empty paragraph as the block", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    try {
      focusEditor(editor);
      editor.commands.setTextSelection(1);
      const p = editor.view.dom.querySelector("p");
      const handle = p.querySelector(".touch-block-handle");
      let detail = null;
      editor.view.dom.addEventListener(BLOCK_INSERT_EVENT, (e) => { detail = e.detail; });
      handle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(detail?.block).toBe(p);
    } finally {
      cleanup();
    }
  });
});
