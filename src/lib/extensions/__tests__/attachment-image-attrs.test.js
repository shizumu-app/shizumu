import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Attachment } from "../attachment.js";

function makeEditor() {
  return new Editor({
    extensions: [Document, Paragraph, Text, Attachment],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
}

describe("Attachment node — image attrs", () => {
  it("accepts width, display, and collapsed with the right defaults", () => {
    const editor = makeEditor();
    editor.commands.insertContent({
      type: "attachment",
      attrs: { kind: "image", blob_hash: "h1", filename: "photo.png" },
    });
    let attrs;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "attachment") attrs = n.attrs;
    });
    expect(attrs.display).toBe("block");
    expect(attrs.collapsed).toBe(false);
    expect(attrs.width).toBe(null);
    editor.destroy();
  });

  it("round-trips an explicit width/display/collapsed set", () => {
    const editor = makeEditor();
    editor.commands.insertContent({
      type: "attachment",
      attrs: {
        kind: "image", blob_hash: "h2", filename: "p.png",
        width: "320px", display: "inline", collapsed: true,
      },
    });
    let attrs;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "attachment") attrs = n.attrs;
    });
    expect(attrs.width).toBe("320px");
    expect(attrs.display).toBe("inline");
    expect(attrs.collapsed).toBe(true);
    editor.destroy();
  });
});
