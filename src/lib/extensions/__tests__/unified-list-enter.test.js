// Tests for Enter-key behavior in titled lists (boards).
// Bug: pressing Enter on the sole empty listItem of a titled list drops the
// entire board (list node + its blockTitle attr). The invariant is: a titled
// board must survive Enter-on-empty; the result should be the board preserved
// with its title intact, and a fresh paragraph inserted after it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { UnifiedListExtensions } from "../unified-list.js";
import { BlockTitle } from "../block-title.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";

// ---------------------------------------------------------------------------
// Shared editor factory
// ---------------------------------------------------------------------------

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({
        // Disable StarterKit's bundled list types: replaced by UnifiedListExtensions.
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      ...UnifiedListExtensions,
      QABlock,
      QAPair,
      BlockTitle,
    ],
    content,
  });
  return { editor, host };
}

// Synthesize an Enter keydown through PM's plugin chain.
function pressEnter(view) {
  const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
  // First try plugin handleKeyDown (block-title.js plugin gate).
  const handled = view.someProp("handleKeyDown", (f) => f(view, ev));
  if (!handled) {
    // If no plugin handled it, run the extension keyboard shortcuts directly.
    // Tiptap registers them as a PM plugin too, so someProp covers both.
    // The above call already walks all plugins; if nothing returned true the
    // event was not consumed. Nothing more to do here.
  }
  return handled;
}

// ---------------------------------------------------------------------------
// Scenario 3a: titled list with only a title and no content typed yet
// (sole empty listItem, no other items).
// ---------------------------------------------------------------------------

describe("Enter on sole empty listItem of a titled list (scenario 3a)", () => {
  let editor;
  let host;

  beforeEach(() => {
    ({ editor, host } = makeEditor({
      type: "doc",
      content: [
        {
          type: "list",
          attrs: { blockTitle: "my list" },
          content: [
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    }));
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it("list node is preserved with its title after Enter", () => {
    editor.commands.focus("end");
    pressEnter(editor.view);

    const json = editor.getJSON();
    // The first doc child must still be the list board.
    expect(json.content[0].type).toBe("list");
    expect(json.content[0].attrs.blockTitle).toBe("my list");
  });

  it("a new empty sibling listItem is added (Bear-style stay-in-list)", () => {
    editor.commands.focus("end");
    pressEnter(editor.view);

    const json = editor.getJSON();
    // The list now has two items (the original empty one + the new sibling).
    expect(json.content[0].type).toBe("list");
    expect(json.content[0].content.length).toBe(2);
  });

  it("cursor lands inside the new sibling listItem", () => {
    editor.commands.focus("end");
    pressEnter(editor.view);

    // After Enter, cursor must still be inside the list (in the new sibling).
    const { $from } = editor.state.selection;
    let insideList = false;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === "list") { insideList = true; break; }
    }
    expect(insideList).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3b: titled list with content, cursor on an empty item inside.
// Pressing Enter on an empty item in a multi-item list should NOT delete the
// board. It should lift the item out (standard progressive-exit behavior) but
// the list board (which still has other items) must survive.
// ---------------------------------------------------------------------------

describe("Enter on empty listItem in a multi-item titled list (scenario 3b)", () => {
  let editor;
  let host;

  beforeEach(() => {
    ({ editor, host } = makeEditor({
      type: "doc",
      content: [
        {
          type: "list",
          attrs: { blockTitle: "my list" },
          content: [
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "item one" }] }],
            },
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    }));
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it("list node survives after Enter on empty trailing item", () => {
    // Place cursor at the end of the second (empty) listItem.
    editor.commands.focus("end");
    pressEnter(editor.view);

    const json = editor.getJSON();
    // The list must still be the first child.
    expect(json.content[0].type).toBe("list");
    expect(json.content[0].attrs.blockTitle).toBe("my list");
  });

  it("first item content is unchanged after Enter on empty trailing item", () => {
    editor.commands.focus("end");
    pressEnter(editor.view);

    const json = editor.getJSON();
    const list = json.content[0];
    // The surviving item's text must be intact.
    const firstItem = list.content[0];
    expect(firstItem.content[0].content[0].text).toBe("item one");
  });
});

// ---------------------------------------------------------------------------
// Scenario B: Backspace at start of empty non-sole listItem removes the item.
// ---------------------------------------------------------------------------

import { TextSelection } from "@tiptap/pm/state";

// Invoke the Backspace keyboard shortcut on the ListItem extension directly.
// TipTap wires addKeyboardShortcuts into a PM keymap plugin, but in jsdom that
// plugin is often beaten by PM's built-in Backspace (joinBackward) before ours
// gets a chance. Calling the shortcut function directly via extensionManager
// is the reliable test path; it's equivalent to the keymap firing in a real browser.
function pressBackspaceOnListItem(editor) {
  const listItemExt = editor.extensionManager.extensions.find((e) => e.name === "listItem");
  if (!listItemExt) return false;
  const shortcuts = listItemExt.config?.addKeyboardShortcuts?.call({ editor });
  if (!shortcuts?.Backspace) return false;
  return shortcuts.Backspace();
}

describe("Backspace at start of empty non-sole listItem (Task 6 Part B)", () => {
  let editor;
  let host;

  beforeEach(() => {
    ({ editor, host } = makeEditor({
      type: "doc",
      content: [
        {
          type: "list",
          attrs: { blockTitle: null },
          content: [
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
            },
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [{ type: "paragraph" }],
            },
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "third" }] }],
            },
          ],
        },
      ],
    }));
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it("removes the empty middle listItem and leaves two items", () => {
    // Find the empty middle listItem's paragraph position.
    let emptyParaPos = -1;
    editor.state.doc.descendants((node, p) => {
      if (emptyParaPos >= 0) return false;
      if (node.type.name === "paragraph" && node.content.size === 0) {
        emptyParaPos = p + 1;
        return false;
      }
    });
    expect(emptyParaPos).toBeGreaterThan(0);

    // Place cursor at offset 0 of the empty paragraph.
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.near(editor.state.doc.resolve(emptyParaPos))
      )
    );

    const handled = pressBackspaceOnListItem(editor);

    expect(handled).toBe(true);
    const json = editor.getJSON();
    const list = json.content[0];
    expect(list.type).toBe("list");
    expect(list.content.length).toBe(2);
    expect(list.content[0].content[0].content[0].text).toBe("first");
    expect(list.content[1].content[0].content[0].text).toBe("third");
  });

  it("cursor lands at end of previous listItem after removing the empty item", () => {
    // Find the empty middle listItem's paragraph position.
    let emptyParaPos = -1;
    editor.state.doc.descendants((node, p) => {
      if (emptyParaPos >= 0) return false;
      if (node.type.name === "paragraph" && node.content.size === 0) {
        emptyParaPos = p + 1;
        return false;
      }
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.near(editor.state.doc.resolve(emptyParaPos))
      )
    );

    pressBackspaceOnListItem(editor);

    // Cursor must be inside a listItem (the "first" item).
    const { $from } = editor.state.selection;
    let insideListItem = false;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === "listItem") { insideListItem = true; break; }
    }
    expect(insideListItem).toBe(true);
    // Cursor is at the end of the text "first" (parentOffset === 5).
    expect($from.parentOffset).toBe(5);
  });

  it("Backspace on the sole empty listItem LIFTS it (collapsing the list)", () => {
    // Destroy the multi-item editor and create a sole-empty-item one.
    editor.destroy();
    host.remove();
    ({ editor, host } = makeEditor({
      type: "doc",
      content: [
        {
          type: "list",
          attrs: { blockTitle: null },
          content: [
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    }));

    editor.commands.focus("end");

    // New rule: "Backspace at empty list item = unwrap." For the sole item,
    // liftListItemOnce collapses the list to a top-level paragraph.
    const handled = pressBackspaceOnListItem(editor);
    expect(handled).toBe(true);

    // The list is gone; the doc has a top-level paragraph instead.
    const json = editor.getJSON();
    const firstNode = json.content[0];
    expect(firstNode.type).toBe("paragraph");
  });
});
