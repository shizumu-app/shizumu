// Unit tests for BlockCopyKeymap. The extension binds Cmd/Ctrl+Shift+C
// to a command that emits a custom event the editor component
// listens to, since clipboard writes can't be tested without a DOM
// clipboard mock. We assert the command dispatches the event with the
// correct doc position.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { BlockCopyKeymap } from "../block-copy-keymap.js";

// Destroy every editor after each test: an undestroyed ProseMirror
// DOMObserver can flush after jsdom teardown and throw "document is not
// defined" as an unhandled error, failing the run with all tests green.
const openEditors = [];

function makeEditor(doc) {
  const editor = new Editor({
    extensions: [StarterKit, BlockCopyKeymap],
    content: doc,
  });
  openEditors.push(editor);
  return editor;
}

afterEach(() => {
  while (openEditors.length) openEditors.pop().destroy();
});

describe("BlockCopyKeymap", () => {
  it("dispatches shizumu:block-copy-key with the cursor position", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
        { type: "paragraph", content: [{ type: "text", text: "beta" }] },
      ],
    });
    // Place cursor inside paragraph 2 (between "alpha" and "beta"; pos 9 is inside paragraph 2).
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 9, 9))
    );

    const events = [];
    editor.view.dom.addEventListener("shizumu:block-copy-key", (e) => events.push(e.detail));

    const ok = editor.commands.copyCurrentBlock();
    expect(ok).toBe(true);
    expect(events.length).toBe(1);
    expect(typeof events[0].pos).toBe("number");
    // Position should land inside paragraph 2.
    const $p = editor.state.doc.resolve(events[0].pos);
    expect($p.parent.textContent).toBe("beta");
  });

  it("returns a boolean even at the document boundary", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    // Run the command and verify it returns a boolean (defensive: the
    // empty-doc / boundary case shouldn't throw).
    const ok = editor.commands.copyCurrentBlock();
    expect(typeof ok).toBe("boolean");
  });

  it("dispatches block-copy-key at a position whose depth chain includes listItem", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "alpha" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "beta" }] }],
            },
          ],
        },
      ],
    });
    // Place cursor inside the second list item (between "b" and "e" in "beta").
    // Doc structure: bulletList(1) > listItem(2) > paragraph(3) > text. Pos 11 lands inside "beta".
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 11, 11))
    );
    const events = [];
    editor.view.dom.addEventListener("shizumu:block-copy-key", (e) => events.push(e.detail));
    editor.commands.copyCurrentBlock();
    expect(events.length).toBe(1);
    const $p = editor.state.doc.resolve(events[0].pos);
    let foundListItem = false;
    for (let d = $p.depth; d > 0; d--) {
      if ($p.node(d).type.name === "listItem") { foundListItem = true; break; }
    }
    expect(foundListItem).toBe(true);
  });
});
