// The laptop shows a block's type chip (its actions) only while the pointer
// is over it, or while the block holds the caret (prose.css, "chrome on
// demand"). The second half never worked: `.block-shell:focus-within`
// cannot match inside one contenteditable, where the focused element is the
// editor around every block. Found with the A16 run of 2026-11-07 (J4.3):
// a keyboard writer never saw a block's chip. caretBlockRange names the
// top-level block that holds the caret, for a class the CSS can follow.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { caretBlockRange } from "../caret-block.js";

const open = [];
const make = (doc) => { const e = new Editor({ extensions: [StarterKit], content: doc }); open.push(e); return e; };
afterEach(() => { while (open.length) open.pop().destroy(); });

const doc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
    { type: "bulletList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "shoes" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "the old ones" }] }] }] }] },
    ] },
    { type: "paragraph", content: [{ type: "text", text: "omega" }] },
  ],
};

describe("caretBlockRange", () => {
  it("is the top-level block holding the caret, even three levels into a list", () => {
    const ed = make(doc);
    let at = null;
    ed.state.doc.descendants((n, pos) => { if (at === null && n.isText && n.text === "the old ones") at = pos + 2; });
    ed.commands.setTextSelection(at);
    const r = caretBlockRange(ed.state.doc, ed.state.selection);
    expect(ed.state.doc.nodeAt(r.from).type.name).toBe("bulletList");
    expect(r.to).toBe(r.from + ed.state.doc.nodeAt(r.from).nodeSize);
  });

  it("is the paragraph itself for a caret in a top-level paragraph", () => {
    const ed = make(doc);
    ed.commands.setTextSelection(2);
    const r = caretBlockRange(ed.state.doc, ed.state.selection);
    expect(r.from).toBe(0);
    expect(ed.state.doc.nodeAt(r.from).textContent).toBe("alpha");
  });

  it("is nothing for a selection across blocks", () => {
    // A range over two blocks belongs to neither: no chip should claim it.
    const ed = make(doc);
    ed.commands.setTextSelection({ from: 2, to: ed.state.doc.content.size - 2 });
    expect(caretBlockRange(ed.state.doc, ed.state.selection)).toBeNull();
  });
});
