import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Chart } from "../chart.js";
import { Attachment } from "../attachment.js";
import { BlockTypeChip, BlockTypeChipPluginKey } from "../block-type-chip.js";

function makeEditor(doc) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Chart,
      Attachment,
      BlockTypeChip,
    ],
    content: doc,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

describe("BlockTypeChip", () => {
  // Plan 1c (task-1-brief.md): chart adopted createBlockShell, which
  // builds its own chip with its own click handler — the same shape every
  // other board's chip already had. CHIP_TARGET_TYPES is now empty: every
  // board owns its own chip, so this plugin has nothing left to target.
  // See block-type-chip.js's header comment for why the (now-empty)
  // extension stays registered rather than being deleted outright.
  it("emits no widget decorations — every board type now owns its own chip", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "p" }] },
        { type: "chart", attrs: { kind: "flowchart" } },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "h" }] },
        { type: "attachment", attrs: { filename: "a.pdf" } },
      ],
    });
    try {
      const set = BlockTypeChipPluginKey.getState(editor.state);
      const decos = set.find();
      expect(decos.length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("emits no widget for a table node (its chip is rendered by ShellTableView)", () => {
    const { editor, cleanup } = makeEditor({
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
          ],
        },
      ],
    });
    try {
      const set = BlockTypeChipPluginKey.getState(editor.state);
      const decos = set.find();
      expect(decos.length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("emits no widget for a doc with only paragraphs and headings", () => {
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "p" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "h" }] },
      ],
    });
    try {
      const set = BlockTypeChipPluginKey.getState(editor.state);
      const decos = set.find();
      expect(decos.length).toBe(0);
    } finally {
      cleanup();
    }
  });
});
