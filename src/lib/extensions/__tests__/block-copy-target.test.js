// Regression tests for resolveCopyTarget. The bug these exist for: the ⎘
// hover handle copied the block ABOVE the one pointed at, for every block
// except the first.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { resolveBlockPos } from "../block-delete.js";
import { resolveCopyTarget } from "../block-copy-target.js";

const openEditors = [];

function makeEditor(doc) {
  const editor = new Editor({ extensions: [StarterKit], content: doc });
  openEditors.push(editor);
  return editor;
}

afterEach(() => {
  while (openEditors.length) openEditors.pop().destroy();
});

const threeParagraphs = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
    { type: "paragraph", content: [{ type: "text", text: "beta" }] },
    { type: "paragraph", content: [{ type: "text", text: "gamma" }] },
  ],
};

describe("resolveCopyTarget", () => {
  it("captures the block STARTING at a depth-0 boundary, not the one before it", () => {
    const editor = makeEditor(threeParagraphs);
    // Position immediately before the 2nd paragraph — exactly what
    // resolveBlockPos hands the hover-handle path.
    const secondStart = editor.state.doc.resolve(1).after(1);
    const target = resolveCopyTarget(editor.state.doc, secondStart);
    expect(target).not.toBeNull();
    expect(target.node.textContent).toBe("beta");
  });

  it("captures the third block, not the second", () => {
    const editor = makeEditor(threeParagraphs);
    let thirdStart = 0;
    editor.state.doc.forEach((node, offset, index) => {
      if (index === 2) thirdStart = offset;
    });
    const target = resolveCopyTarget(editor.state.doc, thirdStart);
    expect(target.node.textContent).toBe("gamma");
  });

  it("still captures the first block (nodeBefore is null there)", () => {
    const editor = makeEditor(threeParagraphs);
    const target = resolveCopyTarget(editor.state.doc, 0);
    expect(target.node.textContent).toBe("alpha");
  });

  it("captures the enclosing block for a position INSIDE it", () => {
    const editor = makeEditor(threeParagraphs);
    // A cursor inside "beta" — the Ctrl+Shift+C path.
    const inside = editor.state.doc.resolve(1).after(1) + 2;
    const target = resolveCopyTarget(editor.state.doc, inside);
    expect(target.node.textContent).toBe("beta");
  });

  it("falls back to nodeBefore at the very end of the doc", () => {
    const editor = makeEditor(threeParagraphs);
    const end = editor.state.doc.content.size;
    const target = resolveCopyTarget(editor.state.doc, end);
    expect(target.node.textContent).toBe("gamma");
  });

  it("agrees with what resolveBlockPos hands the hover handle", () => {
    const editor = makeEditor(threeParagraphs);
    // Emulate resolveBlockPos's contract (before(1) of the target block)
    // for each top-level block, and assert round-trip identity.
    const expected = ["alpha", "beta", "gamma"];
    editor.state.doc.forEach((node, offset) => {
      const target = resolveCopyTarget(editor.state.doc, offset);
      expect(expected).toContain(target.node.textContent);
      expect(target.node.textContent).toBe(node.textContent);
      expect(target.blockStart).toBe(offset);
      expect(target.blockEnd).toBe(offset + node.nodeSize);
    });
  });

  it("prefers the enclosing listItem when asked", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
          ],
        },
      ],
    });
    // Cursor inside "two".
    let pos = 0;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === "two") pos = p + 1;
    });
    const listItem = resolveCopyTarget(editor.state.doc, pos, { preferListItem: true });
    expect(listItem.grain).toBe("listItem");
    expect(listItem.node.textContent).toBe("two");

    const wholeList = resolveCopyTarget(editor.state.doc, pos);
    expect(wholeList.grain).toBe("block");
    expect(wholeList.node.type.name).toBe("bulletList");
  });

  it("returns null for an out-of-range position", () => {
    const editor = makeEditor(threeParagraphs);
    expect(resolveCopyTarget(editor.state.doc, 99999)).toBeNull();
  });

  it("resolveBlockPos + resolveCopyTarget round-trips through the real DOM", () => {
    const editor = makeEditor(threeParagraphs);
    const els = editor.view.dom.children;
    expect(els.length).toBe(3);
    const seen = [];
    for (const el of els) {
      const pos = resolveBlockPos(editor.view, el);
      seen.push(resolveCopyTarget(editor.state.doc, pos).node.textContent);
    }
    // The bug produced ["alpha", "alpha", "beta"] here.
    expect(seen).toEqual(["alpha", "beta", "gamma"]);
  });
});
