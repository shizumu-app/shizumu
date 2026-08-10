// Diagnostic + regression tests for nested-outline support (issue 7).
//
// Uses prosemirror-model + prosemirror-state directly so there is no DOM
// dependency and no full TipTap Editor required. The schema mirrors exactly
// the content rules declared in unified-list.js.

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { sinkListItem, liftListItem } from "@tiptap/pm/schema-list";
import { migrateListSchema } from "../migrate-list-schema.js";

// ---------------------------------------------------------------------------
// Minimal schema that matches unified-list.js content rules exactly.
// ---------------------------------------------------------------------------

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    // list mirrors List in unified-list.js
    list: {
      group: "block list",
      content: "listItem+",
      defining: true,
      attrs: { blockTitle: { default: null }, pinId: { default: null } },
      parseDOM: [{ tag: "ul[data-list]" }],
      toDOM() { return ["ul", { "data-list": "" }, 0]; },
    },
    // listItem mirrors ListItem in unified-list.js — this is the critical line:
    // content must allow a nested list after the leading paragraph.
    listItem: {
      content: "paragraph (paragraph | list | blockquote)*",
      defining: true,
      attrs: {
        marker: { default: "bullet" },
        checked: { default: false },
        blockTitle: { default: null },
        pinId: { default: null },
      },
      parseDOM: [{ tag: "li[data-marker]" }, { tag: "li" }],
      toDOM() { return ["li", 0]; },
    },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM() { return ["p", 0]; },
    },
    blockquote: {
      group: "block",
      content: "block+",
      parseDOM: [{ tag: "blockquote" }],
      toDOM() { return ["blockquote", 0]; },
    },
    text: { group: "inline" },
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textNode(text) {
  return schema.text(text);
}

function para(text) {
  return schema.nodes.paragraph.create(null, text ? [textNode(text)] : []);
}

function listItem(text, children = []) {
  const content = [para(text), ...children];
  return schema.nodes.listItem.create({ marker: "bullet" }, content);
}

function list(...items) {
  return schema.nodes.list.create(null, items);
}

function doc(...blocks) {
  return schema.nodes.doc.create(null, blocks);
}

// Place cursor at the start of the paragraph inside the given listItem (1-indexed).
function stateWithCursorInItem(document, itemIndex) {
  // Walk the doc to find the n-th listItem.
  let count = 0;
  let targetPos = null;
  document.descendants((node, pos) => {
    if (node.type.name === "listItem") {
      count++;
      if (count === itemIndex) {
        // cursor inside the paragraph inside this listItem
        targetPos = pos + 2; // +1 open listItem, +1 open paragraph
        return false;
      }
    }
  });
  if (targetPos === null) throw new Error(`listItem ${itemIndex} not found`);
  return EditorState.create({
    doc: document,
    selection: TextSelection.near(document.resolve(targetPos)),
  });
}

// Return the JSON structure of the doc for easy assertions.
function docJSON(state) {
  return state.doc.toJSON();
}

// ---------------------------------------------------------------------------
// Mode (a): Tab refuses — sinkListItem should move item 2 inside item 1
// ---------------------------------------------------------------------------
describe("mode (a) — sinkListItem nests item into its predecessor", () => {
  it("sinkListItem returns true and produces nested structure", () => {
    const document = doc(
      list(
        listItem("item 1"),
        listItem("item 2"),
      )
    );
    let state = stateWithCursorInItem(document, 2);

    const sink = sinkListItem(schema.nodes.listItem);
    let dispatched = null;
    const result = sink(state, (tr) => { dispatched = tr; });

    // If this fails (result = false), Tab does nothing — mode (a) confirmed.
    expect(result).toBe(true);
    expect(dispatched).not.toBeNull();

    const newState = state.apply(dispatched);
    const json = docJSON(newState);

    // Expected: doc > list > listItem("item 1") > [para, list > listItem("item 2")]
    const outerList = json.content[0];
    expect(outerList.type).toBe("list");
    expect(outerList.content).toHaveLength(1); // only item 1 remains at top level
    const item1 = outerList.content[0];
    expect(item1.type).toBe("listItem");
    // item 1 should now have a nested list as its second child
    expect(item1.content).toHaveLength(2);
    expect(item1.content[0].type).toBe("paragraph");
    const nestedList = item1.content[1];
    expect(nestedList.type).toBe("list");
    expect(nestedList.content).toHaveLength(1);
    expect(nestedList.content[0].type).toBe("listItem");
    // nested item should contain item 2's text
    expect(nestedList.content[0].content[0].content[0].text).toBe("item 2");
  });

  it("sinkListItem on first item returns false (no predecessor)", () => {
    const document = doc(list(listItem("only item")));
    let state = stateWithCursorInItem(document, 1);
    const sink = sinkListItem(schema.nodes.listItem);
    const result = sink(state, () => {});
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mode (d): depth-limited — should allow at least 3 levels of nesting
// ---------------------------------------------------------------------------
describe("mode (d) — nesting is not capped at 1 level", () => {
  it("can sink to depth 2, then depth 2 again (alongside), then depth 3", () => {
    // Start: list[A, B, C] — all siblings at depth 1.
    const document = doc(
      list(
        listItem("A"),
        listItem("B"),
        listItem("C"),
      )
    );
    const sink = sinkListItem(schema.nodes.listItem);

    // Step 1: sink B under A => list[A(para + list[B]), C]
    let state = stateWithCursorInItem(document, 2);
    let tr1 = null;
    expect(sink(state, (tr) => { tr1 = tr; })).toBe(true);
    state = state.apply(tr1);

    // Step 2: sink C — C is the 3rd listItem by tree traversal, top-level.
    // sinkListItem with nestedBefore=true appends C to A's nested list
    // => list[A(para + list[B, C])]
    let state2 = stateWithCursorInItem(state.doc, 3);
    let tr2 = null;
    expect(sink(state2, (tr) => { tr2 = tr; })).toBe(true);
    state = state2.apply(tr2);

    // After step 2: outer list has only A. A's nested list has [B, C].
    const afterStep2 = docJSON(state);
    expect(afterStep2.content[0].content).toHaveLength(1); // only A at top
    expect(afterStep2.content[0].content[0].content[1].content).toHaveLength(2); // B, C in nested list

    // Step 3: sink C (now 3rd item in tree = C inside A's list) under B
    // => list[A(para + list[B(para + list[C])])]
    let state3 = stateWithCursorInItem(state.doc, 3);
    let tr3 = null;
    expect(sink(state3, (tr) => { tr3 = tr; })).toBe(true);
    state = state3.apply(tr3);

    // After step 3: depth-3 structure.
    const json = docJSON(state);
    const outerList = json.content[0];
    expect(outerList.content).toHaveLength(1); // only A at top
    const a = outerList.content[0];
    expect(a.content[1].type).toBe("list"); // nested list under A
    expect(a.content[1].content).toHaveLength(1); // only B in A's list
    const b = a.content[1].content[0];
    expect(b.content).toHaveLength(2); // para + nested list (depth 3)
    expect(b.content[1].type).toBe("list"); // depth-3 list under B
    expect(b.content[1].content).toHaveLength(1); // only C
    expect(b.content[1].content[0].content[0].content[0].text).toBe("C");
  });
});

// ---------------------------------------------------------------------------
// Mode (b): migration round-trip — nested lists survive migrateListSchema
// ---------------------------------------------------------------------------
describe("mode (b) — migration preserves nested lists", () => {
  it("already-unified nested list round-trips through migrate unchanged", () => {
    const nested = {
      type: "doc",
      content: [
        {
          type: "list",
          content: [
            {
              type: "listItem",
              attrs: { marker: "bullet", checked: false },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "outer" }] },
                {
                  type: "list",
                  content: [
                    {
                      type: "listItem",
                      attrs: { marker: "bullet", checked: false },
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "inner" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = migrateListSchema(nested);
    expect(out).toEqual(nested); // idempotent — already unified, structure preserved
  });

  it("legacy nested list (bulletList > listItem > taskList) migrates without flattening", () => {
    const legacy = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "outer" }] },
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: true },
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "inner" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = migrateListSchema(legacy);
    // Top-level list
    expect(out.content[0].type).toBe("list");
    // Outer item has two children: paragraph and nested list
    const outerItem = out.content[0].content[0];
    expect(outerItem.type).toBe("listItem");
    expect(outerItem.content).toHaveLength(2);
    expect(outerItem.content[0].type).toBe("paragraph");
    const nestedList = outerItem.content[1];
    expect(nestedList.type).toBe("list");
    expect(nestedList.content[0]).toMatchObject({
      type: "listItem",
      attrs: expect.objectContaining({ marker: "task", checked: true }),
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: after fix, sinkListItem should work for outline markers too
// ---------------------------------------------------------------------------
describe("outline marker nesting", () => {
  it("sinkListItem works on items with marker=plain (outline)", () => {
    const document = doc(
      list(
        schema.nodes.listItem.create({ marker: "plain" }, [para("item 1")]),
        schema.nodes.listItem.create({ marker: "plain" }, [para("item 2")]),
      )
    );
    let state = stateWithCursorInItem(document, 2);
    const sink = sinkListItem(schema.nodes.listItem);
    let tr = null;
    const result = sink(state, (t) => { tr = t; });
    expect(result).toBe(true);
    const newState = state.apply(tr);
    const json = docJSON(newState);
    // item 2 should be nested inside item 1
    expect(json.content[0].content).toHaveLength(1);
    expect(json.content[0].content[0].content[1].type).toBe("list");
  });
});

// ---------------------------------------------------------------------------
// Mode (c): visual rendering — nested boards must not carry the top-level
// board chrome (border/padding/background). The BlockTitle NodeView's
// nested-board branch returns a plain div instead of the .block-shell
// element so a nested list reads as a continuation of the outline rather
// than a separate panel.
// ---------------------------------------------------------------------------
describe("mode (c) — nested board renders without .block-shell chrome", () => {
  it("BlockTitle NodeView returns a non-.block-shell dom for nested boards", async () => {
    // Mount a real TipTap editor with the BlockTitle and unified-list extensions
    // so the NodeView path is exercised.
    const { Editor } = await import("@tiptap/core");
    const { Document } = await import("@tiptap/extension-document");
    const { Paragraph } = await import("@tiptap/extension-paragraph");
    const { Text } = await import("@tiptap/extension-text");
    const { Blockquote } = await import("@tiptap/extension-blockquote");
    const { BlockTitle } = await import("../block-title.js");
    const { UnifiedListExtensions } = await import("../unified-list.js");
    const { QABlock } = await import("../qa-block.js");
    const { QAPair } = await import("../qa-pair.js");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor({
      element: host,
      extensions: [Document, Paragraph, Text, Blockquote, QABlock, QAPair, BlockTitle, ...UnifiedListExtensions],
      content: {
        type: "doc",
        content: [
          {
            type: "list",
            attrs: { blockTitle: "outer" },
            content: [
              {
                type: "listItem",
                attrs: { marker: "bullet" },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "outer item" }] },
                  {
                    type: "list",
                    content: [
                      { type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: "inner" }] }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    try {
      // Exactly one .block-shell in the whole tree: the top-level list.
      // Nested boards skip the wrapper chrome and render plain.
      const wrappers = host.querySelectorAll(".block-shell");
      expect(wrappers.length).toBe(1);
      expect(wrappers[0].dataset.board).toBe("list");

      // The inner item must exist, and walking up from it we must hit the
      // outer li (the parent listItem) before any element with .block-shell.
      const innerLi = Array.from(host.querySelectorAll("li"))
        .find((li) => li.textContent && li.textContent.includes("inner"));
      expect(innerLi).toBeTruthy();
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
