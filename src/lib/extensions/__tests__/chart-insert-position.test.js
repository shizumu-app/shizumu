// Where a chart lands, and the blank line it used to leave above itself.
//
// `/chart` runs through prepareInsertionPoint like every other
// BLOCK_COMMANDS entry, which opens a FRESH empty line before the builder
// opens — correct, because a block command typed on a written line must
// not swallow that line. But the chart arrives later, from the builder's
// save, and `insertChart` inserted at `selection.from` — INSIDE that empty
// paragraph, which then survived above it.
//
// Every other board avoids this with
// insertBoardReplacingEmptyLeadingParagraph (slash-commands.js:117). Chart
// alone did not, because it is the one board whose insert is a separate
// command run after an async round trip through a modal.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { Chart } from "../chart.js";

let editor = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(content) {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ codeBlock: false }), Chart],
    content,
  });
  return editor;
}

const types = (ed) => ed.state.doc.content.content.map((n) => n.type.name);

/** Put the caret in the top-level child at `index`. */
function caretIn(ed, index) {
  let at = 0;
  ed.state.doc.forEach((node, offset, i) => {
    if (i === index) at = offset + 1;
  });
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(at))));
}

const ATTRS = { kind: "flowchart", source: "{}", title: "" };

describe("insertChart — the empty leading paragraph", () => {
  it("replaces the empty paragraph the caret is in", () => {
    // THE regression: this produced paragraph, EMPTY paragraph, chart,
    // paragraph — a stray blank line above every chart made from a
    // written line.
    const ed = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "kept going" }] },
        { type: "paragraph" },
      ],
    });
    caretIn(ed, 1);

    ed.commands.insertChart({ attrs: ATTRS });

    expect(types(ed)).toEqual(["paragraph", "chart", "paragraph"]);
    expect(ed.state.doc.child(0).textContent).toBe("kept going");
  });

  it("does not eat a paragraph that has writing in it", () => {
    // The other half, and what makes the first assertion mean something:
    // a replace that ignored content would delete the writer's line. The
    // guard is the same three-part test the board helper uses — top level,
    // a paragraph, and EMPTY.
    const ed = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "still here" }] }],
    });
    caretIn(ed, 0);

    ed.commands.insertChart({ attrs: ATTRS });

    expect(ed.state.doc.textContent).toContain("still here");
    expect(types(ed)).toContain("chart");
  });

  it("leaves the caret in a paragraph after the chart either way", () => {
    // insertChart's own contract, asserted because the replace path
    // changes the position arithmetic it is computed from.
    const ed = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    caretIn(ed, 0);

    ed.commands.insertChart({ attrs: ATTRS });

    const $from = ed.state.selection.$from;
    expect($from.parent.type.name).toBe("paragraph");
    expect($from.before(1)).toBeGreaterThan(0);
  });
});
