// D-8 (QA sweep): qaBlock's documented Backspace-unwrap didn't fire.
// Per qa-block.js's own comment/code, Backspace on an empty Q in a
// single-pair qaBlock should unwrap the block to a plain paragraph — same
// documented behavior for Backspace on an empty A (with an also-empty Q)
// in qa-pair.js. Both used `editor.commands.lift("qaBlock")`, which
// silently no-ops (no valid lift target for a bare qaPair). Fixed by
// building the unwrap transaction directly in qa-block.js's
// unwrapSoleQABlock, reused from qa-pair.js.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [StarterKit, QABlock, QAPair],
    content,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

function para(text) {
  return { type: "paragraph", content: text ? [{ type: "text", text }] : undefined };
}

function singlePairDoc(qText = "", aText = "") {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      { type: "qaBlock", content: [{ type: "qaPair", content: [para(qText), para(aText)] }] },
    ],
  };
}

function pressKey(editor, key) {
  const ev = new KeyboardEvent("keydown", { key });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev)) || false;
}

describe("qaBlock sole-pair unwrap (D-8)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("Backspace on empty Q with a FILLED answer does NOT unwrap — the answer survives", () => {
    // Coordinator branch-review fix: the unwrap guard used to check only
    // the Q side. An empty Q + a non-empty A used to delete the WHOLE
    // block (including the answer) on a single Backspace — a data-loss
    // regression this branch introduced (pre-branch this keystroke was a
    // no-op). The guard must also require the answer to be empty before
    // unwrapping, mirroring qa-pair.js's own (correct) both-sides check.
    env = makeEditor(singlePairDoc("", "some answer"));
    const { editor } = env;
    const qaBlockPos = editor.state.doc.child(0).nodeSize;
    const qPos = qaBlockPos + 2;
    editor.chain().setTextSelection(qPos).run();

    pressKey(editor, "Backspace");

    // The qaBlock must still exist, and the answer text must be intact —
    // whatever ProseMirror's default Backspace fallback does at this
    // schema-constrained position (it may harmlessly append a trailing
    // paragraph elsewhere), it must not touch the qaBlock's content.
    const qaBlockNode = editor.state.doc.content.content.find((n) => n.type.name === "qaBlock");
    expect(qaBlockNode).toBeTruthy();
    expect(qaBlockNode.child(0).child(0).textContent).toBe("");
    expect(qaBlockNode.child(0).child(1).textContent).toBe("some answer");
    expect(editor.state.doc.child(0).textContent).toBe("before");
  });

  it("Backspace on empty Q with an empty answer unwraps (both sides empty)", () => {
    env = makeEditor(singlePairDoc("", ""));
    const { editor } = env;
    // Cursor at start of the empty Q paragraph (first textblock of the qaPair).
    const qaBlockPos = editor.state.doc.child(0).nodeSize; // right before qaBlock
    const qPos = qaBlockPos + 2; // qaBlock open + qaPair open -> inside Q paragraph
    editor.chain().setTextSelection(qPos).run();

    const handled = pressKey(editor, "Backspace");
    expect(handled).toBe(true);

    const types = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).not.toContain("qaBlock");
    expect(types).not.toContain("qaPair");
    // "before" paragraph is untouched; the qaBlock became a (now placeholder) paragraph.
    expect(editor.state.doc.child(0).textContent).toBe("before");
  });

  it("Backspace on an empty A (Q also empty) in a single-pair qaBlock unwraps it to a paragraph", () => {
    env = makeEditor(singlePairDoc("", ""));
    const { editor } = env;
    const qaBlockPos = editor.state.doc.child(0).nodeSize;
    // qaBlock open(1) + qaPair open(1) + empty Q paragraph (nodeSize 2) -> A paragraph start
    const aPos = qaBlockPos + 2 + 2 + 1;
    editor.chain().setTextSelection(aPos).run();
    // Confirm we're actually in the A paragraph before pressing Backspace.
    const $checkFrom = editor.state.selection.$from;
    expect($checkFrom.index($checkFrom.depth - 1)).toBe(1); // second child of qaPair

    const handled = pressKey(editor, "Backspace");
    expect(handled).toBe(true);

    const types = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).not.toContain("qaBlock");
    expect(types).not.toContain("qaPair");
  });
});
