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
  it("emits one widget decoration for a chart node only", () => {
    // attachment is intentionally NOT targeted — it renders its own compact
    // inline chip (AttachmentBlock.svelte), so only the chart gets a widget.
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
      expect(decos.length).toBe(1);
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
