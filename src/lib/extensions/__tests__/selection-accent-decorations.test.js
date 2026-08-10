// Unit tests for SelectionAccentDecorations. The plugin emits one
// inline decoration per visual line of the current selection range.
// WebKitWebDriver doesn't render selection in our e2e suite, so we
// validate at the decoration layer.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import {
  SelectionAccentDecorations,
  SelectionAccentPluginKey,
} from "../selection-accent-decorations.js";

// Every Editor here builds a ProseMirror EditorView whose DOMObserver
// schedules flush timers. Undestroyed, one of those timers can fire after
// vitest has torn the jsdom environment down and hit `document is not
// defined` — an unhandled error that fails the run even though every test
// passed. It's a race, so it stays invisible until CI is slow enough to
// lose it. Track and destroy.
const openEditors = [];

function makeEditor(doc) {
  const editor = new Editor({
    extensions: [StarterKit, SelectionAccentDecorations],
    content: doc,
  });
  openEditors.push(editor);
  return editor;
}

afterEach(() => {
  while (openEditors.length) openEditors.pop().destroy();
});

describe("SelectionAccentDecorations", () => {
  it("emits zero decorations for an empty selection", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
    });
    // Default selection on construction is empty at position 1.
    const state = SelectionAccentPluginKey.getState(editor.state);
    expect(state.find().length).toBe(0);
  });

  it("emits one decoration for a single-paragraph selection", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
    });
    // Select "hello" (positions 1..6).
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6))
    );
    const state = SelectionAccentPluginKey.getState(editor.state);
    expect(state.find().length).toBe(1);
  });

  it("emits N decorations for a selection spanning N paragraphs", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
        { type: "paragraph", content: [{ type: "text", text: "beta" }] },
        { type: "paragraph", content: [{ type: "text", text: "gamma" }] },
      ],
    });
    // Span from inside paragraph 1 through inside paragraph 3.
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 18))
    );
    const state = SelectionAccentPluginKey.getState(editor.state);
    expect(state.find().length).toBe(3);
  });

  it("emits zero decorations for a NodeSelection on a bare paragraph", async () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
    });
    const { NodeSelection } = await import("@tiptap/pm/state");
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0))
    );
    const state = SelectionAccentPluginKey.getState(editor.state);
    expect(state.find().length).toBe(0);
  });

  it("renders a frame accent for a NodeSelection on a first-class block", async () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }],
        },
      ],
    });
    const { NodeSelection } = await import("@tiptap/pm/state");
    // Select the blockquote node as a unit (it sits at pos 0).
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0))
    );
    const all = SelectionAccentPluginKey.getState(editor.state).find();
    const frameAccents = all.filter((d) => d.type.attrs?.class === "selection-accent-frame");
    expect(frameAccents.length).toBe(1);
  });

  it("emits a frame-level node decoration when the selection crosses a blockquote", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }],
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 22))
    );
    const set = SelectionAccentPluginKey.getState(editor.state);
    const all = set.find();
    const inlineAccents = all.filter((d) => d.type.attrs?.class === "selection-accent");
    const frameAccents = all.filter((d) => d.type.attrs?.class === "selection-accent-frame");
    expect(inlineAccents.length).toBe(3);
    expect(frameAccents.length).toBe(1);
  });

  it("emits both frame and inline decorations for a codeBlock selection", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    });
    // Select positions 2..10 (inside the codeBlock's text content).
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 10))
    );
    const set = SelectionAccentPluginKey.getState(editor.state);
    const all = set.find();
    const inlineAccents = all.filter((d) => d.type.attrs?.class === "selection-accent");
    const frameAccents = all.filter((d) => d.type.attrs?.class === "selection-accent-frame");
    expect(inlineAccents.length).toBe(1);
    expect(frameAccents.length).toBe(1);
  });
});
