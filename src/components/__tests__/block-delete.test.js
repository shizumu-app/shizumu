// Regression coverage for the × block-handle delete path (D-2 in the
// QA sweep findings): clicking × on a table deleted only the header row,
// on a recipeBlock it was a complete no-op, and on a qaBlock it wiped the
// Q/A text but left the wrapper behind. Root cause: TipTapEditor.svelte's
// handleDeleteBlock resolved `posAtDOM(hoveredBlock, 0)` — a position
// INSIDE hoveredBlock's first DOM child (a title caption / title input),
// not the block's own boundary — so `doc.nodeAt(pos)` returned the wrong
// node. Fixed in src/lib/extensions/block-delete.js; this test mounts a
// real editor (same harness pattern as recipe-keyboard.test.js) with each
// structured block type and drives the exact same deleteBlockAt() the
// component's handleDeleteBlock now calls.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { UnifiedListExtensions } from "../../lib/extensions/unified-list.js";
import { RecipeBlock } from "../../lib/extensions/recipe-block.js";
import { DecisionBlock } from "../../lib/extensions/decision-block.js";
import { QABlock } from "../../lib/extensions/qa-block.js";
import { QAPair } from "../../lib/extensions/qa-pair.js";
import { BlockTitle } from "../../lib/extensions/block-title.js";
import { ShellTableView } from "../../lib/extensions/table-shell-view.js";
import { deleteBlockAt } from "../../lib/extensions/block-delete.js";

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false }),
      ...UnifiedListExtensions,
      RecipeBlock,
      DecisionBlock,
      QABlock,
      QAPair,
      BlockTitle,
      Table.configure({ resizable: false, View: ShellTableView }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

// hoveredBlock in the real component is always a direct child of the
// `.ProseMirror` root — mirror that here.
function topLevelChild(editor, index = 0) {
  const pm = editor.view.dom;
  const children = Array.from(pm.children);
  return children[index];
}

function para(text) {
  return { type: "paragraph", content: text ? [{ type: "text", text }] : undefined };
}

function tableDoc() {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          { type: "tableRow", content: [
            { type: "tableHeader", content: [para("h1")] },
            { type: "tableHeader", content: [para("h2")] },
          ]},
          { type: "tableRow", content: [
            { type: "tableCell", content: [para("a1")] },
            { type: "tableCell", content: [para("a2")] },
          ]},
        ],
      },
      para("after"),
    ],
  };
}

function recipeDoc() {
  return {
    type: "doc",
    content: [
      {
        type: "recipeBlock",
        content: [
          para("given"),
          { type: "list", content: [{ type: "listItem", attrs: { marker: "ordered" }, content: [para("do")] }] },
          para("result"),
        ],
      },
      para("after"),
    ],
  };
}

function decisionDoc() {
  return {
    type: "doc",
    content: [
      {
        type: "decisionBlock",
        content: [
          { type: "list", content: [{ type: "listItem", attrs: { marker: "bullet" }, content: [para("option A")] }] },
          para("chose A"),
          para("because it's simpler"),
        ],
      },
      para("after"),
    ],
  };
}

function qaDoc() {
  return {
    type: "doc",
    content: [
      {
        type: "qaBlock",
        content: [
          { type: "qaPair", content: [para("Q1"), para("A1")] },
        ],
      },
      para("after"),
    ],
  };
}

describe("deleteBlockAt (× block-handle)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("removes the WHOLE table, not just the header row", () => {
    env = makeEditor(tableDoc());
    const { editor } = env;
    // hoveredBlock is the NodeView's outer wrapper (.tableWrapper), not the
    // <table> itself — same shape as the real bug: the wrapper's first DOM
    // child is the non-content titleCaption inserted before the <table>.
    const tableEl = topLevelChild(editor, 0);
    expect(tableEl.tagName.toLowerCase()).toBe("div");
    expect(tableEl.querySelector("table")).toBeTruthy();

    const ok = deleteBlockAt(editor, tableEl);
    expect(ok).toBe(true);

    const types = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).not.toContain("table");
    expect(types).not.toContain("tableRow");
    expect(editor.state.doc.textContent).toBe("after");
  });

  it("removes the WHOLE recipeBlock (previously a complete no-op)", () => {
    env = makeEditor(recipeDoc());
    const { editor } = env;
    const recipeEl = topLevelChild(editor, 0);
    expect(recipeEl.getAttribute("data-type")).toBe("recipeBlock");

    const before = editor.state.doc.textContent;
    expect(before).toContain("given");

    const ok = deleteBlockAt(editor, recipeEl);
    expect(ok).toBe(true);

    const types = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).not.toContain("recipeBlock");
    expect(editor.state.doc.textContent).toBe("after");
  });

  it("removes the WHOLE decisionBlock", () => {
    env = makeEditor(decisionDoc());
    const { editor } = env;
    const decisionEl = topLevelChild(editor, 0);
    expect(decisionEl.getAttribute("data-type")).toBe("decisionBlock");

    const before = editor.state.doc.textContent;
    expect(before).toContain("option A");

    const ok = deleteBlockAt(editor, decisionEl);
    expect(ok).toBe(true);

    const types = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).not.toContain("decisionBlock");
    expect(editor.state.doc.textContent).toBe("after");
  });

  it("removes the WHOLE qaBlock, not just its Q/A text (previously wiped text and left the wrapper)", () => {
    env = makeEditor(qaDoc());
    const { editor } = env;
    const qaEl = topLevelChild(editor, 0);
    expect(qaEl.getAttribute("data-type")).toBe("qaBlock");

    const ok = deleteBlockAt(editor, qaEl);
    expect(ok).toBe(true);

    const types = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).not.toContain("qaBlock");
    expect(types).not.toContain("qaPair");
    expect(editor.state.doc.textContent).toBe("after");
  });

  it("replaces the block with an empty paragraph when it's the only block in the doc", () => {
    env = makeEditor({ type: "doc", content: [
      { type: "qaBlock", content: [{ type: "qaPair", content: [para("Q1"), para("A1")] }] },
    ] });
    const { editor } = env;
    const qaEl = topLevelChild(editor, 0);

    const ok = deleteBlockAt(editor, qaEl);
    expect(ok).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild.type.name).toBe("paragraph");
    expect(editor.state.doc.textContent).toBe("");
  });
});
