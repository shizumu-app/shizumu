// The blank line a cancelled picker left behind.
//
// `/image` and `/file` open a fresh line BEFORE awaiting the picker,
// because the insertion point has to be captured before a dialog can move
// the selection. Cancel the dialog — or pick a PDF for `/image`, which is
// refused on purpose — and that paragraph stayed: the writer asked for a
// picture, got no picture, and got a blank line instead.
//
// Tested at `discardOpenedLine` rather than through the commands, because
// the commands need a file dialog and this is the whole of the decision.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { prepareInsertionPoint, discardOpenedLine } from "../slash-commands.js";

let editor = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(content) {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ codeBlock: false })],
    content,
  });
  return editor;
}

const texts = (ed) => ed.state.doc.content.content.map((n) => n.textContent);

/** Put the caret at the end of the top-level child at `index`. */
function caretAtEndOf(ed, index) {
  let at = 0;
  ed.state.doc.forEach((node, offset, i) => {
    if (i === index) at = offset + node.nodeSize - 1;
  });
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(at))));
}

describe("discardOpenedLine", () => {
  it("gives back the line prepareInsertionPoint opened", () => {
    // THE regression. `image` is in BLOCK_COMMANDS, so asking for one at
    // the end of a written line opens a fresh paragraph below it — correct
    // while the command is going to insert something, and litter when it
    // is not.
    const ed = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "kept going" }] }],
    });
    caretAtEndOf(ed, 0);

    const range = prepareInsertionPoint(ed, { from: ed.state.selection.from, to: ed.state.selection.from }, "image");
    expect(range.openedLine).toBe(true);
    expect(texts(ed)).toEqual(["kept going", ""]);

    expect(discardOpenedLine(ed, range)).toBe(true);
    expect(texts(ed)).toEqual(["kept going"]);
  });

  it("leaves a line the writer already had", () => {
    // The other half, and what makes the first assertion mean something.
    // On an ALREADY empty line prepareInsertionPoint opens nothing — there
    // is nothing to swallow — so `openedLine` is false and a cancel must
    // not delete the line the writer was standing on.
    const ed = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    caretAtEndOf(ed, 0);

    const range = prepareInsertionPoint(ed, { from: ed.state.selection.from, to: ed.state.selection.from }, "image");
    expect(range.openedLine).toBe(false);

    expect(discardOpenedLine(ed, range)).toBe(false);
    expect(ed.state.doc.childCount).toBe(1);
  });

  it("leaves the opened line alone once anything is on it", () => {
    // A dialog is a whole system UI and the app can be backgrounded; the
    // writer may have typed into the fresh line before cancelling.
    // Deleting a line with something on it is a worse bug than the one
    // being fixed.
    const ed = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "kept going" }] }],
    });
    caretAtEndOf(ed, 0);
    const range = prepareInsertionPoint(ed, { from: ed.state.selection.from, to: ed.state.selection.from }, "image");
    ed.commands.insertContent("second thoughts");

    expect(discardOpenedLine(ed, range)).toBe(false);
    expect(texts(ed)).toEqual(["kept going", "second thoughts"]);
  });

  it("does nothing for a command that opens no line", () => {
    // `heading 1` is in IN_PLACE_COMMANDS — typing `/heading` mid-sentence
    // means "make this line a heading", so no line is opened and none may
    // be taken away.
    const ed = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a title" }] }],
    });
    caretAtEndOf(ed, 0);

    const range = prepareInsertionPoint(ed, { from: ed.state.selection.from, to: ed.state.selection.from }, "heading 1");
    expect(range.openedLine).toBe(false);
    expect(discardOpenedLine(ed, range)).toBe(false);
    expect(texts(ed)).toEqual(["a title"]);
  });
});
