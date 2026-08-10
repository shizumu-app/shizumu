// Asserts each shortcut in the canonical set produces the expected
// node when typed. Uses a real TipTap Editor with the production
// extension list so we catch rule shadowing by custom blocks.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditingExtensions } from "../../render/shared-extensions.js";

let editor;
beforeEach(() => {
  editor = new Editor({
    extensions: buildEditingExtensions({}),
    content: "<p></p>",
  });
});
afterEach(() => editor.destroy());

// Helper: simulate typing the marker by routing each char through the
// inputrules plugin's handleTextInput hook (the same path the DOM
// beforeinput event takes). If no rule consumes the char, fall back to
// a plain tr.insertText so the text still lands in the doc.
function type(text) {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const consumed = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, ch));
    if (!consumed) {
      editor.view.dispatch(editor.state.tr.insertText(ch));
    }
  }
}

function topLevelTypes() {
  return editor.state.doc.content.content.map((n) => n.type.name);
}

describe("markdown input rules — canonical set", () => {
  it("# space → heading 1", () => {
    type("# Title");
    expect(topLevelTypes()[0]).toBe("heading");
    expect(editor.state.doc.firstChild.attrs.level).toBe(1);
  });

  it("## space → heading 2", () => {
    type("## ");
    expect(editor.state.doc.firstChild.attrs.level).toBe(2);
  });

  it("### space → heading 3", () => {
    type("### ");
    expect(editor.state.doc.firstChild.attrs.level).toBe(3);
  });

  it("- space → bullet list", () => {
    type("- item");
    // shizumu's unified-list collapses bullet/ordered/task into a single
    // `list` node whose first `listItem` carries the marker attr.
    expect(topLevelTypes()[0]).toBe("list");
    expect(editor.state.doc.firstChild.firstChild.attrs.marker).toBe("bullet");
  });

  it("1. space → ordered list", () => {
    type("1. item");
    expect(topLevelTypes()[0]).toBe("list");
    expect(editor.state.doc.firstChild.firstChild.attrs.marker).toBe("ordered");
  });

  it("> space → blockquote", () => {
    type("> quote");
    expect(topLevelTypes()[0]).toBe("blockquote");
  });

  it("``` space → code block", () => {
    // The CodeBlock textblock-input rule fires on a triple backtick
    // followed by a terminator (space or newline, with optional language
    // tag in between). Bare triple-backtick alone isn't enough; the rule
    // needs the trailing char to know the fence is complete.
    type("``` ");
    expect(topLevelTypes()[0]).toBe("codeBlock");
  });

  it("**text** → bold mark", () => {
    type("**bold**");
    const text = editor.state.doc.textContent;
    expect(text).toBe("bold");
    const marks = editor.state.doc.firstChild.firstChild?.marks ?? [];
    expect(marks.some((m) => m.type.name === "bold")).toBe(true);
  });

  it("*text* → italic mark", () => {
    type("*it*");
    const marks = editor.state.doc.firstChild.firstChild?.marks ?? [];
    expect(marks.some((m) => m.type.name === "italic")).toBe(true);
  });

  it("~~text~~ → strike mark", () => {
    type("~~gone~~");
    const marks = editor.state.doc.firstChild.firstChild?.marks ?? [];
    expect(marks.some((m) => m.type.name === "strike")).toBe(true);
  });

  it("`text` → code mark", () => {
    type("`api`");
    const marks = editor.state.doc.firstChild.firstChild?.marks ?? [];
    expect(marks.some((m) => m.type.name === "code")).toBe(true);
  });

  it("--- on its own line → horizontal rule", () => {
    type("---");
    expect(topLevelTypes()[0]).toBe("horizontalRule");
  });
});
