// `@` in code is a character, not a mention — see suggestion-allowed.js for
// the BibTeX entry that became a trail. Driven through a real Editor and the
// real MentionCommand plugin state, because the defect was the wiring: the
// rule has to reach the Suggestion plugin, not merely exist.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MentionCommand, MentionCommandPluginKey } from "../../extensions/mention-command.js";
import { suggestionAllowedAt } from "../suggestion-allowed.js";

let editor = null;
let host = null;
function make(content) {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit, MentionCommand.configure({ floatingMenu: false })],
    content: { type: "doc", content },
  });
  return editor;
}
afterEach(() => {
  editor?.destroy();
  host?.remove();
  editor = null;
  host = null;
});

const active = () => MentionCommandPluginKey.getState(editor.state).active;

describe("the @ menu and code", () => {
  it("opens in a paragraph (the control: the same keystrokes do start a session)", () => {
    make([{ type: "paragraph" }]);
    editor.commands.insertContent("@book");
    expect(active()).toBe(true);
  });

  it("stays shut in a code block, so Return ends the line instead of creating a trail", () => {
    make([{ type: "codeBlock" }]);
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("@book{kubler1962shape,");
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    expect(active()).toBe(false);
  });

  it("stays shut inside inline code", () => {
    make([{ type: "paragraph" }]);
    editor.commands.insertContent({ type: "text", text: "@decorator", marks: [{ type: "code" }] });
    expect(active()).toBe(false);
  });

  it("the rule itself: refuses a code parent and a code mark, allows plain text", () => {
    make([
      { type: "paragraph", content: [{ type: "text", text: "@a " }, { type: "text", text: "@b", marks: [{ type: "code" }] }] },
      { type: "codeBlock", content: [{ type: "text", text: "@c" }] },
    ]);
    const { state } = editor;
    expect(suggestionAllowedAt(state, { from: 1, to: 3 })).toBe(true);
    expect(suggestionAllowedAt(state, { from: 4, to: 6 })).toBe(false);
    const codeStart = state.doc.child(0).nodeSize + 1;
    expect(suggestionAllowedAt(state, { from: codeStart, to: codeStart + 2 })).toBe(false);
  });
});
