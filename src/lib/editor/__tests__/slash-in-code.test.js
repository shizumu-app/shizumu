// `/` in code is a character too: a path (`/usr/bin`), a comment (`//`), a
// division. The `/` menu opened there like the `@` menu did, and Return
// committed its first block instead of ending the line (the same rule as
// suggestion-allowed.js, found beside it 2026-10-24).
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SlashCommands, SlashCommandsPluginKey } from "../../slash-commands.js";

let editor = null;
let host = null;
function make(content) {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit, SlashCommands.configure({ floatingMenu: false })],
    content: { type: "doc", content },
  });
  return editor;
}
afterEach(() => { editor?.destroy(); host?.remove(); editor = null; host = null; });

const active = () => SlashCommandsPluginKey.getState(editor.state)?.active;

describe("the / menu and code", () => {
  it("opens in a paragraph (the control)", () => {
    make([{ type: "paragraph" }]);
    editor.commands.insertContent("/head");
    expect(active()).toBe(true);
  });

  it("stays shut in a code block", () => {
    make([{ type: "codeBlock" }]);
    editor.commands.insertContent("/usr");
    expect(active()).toBe(false);
  });
});
