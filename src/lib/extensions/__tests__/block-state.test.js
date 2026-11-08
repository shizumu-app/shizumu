// Block state in a real editor, built from the list both shells use
// (buildEditingExtensions): the decision chip, its toggle, undo, a save and
// load, the keyboard, a read-only page, and a question's `open` chip. The
// rules are unit-tested in src/lib/__tests__/block-state.test.js.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { buildEditingExtensions, PIN_EDITOR_EXTENSIONS } from "../../render/shared-extensions.js";
import { isoDate } from "../../block-state.js";

const editors = [];
afterEach(() => {
  while (editors.length) {
    const { editor, host } = editors.pop();
    editor.destroy();
    host.remove();
  }
});

const para = (t) => ({ type: "paragraph", ...(t ? { content: [{ type: "text", text: t }] } : {}) });
const doc = (...nodes) => ({ type: "doc", content: nodes });
const decision = (attrs) => ({
  type: "decisionBlock",
  ...(attrs ? { attrs } : {}),
  content: [
    { type: "list", content: [
      { type: "listItem", content: [para("ship the blocks now")] },
      { type: "listItem", content: [para("wait for the shell")] },
    ] },
    para("ship the blocks"),
    para("the shell lands on its own schedule"),
  ],
});
const qa = (...pairs) => ({ type: "qaBlock", content: pairs.map(([q, a]) => ({ type: "qaPair", content: [para(q), para(a)] })) });

function make(content, { editable = true, extensions } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: extensions ?? buildEditingExtensions({ getPageId: () => "page-1" }),
    content,
    editable,
  });
  editors.push({ editor, host });
  return editor;
}

const decisionNode = (editor) => {
  let found = null;
  editor.state.doc.descendants((n) => { if (!found && n.type.name === "decisionBlock") found = n; return !found; });
  return found;
};
const chip = (editor) => editor.view.dom.querySelector(".block-shell[data-board=decisionBlock] > .block-state-chip");
const openChips = (editor) => [...editor.view.dom.querySelectorAll(".qa-pair > .block-state-open")];

/** Put the caret inside the "chose" paragraph. */
function caretInDecision(editor) {
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock && n.textContent === "ship the blocks") pos = p + 1;
    return pos < 0;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

function pressModEnter(editor) {
  const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, metaKey: false, bubbles: true });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, event));
}

describe("a decision's state chip", () => {
  it("a decision written before 0.8.2 reads as standing", () => {
    const editor = make(doc(decision()));
    expect(decisionNode(editor).attrs.blockState).toBe("standing");
    expect(decisionNode(editor).attrs.blockStateAt).toBe(null);
    const el = chip(editor);
    expect(el.tagName).toBe("BUTTON");
    expect(el.textContent).toBe("standing");
    expect(el.getAttribute("aria-label")).toBe("decision standing. mark superseded");
  });

  it("a click marks it superseded, dated today, and the block reads quieter", () => {
    const editor = make(doc(decision()));
    chip(editor).click();
    const node = decisionNode(editor);
    expect(node.attrs.blockState).toBe("superseded");
    expect(node.attrs.blockStateAt).toBe(isoDate(new Date()));
    expect(chip(editor).textContent).toBe("superseded");
    expect(chip(editor).getAttribute("aria-label")).toBe("decision superseded. mark standing");
    // prose.css keys the quieter ink on this attribute.
    expect(chip(editor).parentElement.dataset.blockState).toBe("superseded");
  });

  it("a second click puts it back to standing", () => {
    const editor = make(doc(decision()));
    chip(editor).click();
    chip(editor).click();
    expect(decisionNode(editor).attrs.blockState).toBe("standing");
    expect(chip(editor).textContent).toBe("standing");
  });

  it("the toggle keeps the block's id, pin and title", () => {
    const editor = make(doc(decision({ blockTitle: "the move", pinId: "pin-1", blockId: "abcdefghijkl" })));
    chip(editor).click();
    const { attrs } = decisionNode(editor);
    expect(attrs.blockTitle).toBe("the move");
    expect(attrs.pinId).toBe("pin-1");
    expect(attrs.blockId).toBe("abcdefghijkl");
  });

  it("undo takes the toggle back", () => {
    const editor = make(doc(decision()));
    chip(editor).click();
    editor.commands.undo();
    expect(decisionNode(editor).attrs.blockState).toBe("standing");
    expect(chip(editor).textContent).toBe("standing");
  });

  it("survives a save and a load", () => {
    const editor = make(doc(decision()));
    chip(editor).click();
    const saved = JSON.stringify(editor.getJSON());
    const stored = JSON.parse(saved).content[0].attrs;
    expect(stored.blockState).toBe("superseded");
    expect(stored.blockStateAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const reopened = make(JSON.parse(saved));
    expect(decisionNode(reopened).attrs.blockState).toBe("superseded");
    expect(chip(reopened).textContent).toBe("superseded");
  });

  it("a pin editor keeps the state, so a pin edit spliced back does not drop it", () => {
    const editor = make(doc(decision({ blockState: "superseded", blockStateAt: "2026-11-01" })), { extensions: PIN_EDITOR_EXTENSIONS });
    const attrs = editor.getJSON().content[0].attrs;
    expect(attrs.blockState).toBe("superseded");
    expect(attrs.blockStateAt).toBe("2026-11-01");
  });
});

describe("the keyboard", () => {
  it("mod+enter inside a decision toggles it", () => {
    const editor = make(doc(decision()));
    caretInDecision(editor);
    expect(pressModEnter(editor)).toBe(true);
    expect(decisionNode(editor).attrs.blockState).toBe("superseded");
  });

  it("mod+enter outside a decision keeps its hard break", () => {
    const editor = make(doc(para("a line"), decision()));
    editor.commands.setTextSelection(3);
    expect(pressModEnter(editor)).toBe(true);
    expect(editor.state.doc.firstChild.content.childCount).toBe(3);
    expect(editor.state.doc.firstChild.child(1).type.name).toBe("hardBreak");
    expect(decisionNode(editor).attrs.blockState).toBe("standing");
  });
});

describe("a read-only page", () => {
  it("shows the chip, and a press changes nothing", () => {
    // Read-only stays read-only: a past page says what the decision was,
    // and neither a tap nor the keyboard edits it.
    const editor = make(doc(decision({ blockState: "superseded", blockStateAt: "2026-10-30" })), { editable: false });
    const el = chip(editor);
    expect(el.textContent).toBe("superseded");
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe("decision superseded");
    const before = editor.state.doc;
    el.click();
    expect(editor.state.doc).toBe(before);
    caretInDecision(editor);
    expect(editor.commands.toggleBlockState()).toBe(false);
    expect(decisionNode(editor).attrs.blockState).toBe("superseded");
  });
});

describe("a question's open chip", () => {
  it("shows on a question with no answer, and only there", () => {
    const editor = make(doc(qa(["do we keep the old ids?", ""], ["who owns the relay?", "we do"])));
    const chips = openChips(editor);
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("open");
    expect(chips[0].closest(".qa-pair").firstElementChild.textContent).toBe("do we keep the old ids?");
  });

  it("goes when the answer is written, and comes back when it is cleared", () => {
    const editor = make(doc(qa(["do we keep the old ids?", ""])));
    expect(openChips(editor)).toHaveLength(1);
    // The answer paragraph's start: doc > qaBlock > qaPair > p(q) > p(a).
    let answerPos = -1;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === "qaPair") { answerPos = p + 1 + n.child(0).nodeSize + 1; return false; }
      return true;
    });
    editor.view.dispatch(editor.state.tr.insertText("yes, derived", answerPos));
    expect(openChips(editor)).toHaveLength(0);
    editor.view.dispatch(editor.state.tr.delete(answerPos, answerPos + "yes, derived".length));
    expect(openChips(editor)).toHaveLength(1);
  });

  it("is never stored", () => {
    const editor = make(doc(qa(["do we keep the old ids?", ""])));
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain("open");
    expect(json).not.toContain("blockState");
  });

  it("is not on a blank pair", () => {
    // A fresh q&a block is a blank pair: nobody asked anything yet, so an
    // `open` chip would mark nothing (block-state.js, isOpenQuestion).
    const editor = make(doc(qa(["", ""])));
    expect(openChips(editor)).toHaveLength(0);
  });

  it("shows on a read-only page too, where it is only read", () => {
    const editor = make(doc(qa(["do we keep the old ids?", ""])), { editable: false });
    expect(openChips(editor)).toHaveLength(1);
  });
});
