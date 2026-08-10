// Diagnostic test for the modal -> editor splice path: when the user
// toggles a checkbox in the pin modal and closes, the splice should
// faithfully transfer the new checked state into the main editor's PM
// doc for every task item, including the FIRST one.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Blockquote } from "@tiptap/extension-blockquote";
import { UnifiedListExtensions } from "../unified-list.js";
import { BlockTitle } from "../block-title.js";
import { PinId } from "../pin-id.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";

const PIN_ID = "splice-pin-1";

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [Document, Paragraph, Text, Blockquote, ...UnifiedListExtensions, BlockTitle, PinId, QABlock, QAPair],
    content,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

// Inline copy of spliceNodeAtPinId from TipTapEditor.svelte. Keep in lockstep.
function spliceNodeAtPinId(editor, pinId, newNodeJson) {
  if (!editor || !pinId || !newNodeJson) return false;
  let firstPos = null;
  let lastEnd = null;
  editor.state.doc.descendants((node, pos) => {
    if (firstPos !== null) return false;
    if (node.attrs?.pinId === pinId) {
      firstPos = pos;
      lastEnd = pos + node.nodeSize;
      return false;
    }
    return true;
  });
  if (firstPos === null) return false;
  try {
    const newNode = editor.state.schema.nodeFromJSON(newNodeJson);
    const tr = editor.state.tr.replaceWith(firstPos, lastEnd, newNode);
    editor.view.dispatch(tr);
    return true;
  } catch (err) {
    return false;
  }
}

describe("spliceNodeAtPinId preserves checked state of every task item", () => {
  let env;

  beforeEach(() => {
    // Editor starts with a list of three unchecked task items.
    env = makeEditor({
      type: "doc",
      content: [{
        type: "list",
        attrs: { pinId: PIN_ID, blockTitle: "tasks" },
        content: [
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "third" }] }] },
        ],
      }],
    });
  });

  afterEach(() => env.cleanup());

  it("checks the FIRST item only", () => {
    // Simulate the modal returning a new node JSON where only the first item is checked.
    const newNodeJson = {
      type: "list",
      attrs: { pinId: PIN_ID, blockTitle: "tasks" },
      content: [
        { type: "listItem", attrs: { marker: "task", checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
        { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
        { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "third" }] }] },
      ],
    };
    const ok = spliceNodeAtPinId(env.editor, PIN_ID, newNodeJson);
    expect(ok).toBe(true);

    const json = env.editor.getJSON();
    const items = json.content[0].content;
    expect(items[0].attrs.checked).toBe(true);
    expect(items[1].attrs.checked).toBe(false);
    expect(items[2].attrs.checked).toBe(false);
  });

  it("checks all three items", () => {
    const newNodeJson = {
      type: "list",
      attrs: { pinId: PIN_ID, blockTitle: "tasks" },
      content: [
        { type: "listItem", attrs: { marker: "task", checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
        { type: "listItem", attrs: { marker: "task", checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
        { type: "listItem", attrs: { marker: "task", checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "third" }] }] },
      ],
    };
    spliceNodeAtPinId(env.editor, PIN_ID, newNodeJson);
    const items = env.editor.getJSON().content[0].content;
    expect(items.map(i => i.attrs.checked)).toEqual([true, true, true]);
  });

  it("FIRST listItem's NodeView DOM checkbox reflects checked=true after splice", () => {
    const newNodeJson = {
      type: "list",
      attrs: { pinId: PIN_ID, blockTitle: "tasks" },
      content: [
        { type: "listItem", attrs: { marker: "task", checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
        { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
      ],
    };
    spliceNodeAtPinId(env.editor, PIN_ID, newNodeJson);
    const checkboxes = env.host.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });
});

describe("spliceNodeAtPinId carries an overridden blockTitle", () => {
  // Documents the title-edit-in-modal contract: saveAndCloseModal overrides
  // newNode.attrs.blockTitle with the header input's value before splicing.
  // The main editor's source node must reflect the new title.
  const TITLE_PIN_ID = "title-pin-1";

  it("overriding blockTitle on the new node propagates to the main editor", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor({
      element: host,
      extensions: [Document, Paragraph, Text, Blockquote, ...UnifiedListExtensions, BlockTitle, PinId, QABlock, QAPair],
      content: {
        type: "doc",
        content: [{
          type: "list",
          attrs: { pinId: TITLE_PIN_ID, blockTitle: "old" },
          content: [{
            type: "listItem",
            attrs: { marker: "task", checked: false },
            content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
          }],
        }],
      },
    });

    // Simulate the override that saveAndCloseModal performs.
    const newNodeJson = {
      type: "list",
      attrs: { pinId: TITLE_PIN_ID, blockTitle: "new" },  // header input wins
      content: [{
        type: "listItem",
        attrs: { marker: "task", checked: false },
        content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
      }],
    };
    const ok = spliceNodeAtPinId(editor, TITLE_PIN_ID, newNodeJson);
    expect(ok).toBe(true);

    const json = editor.getJSON();
    expect(json.content[0].type).toBe("list");
    expect(json.content[0].attrs.blockTitle).toBe("new");
    expect(json.content[0].attrs.pinId).toBe(TITLE_PIN_ID);

    editor.destroy();
    host.remove();
  });
});

describe("spliceNodeAtPinId on a blockquote with a nested task list", () => {
  // The user's actual screenshot shape: a blockquote carries the pinId,
  // contains a leading paragraph (the visible subtitle) and a nested
  // list of task items. Splice must preserve checked state on the FIRST
  // nested listItem too.
  const PINNED_BQ_ID = "splice-bq-1";

  function makeBQ(items) {
    return makeEditor({
      type: "doc",
      content: [{
        type: "blockquote",
        attrs: { pinId: PINNED_BQ_ID, blockTitle: "outline" },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "subtitle" }] },
          {
            type: "list",
            content: items.map((checked, i) => ({
              type: "listItem",
              attrs: { marker: "task", checked },
              content: [{ type: "paragraph", content: [{ type: "text", text: `item${i}` }] }],
            })),
          },
        ],
      }],
    });
  }

  let env;
  beforeEach(() => { env = makeBQ([false, false]); });
  afterEach(() => env.cleanup());

  it("flipping the FIRST nested listItem propagates after splice", () => {
    const newNodeJson = {
      type: "blockquote",
      attrs: { pinId: PINNED_BQ_ID, blockTitle: "outline" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "subtitle" }] },
        {
          type: "list",
          content: [
            { type: "listItem", attrs: { marker: "task", checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "item0" }] }] },
            { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "item1" }] }] },
          ],
        },
      ],
    };
    const ok = spliceNodeAtPinId(env.editor, PINNED_BQ_ID, newNodeJson);
    expect(ok).toBe(true);

    const json = env.editor.getJSON();
    const bq = json.content[0];
    expect(bq.type).toBe("blockquote");
    const list = bq.content[1];
    expect(list.type).toBe("list");
    expect(list.content[0].attrs.checked).toBe(true);
    expect(list.content[1].attrs.checked).toBe(false);

    // DOM-level check on the first item's checkbox.
    const checkboxes = env.host.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });
});

describe("listItem NodeView checkbox click targets the correct item", () => {
  // Regression for the reported bug: clicking the FIRST checkbox in a task
  // list checked the SECOND item. Root cause was the change handler using
  // getPos() which could resolve to a sibling. The fix uses posAtDOM so the
  // dispatch is anchored to the actual clicked DOM element.
  function makeListEditor(content) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor({
      element: host,
      extensions: [Document, Paragraph, Text, Blockquote, ...UnifiedListExtensions, BlockTitle, PinId, QABlock, QAPair],
      content,
    });
    return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
  }

  it("clicking the FIRST checkbox toggles the FIRST listItem only", () => {
    const env = makeListEditor({
      type: "doc",
      content: [{
        type: "list",
        content: [
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
        ],
      }],
    });
    try {
      const checkboxes = env.host.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBe(2);

      checkboxes[0].checked = true;
      checkboxes[0].dispatchEvent(new Event("change", { bubbles: true }));

      const items = env.editor.getJSON().content[0].content;
      expect(items[0].attrs.checked).toBe(true);
      expect(items[1].attrs.checked).toBe(false);
    } finally {
      env.cleanup();
    }
  });

  it("clicking the SECOND checkbox toggles the SECOND listItem only", () => {
    const env = makeListEditor({
      type: "doc",
      content: [{
        type: "list",
        content: [
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "third" }] }] },
        ],
      }],
    });
    try {
      const checkboxes = env.host.querySelectorAll('input[type="checkbox"]');
      checkboxes[1].checked = true;
      checkboxes[1].dispatchEvent(new Event("change", { bubbles: true }));

      const items = env.editor.getJSON().content[0].content;
      expect(items[0].attrs.checked).toBe(false);
      expect(items[1].attrs.checked).toBe(true);
      expect(items[2].attrs.checked).toBe(false);
    } finally {
      env.cleanup();
    }
  });
});
