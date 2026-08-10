// Full-stack /task regression: load the entire editing extension list
// from `buildEditingExtensions({})` and assert /task on a paragraph
// always produces marker="task", never marker="bullet".
//
// The smaller `task-pin-roundtrip` suite passes with a ~7-extension
// subset. The user reports the bug with the live app. This suite is
// the bridge: it instantiates the same extension graph the live editor
// builds (placeholder, slash, mention, page/pin ref, block-movement,
// gap decorations, copy keymap, tab/esc handlers, selection accent,
// block-type-chip, local image, chart, code block, find/replace, link)
// and runs the marker conversion paths the user actually hits.
//
// If these tests pass and the user still sees a bullet list, the bug
// is outside the JS state path — stale build, hot-reload artifact,
// or a paste-time / DOM-parse interaction not covered here.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { buildEditingExtensions } from "../../render/shared-extensions.js";

let host;
let editor;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: buildEditingExtensions({}),
    content: "<p></p>",
  });
});

afterEach(() => {
  editor.destroy();
  host.remove();
});

function firstListItemMarker() {
  const top = editor.state.doc.firstChild;
  if (!top || top.type.name !== "list") return null;
  const items = [];
  top.forEach((c) => items.push(c));
  return items[0]?.attrs?.marker || null;
}

function firstLiDataMarker() {
  // walk every li in the host; first one that is a real PM-managed list
  // item is the one we just created.
  const li = host.querySelector("li");
  return li?.getAttribute("data-marker") || null;
}

describe("full-stack /task regression — buildEditingExtensions", () => {
  it("setMarker('task') on a fresh empty paragraph produces marker='task'", () => {
    editor.commands.focus("start");
    editor.chain().focus().setMarker("task").run();
    expect(editor.state.doc.firstChild.type.name).toBe("list");
    expect(firstListItemMarker()).toBe("task");
    expect(firstLiDataMarker()).toBe("task");
  });

  it("setMarker('task') on a paragraph with text produces marker='task'", () => {
    editor.commands.setContent("<p>hello</p>");
    editor.commands.focus("end");
    editor.chain().focus().setMarker("task").run();
    expect(editor.state.doc.firstChild.type.name).toBe("list");
    expect(firstListItemMarker()).toBe("task");
    expect(firstLiDataMarker()).toBe("task");
  });

  it("the full slash-command sequence (deleteRange + setMarker) on /task text produces marker='task'", () => {
    // Simulate the editor state after the user has typed "/task" — a
    // paragraph containing "/task" with the selection at the end.
    editor.commands.setContent("<p>/task</p>");
    const para = editor.state.doc.firstChild;
    const slashStart = 1; // inside paragraph, just after the opening tag
    const slashEnd = slashStart + para.content.size;
    const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, slashEnd));
    editor.view.dispatch(tr);
    // The slash command's actual invocation pattern, with the same
    // deleteRange the suggestion plugin would produce.
    editor.chain().focus().deleteRange({ from: slashStart, to: slashEnd }).setMarker("task").run();
    expect(editor.state.doc.firstChild.type.name).toBe("list");
    expect(firstListItemMarker()).toBe("task");
    expect(firstLiDataMarker()).toBe("task");
  });

  it("slash-command pattern + ensureLeadingParagraph + armPendingTitleFocus mimicked from slash-commands.js produces marker='task'", () => {
    // This replays the exact flow inside the /task slash-command's
    // command callback (slash-commands.js line 61-66).
    editor.commands.setContent("<p>/task</p>");
    const para = editor.state.doc.firstChild;
    const slashStart = 1;
    const slashEnd = slashStart + para.content.size;
    const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, slashEnd));
    editor.view.dispatch(tr);

    // Step 1: deleteRange + setMarker
    editor.chain().focus().deleteRange({ from: slashStart, to: slashEnd }).setMarker("task").run();

    // Step 2: ensureLeadingParagraph (verbatim copy of the helper).
    {
      const first = editor.state.doc.firstChild;
      const textBearing = new Set(["paragraph", "heading"]);
      if (first && !textBearing.has(first.type.name)) {
        editor.commands.insertContentAt(0, { type: "paragraph" });
      }
    }

    // Step 3: armPendingTitleFocus (verbatim).
    {
      const NODEVIEW_BOARD_TYPES = new Set(["list", "blockquote", "qaBlock"]);
      const selFrom = editor.state.selection.from;
      let pos = -1;
      let nodeName = null;
      editor.state.doc.forEach((node, offset) => {
        if (pos >= 0) return;
        if (selFrom >= offset && selFrom <= offset + node.nodeSize) {
          pos = offset;
          nodeName = node.type.name;
        }
      });
      if (pos >= 0 && NODEVIEW_BOARD_TYPES.has(nodeName) && editor.storage?.blockTitle) {
        editor.storage.blockTitle.pendingFocusPos = pos;
      }
    }

    // The list should be the second top-level node now (after a leading paragraph
    // inserted by ensureLeadingParagraph). Walk every list in the doc.
    let foundList = null;
    editor.state.doc.forEach((node) => {
      if (!foundList && node.type.name === "list") foundList = node;
    });
    expect(foundList).not.toBeNull();
    const items = [];
    foundList.forEach((c) => items.push(c));
    expect(items.length).toBe(1);
    expect(items[0].attrs.marker).toBe("task");
    expect(firstLiDataMarker()).toBe("task");
  });

  it("setMarker('task') after Enter at end of paragraph (new empty para) produces marker='task'", () => {
    editor.commands.setContent("<p>line one</p>");
    editor.commands.focus("end");
    // Simulate Enter — adds a new empty paragraph after the first.
    editor.commands.splitBlock();
    // Cursor now in the empty paragraph. Run /task on it.
    editor.chain().focus().setMarker("task").run();
    // Doc shape: paragraph("line one"), list(listItem(paragraph)).
    const second = editor.state.doc.child(1);
    expect(second.type.name).toBe("list");
    const items = [];
    second.forEach((c) => items.push(c));
    expect(items[0].attrs.marker).toBe("task");
    // DOM: the (only) <li> in the host should carry data-marker="task".
    expect(firstLiDataMarker()).toBe("task");
  });

  it("setMarker('task') twice in a row (idempotent) keeps marker='task'", () => {
    editor.commands.focus("start");
    editor.chain().focus().setMarker("task").run();
    editor.chain().focus().setMarker("task").run();
    expect(firstListItemMarker()).toBe("task");
    expect(firstLiDataMarker()).toBe("task");
  });

  it("setMarker('bullet') then setMarker('task') flips the marker", () => {
    editor.commands.focus("start");
    editor.chain().focus().setMarker("bullet").run();
    expect(firstListItemMarker()).toBe("bullet");
    editor.chain().focus().setMarker("task").run();
    expect(firstListItemMarker()).toBe("task");
    expect(firstLiDataMarker()).toBe("task");
  });

  it("setMarker('task') then a subsequent unrelated transaction does not revert to bullet", () => {
    editor.commands.focus("start");
    editor.chain().focus().setMarker("task").run();
    expect(firstListItemMarker()).toBe("task");
    // Force a no-op tr to confirm a re-render or appendTransaction hook
    // doesn't flip the marker back. This catches the case where some
    // plugin's apply() rebuilds the attrs from a default.
    editor.view.dispatch(editor.state.tr);
    expect(firstListItemMarker()).toBe("task");
    expect(firstLiDataMarker()).toBe("task");
  });

  it("setMarker('task') survives typing one character in the new item", () => {
    editor.commands.focus("start");
    editor.chain().focus().setMarker("task").run();
    expect(firstListItemMarker()).toBe("task");
    // Type one character. If any extension's appendTransaction reacts
    // to text input by re-creating the listItem with default attrs,
    // this is where it would manifest.
    editor.chain().focus().insertContent("x").run();
    expect(firstListItemMarker()).toBe("task");
    expect(firstLiDataMarker()).toBe("task");
  });
});
