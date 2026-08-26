// board-detection.test.js — regression coverage for Plan 1c (chart and
// table join the block-shell DOM contract).
//
// Live bug: tapping the type chip on an EMPTY chart or table opens no
// action sheet. Root cause: the four "is this a board" callers
// (describeHoverBlock, openBlockActionSheet, revealBlockHandlesForNode in
// TipTapEditor.svelte, and hoverClassTarget in block-hover-guard.js) all
// check `classList.contains("block-shell") || classList.contains("code-block-wrap")`,
// but chart's wrapper is `.chart-block` and table's is TipTap's
// `.tableWrapper` — neither carries `.block-shell`, and neither renders a
// real `.board-title-slot`. Chart's chip additionally has no click handler
// at all (it's a bare `<span>` from the BlockTypeChip widget plugin).
//
// Fix lives in chart.js (adopts createBlockShell) and table-shell-view.js
// (wires block-shell's pieces in by hand, since columnResizing's DOM
// conflicts rule out createBlockShell there). This file asserts the DOM
// facts those two callers depend on, and feeds them through the real
// blockActionsFor exactly as openBlockActionSheet does — see
// docs/superpowers/specs/2026-06-14-block-cohesion-design.md and
// .superpowers/sdd/why-we-have-two-twinkly-pebble/task-1-brief.md.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Chart } from "../../extensions/chart.js";
import { BlockTitle } from "../../extensions/block-title.js";
import { BlockTypeChip } from "../../extensions/block-type-chip.js";
import { ShellTableView } from "../../extensions/table-shell-view.js";
import { blockActionsFor } from "../block-actions.js";
import { BLOCK_ACTIONS_EVENT } from "../../extensions/dispatch-block-actions.js";

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false, codeBlock: false }),
      // resizable: true — the harder of the two table code paths
      // (table-shell-view.js's own comment: "the resizable path
      // constructs the View without one [getPos]"), and what the real
      // writable editor actually configures (shared-extensions.js).
      Table.configure({ resizable: true, View: ShellTableView }),
      TableRow,
      TableHeader,
      TableCell,
      Chart,
      BlockTitle,
      BlockTypeChip,
    ],
    content,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

function chartDoc() {
  return {
    type: "doc",
    content: [{ type: "chart", attrs: { kind: "flowchart" } }],
  };
}

const para = (text) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : undefined,
});
const cell = (...content) => ({ type: "tableCell", content });

// A 2x2 table whose LAST cell holds a filled paragraph followed by an empty
// one — the shape that made Enter destructive once `table` joined
// TITLE_NAV_TYPES (block-title.js).
function tableWithFilledLastCellDoc() {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          { type: "tableRow", content: [cell(para("a")), cell(para("b"))] },
          { type: "tableRow", content: [cell(para("c")), cell(para("KEEP ME"), para())] },
        ],
      },
    ],
  };
}

// Same table, but the last cell holds a single empty paragraph — the milder
// second symptom (Enter exited the table instead of splitting inside the cell).
function tableWithEmptyLastCellDoc() {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          { type: "tableRow", content: [cell(para("a")), cell(para("b"))] },
          { type: "tableRow", content: [cell(para("c")), cell(para())] },
        ],
      },
    ],
  };
}

// The `pressKey` idiom from recipe-keyboard.test.js: run the key through the
// editor's REAL keymap chain rather than calling the handler directly, so the
// test exercises the same ordering the user does.
function pressKey(editor, key) {
  const ev = new KeyboardEvent("keydown", { key });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev)) || false;
}

function posOfLastEmptyParagraph(doc) {
  let pos = -1;
  doc.descendants((node, p) => {
    if (node.type.name === "paragraph" && node.content.size === 0) pos = p;
    return true;
  });
  return pos;
}

function emptyTableDoc() {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph" }] },
              { type: "tableCell", content: [{ type: "paragraph" }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph" }] },
              { type: "tableCell", content: [{ type: "paragraph" }] },
            ],
          },
        ],
      },
    ],
  };
}

// Mirrors exactly how openBlockActionSheet (TipTapEditor.svelte) derives
// blockActionsFor's args from a DOM element — see the four "is this a
// board" callers named in the brief. Kept here rather than imported since
// TipTapEditor.svelte is frozen on `main` and not itself testable in
// isolation.
function actionsForElement(el) {
  return blockActionsFor({
    isBoard: el.classList.contains("block-shell") || el.classList.contains("code-block-wrap"),
    hasTitle: !!el.querySelector(".board-title-slot"),
    canPin: !!(el.textContent || "").trim(),
    isEmpty: false,
  });
}

describe("board-detection — chart and table share the block-shell DOM contract (Plan 1c)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("EMPTY chart wrapper carries .block-shell and a real .board-title-slot", () => {
    env = makeEditor(chartDoc());
    const chartEl = env.editor.view.dom.querySelector(".chart-block");
    expect(chartEl).toBeTruthy();
    expect(chartEl.classList.contains("block-shell")).toBe(true);
    expect(chartEl.querySelector(".board-title-slot")).not.toBeNull();
  });

  it("EMPTY table wrapper carries .block-shell and a real .board-title-slot", () => {
    env = makeEditor(emptyTableDoc());
    const tableEl = env.editor.view.dom.querySelector(".tableWrapper");
    expect(tableEl).toBeTruthy();
    expect(tableEl.classList.contains("block-shell")).toBe(true);
    expect(tableEl.querySelector(".board-title-slot")).not.toBeNull();
  });

  it("blockActionsFor offers delete + title for an EMPTY chart — today this is [] (the reported bug)", () => {
    env = makeEditor(chartDoc());
    const chartEl = env.editor.view.dom.querySelector(".chart-block");
    const actions = actionsForElement(chartEl);
    expect(actions).toContain("delete");
    expect(actions).toContain("title");
  });

  it("blockActionsFor offers delete + title for an EMPTY table — today this is [] (the reported bug)", () => {
    env = makeEditor(emptyTableDoc());
    const tableEl = env.editor.view.dom.querySelector(".tableWrapper");
    const actions = actionsForElement(tableEl);
    expect(actions).toContain("delete");
    expect(actions).toContain("title");
  });

  it("tapping the chart's type chip dispatches shizumu-block-actions with the chart wrapper as detail.block", () => {
    env = makeEditor(chartDoc());
    const { editor } = env;
    let captured = null;
    const onActions = (e) => { captured = e; };
    editor.view.dom.addEventListener(BLOCK_ACTIONS_EVENT, onActions);
    try {
      const chartEl = editor.view.dom.querySelector(".chart-block");
      // Broad query, not scoped under .chart-block: today the chip is a
      // widget decoration (block-type-chip.js) rendered as a DOM sibling
      // of the chart's own wrapper, not a descendant of it. Only one
      // board (the chart) exists in this doc, so the query is unambiguous
      // either way.
      const chip = editor.view.dom.querySelector(".block-type-chip");
      expect(chip).toBeTruthy();
      chip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(captured).not.toBeNull();
      expect(captured.detail.block).toBe(chartEl);
    } finally {
      editor.view.dom.removeEventListener(BLOCK_ACTIONS_EVENT, onActions);
    }
  });
});

// Plan 1c gave `table` the title-navigation contract by adding it to
// TITLE_NAV_TYPES (block-title.js:44). That same list is what the plugin's
// handleKeyDown uses to resolve `board`/`boardDepth` (:190-198), and the
// Enter branch (:280-309) excluded only `list` and `qaBlock`. Inside a table,
// `itemDepth = $from.depth - 1` resolves to the tableCell, so Enter in the
// last cell ran `tr.delete(before(cell), after(cell))` — a filled cell wiped
// by one keypress. `doc.check()` passed and the row kept its cell count
// because ProseMirror's Fitter re-materialises an empty cell in its place,
// which is exactly why nothing else caught it. Data loss; see final-review.md C1.
describe("board-detection — Enter inside a table never deletes a cell (C1)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("Enter in an empty trailing paragraph of a FILLED last cell keeps that cell's text", () => {
    env = makeEditor(tableWithFilledLastCellDoc());
    const { editor } = env;
    const pos = posOfLastEmptyParagraph(editor.state.doc);
    expect(pos).toBeGreaterThan(-1);
    editor.commands.setTextSelection(pos + 1);

    pressKey(editor, "Enter");

    expect(editor.state.doc.textContent).toContain("KEEP ME");
    // The whole table survives too — nothing was lifted out of it.
    expect(editor.state.doc.textContent).toContain("abc");
  });

  it("Enter in an EMPTY last cell splits inside the cell instead of exiting the table", () => {
    env = makeEditor(tableWithEmptyLastCellDoc());
    const { editor } = env;
    const pos = posOfLastEmptyParagraph(editor.state.doc);
    expect(pos).toBeGreaterThan(-1);
    editor.commands.setTextSelection(pos + 1);

    const before = editor.state.doc.firstChild;
    expect(before.type.name).toBe("table");
    pressKey(editor, "Enter");

    // Cursor must still be inside the table, and the last cell now holds two
    // paragraphs (PM's default splitBlock) rather than one plus a new
    // top-level paragraph after the table.
    const $from = editor.state.selection.$from;
    let insideTable = false;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "table") insideTable = true;
    }
    expect(insideTable).toBe(true);
    const table = editor.state.doc.firstChild;
    expect(table.type.name).toBe("table");
    const lastRow = table.lastChild;
    expect(lastRow.lastChild.childCount).toBe(2);
  });
});
