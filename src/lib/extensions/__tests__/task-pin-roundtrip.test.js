// Regression: task list pinned then injected/reopened was reportedly
// rendering as a bullet list. Round-trip the JSON through the pin
// pipeline (toJSON → strip pinIds → migrate → schema.nodeFromJSON)
// and assert every listItem keeps marker="task".
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { UnifiedListExtensions } from "../unified-list.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";
import { PinId, stripPinIdsFromJSON } from "../pin-id.js";
import { migrateListSchema } from "../migrate-list-schema.js";

function makeEditor(doc) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false }),
      ...UnifiedListExtensions,
      QABlock,
      QAPair,
      PinId,
    ],
    content: doc,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

const TASK_DOC = {
  type: "doc",
  content: [
    {
      type: "list",
      attrs: { blockTitle: "tasks", pinId: null },
      content: [
        { type: "listItem", attrs: { marker: "task", checked: false, blockTitle: null, pinId: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
        { type: "listItem", attrs: { marker: "task", checked: true, blockTitle: null, pinId: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
      ],
    },
  ],
};

describe("task pin round-trip", () => {
  it("toJSON preserves listItem marker='task'", () => {
    const { editor, cleanup } = makeEditor(TASK_DOC);
    try {
      const json = editor.state.doc.toJSON();
      const list = json.content[0];
      expect(list.type).toBe("list");
      const items = list.content || [];
      expect(items.length).toBe(2);
      expect(items[0].attrs?.marker).toBe("task");
      expect(items[1].attrs?.marker).toBe("task");
      expect(items[1].attrs?.checked).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("stripPinIdsFromJSON leaves marker untouched", () => {
    const { editor, cleanup } = makeEditor(TASK_DOC);
    try {
      const json = editor.state.doc.toJSON();
      const stripped = stripPinIdsFromJSON(json);
      const items = stripped.content[0].content || [];
      expect(items[0].attrs?.marker).toBe("task");
      expect(items[1].attrs?.marker).toBe("task");
      // pinId stripped
      expect(items[0].attrs?.pinId).toBeUndefined();
      expect(stripped.content[0].attrs?.pinId).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("migrateListSchema preserves marker on unified list", () => {
    const migrated = migrateListSchema(TASK_DOC);
    const items = migrated.content[0].content || [];
    expect(items[0].attrs?.marker).toBe("task");
    expect(items[1].attrs?.marker).toBe("task");
    expect(items[1].attrs?.checked).toBe(true);
  });

  it("schema.nodeFromJSON re-parses listItem with marker='task'", () => {
    const { editor, cleanup } = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    try {
      // Inject a task list via the same path appendNodesToDoc uses.
      const taskListJson = TASK_DOC.content[0];
      const stripped = stripPinIdsFromJSON(taskListJson);
      const node = editor.state.schema.nodeFromJSON(stripped);
      expect(node.type.name).toBe("list");
      const items = [];
      node.forEach((c) => items.push(c));
      expect(items.length).toBe(2);
      expect(items[0].attrs.marker).toBe("task");
      expect(items[1].attrs.marker).toBe("task");
      expect(items[1].attrs.checked).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("setNodeAttribute pinId on the list leaves listItem markers alone", () => {
    const { editor, cleanup } = makeEditor(TASK_DOC);
    try {
      // Simulate confirmPin's dispatch: stamp pinId on the list node.
      const listPos = 0; // top-level list at doc offset 0
      const before = editor.state.doc.nodeAt(listPos);
      expect(before.type.name).toBe("list");
      // Verify the source markers BEFORE the dispatch.
      const beforeItems = [];
      before.forEach((c) => beforeItems.push(c));
      expect(beforeItems[0].attrs.marker).toBe("task");
      expect(beforeItems[1].attrs.marker).toBe("task");

      const tr = editor.state.tr.setNodeAttribute(listPos, "pinId", "pin-123");
      editor.view.dispatch(tr);

      // The list now has pinId. listItems untouched.
      const after = editor.state.doc.nodeAt(listPos);
      expect(after.attrs.pinId).toBe("pin-123");
      const afterItems = [];
      after.forEach((c) => afterItems.push(c));
      expect(afterItems[0].attrs.marker).toBe("task");
      expect(afterItems[1].attrs.marker).toBe("task");
      expect(afterItems[1].attrs.checked).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("setNodeAttribute blockTitle on the list leaves listItem markers alone", () => {
    const { editor, cleanup } = makeEditor(TASK_DOC);
    try {
      const listPos = 0;
      const tr = editor.state.tr.setNodeAttribute(listPos, "blockTitle", "my tasks");
      editor.view.dispatch(tr);

      const after = editor.state.doc.nodeAt(listPos);
      expect(after.attrs.blockTitle).toBe("my tasks");
      const items = [];
      after.forEach((c) => items.push(c));
      expect(items[0].attrs.marker).toBe("task");
      expect(items[1].attrs.marker).toBe("task");
    } finally {
      cleanup();
    }
  });

  it("simulates the full confirmPin dispatch sequence on a task list", () => {
    const { editor, cleanup } = makeEditor(TASK_DOC);
    try {
      const listPos = 0;
      // 1. Stamp pinId + blockTitle in a single tr (the real confirmPin pattern).
      const tr = editor.state.tr
        .setNodeAttribute(listPos, "pinId", "pin-xyz")
        .setNodeAttribute(listPos, "blockTitle", "tasks");
      editor.view.dispatch(tr);

      // 2. The list node now has pinId + blockTitle. Re-fetch and serialize as
      //    confirmPin does to update the pin's stored content.
      const updated = editor.state.doc.nodeAt(listPos);
      expect(updated.attrs.pinId).toBe("pin-xyz");
      expect(updated.attrs.blockTitle).toBe("tasks");
      const updatedJson = JSON.stringify({ type: "doc", content: [updated.toJSON()] });

      // 3. Parse the stored JSON back and verify items still have marker=task.
      const parsed = JSON.parse(updatedJson);
      const items = parsed.content[0].content || [];
      expect(items[0].attrs.marker).toBe("task");
      expect(items[1].attrs.marker).toBe("task");
      expect(items[1].attrs.checked).toBe(true);

      // 4. The live editor's listItems also still have marker=task.
      const liveItems = [];
      editor.state.doc.nodeAt(listPos).forEach((c) => liveItems.push(c));
      expect(liveItems[0].attrs.marker).toBe("task");
      expect(liveItems[1].attrs.marker).toBe("task");
    } finally {
      cleanup();
    }
  });

  it("/task with BlockTitle + BlockTypeChip in the extension stack still produces marker='task'", async () => {
    // Match the live editor's extension list as closely as the unit harness allows.
    const { BlockTitle } = await import("../block-title.js");
    const { BlockTypeChip } = await import("../block-type-chip.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({ bulletList: false, orderedList: false, listItem: false }),
        ...UnifiedListExtensions,
        QABlock,
        QAPair,
        PinId,
        BlockTitle,
        BlockTypeChip,
      ],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
      },
    });
    try {
      // Place cursor at start.
      editor.commands.focus("start");
      // Run /task.
      editor.chain().focus().setMarker("task").run();
      // Assert.
      const top = editor.state.doc.firstChild;
      expect(top.type.name).toBe("list");
      const items = [];
      top.forEach((c) => items.push(c));
      expect(items.length).toBe(1);
      expect(items[0].attrs.marker).toBe("task");
      // Verify the DOM mirrors the marker.
      const li = host.querySelector("li");
      expect(li?.getAttribute("data-marker")).toBe("task");
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("/task slash command (setMarker('task')) on a paragraph produces marker='task'", () => {
    // Simulates the slash command: editor.chain().focus().deleteRange(range).setMarker("task").run()
    // But without the deleteRange (no slash text in our fixture).
    const { editor, cleanup } = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    });
    try {
      // Place cursor inside the paragraph.
      const tr = editor.state.tr.setSelection(
        editor.state.selection.constructor.atStart(editor.state.doc),
      );
      editor.view.dispatch(tr);
      // Run the /task command.
      editor.chain().focus().setMarker("task").run();
      // Verify the result: doc should now be a list with one task listItem.
      const top = editor.state.doc.firstChild;
      expect(top.type.name).toBe("list");
      const items = [];
      top.forEach((c) => items.push(c));
      expect(items.length).toBe(1);
      expect(items[0].type.name).toBe("listItem");
      expect(items[0].attrs.marker).toBe("task");
    } finally {
      cleanup();
    }
  });

  it("full pin save → restore round-trip preserves marker", () => {
    const { editor, cleanup } = makeEditor(TASK_DOC);
    try {
      // Simulate pin save: serialize the list block.
      const blockNode = editor.state.doc.firstChild;
      const blockJson = blockNode.toJSON();
      const pinContent = JSON.stringify({ type: "doc", content: [blockJson] });

      // Simulate pin restore through the modal pipeline.
      const parsed = JSON.parse(pinContent);
      const migrated = migrateListSchema(parsed);
      const list = migrated.content[0];
      const items = list.content || [];
      expect(items[0].attrs?.marker).toBe("task");
      expect(items[1].attrs?.marker).toBe("task");

      // Simulate inject path: strip pinIds + nodeFromJSON.
      const stripped = stripPinIdsFromJSON(list);
      const restoredNode = editor.state.schema.nodeFromJSON(stripped);
      const restoredItems = [];
      restoredNode.forEach((c) => restoredItems.push(c));
      expect(restoredItems[0].attrs.marker).toBe("task");
      expect(restoredItems[1].attrs.marker).toBe("task");
    } finally {
      cleanup();
    }
  });
});
