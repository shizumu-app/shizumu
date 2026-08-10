import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { UnifiedListExtensions } from "../unified-list.js";
import { RecipeBlock } from "../recipe-block.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";
import { BlockTitle } from "../block-title.js";
import { BlockEscExit } from "../block-esc-exit.js";
import { migrateRecipeSchema } from "../migrate-recipe-schema.js";

const para = (text) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : undefined,
});

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false }),
      ...UnifiedListExtensions,
      RecipeBlock,
      QABlock,
      QAPair,
      BlockTitle,
      BlockEscExit,
    ],
    content,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

function recipeDoc() {
  return {
    type: "doc",
    content: [
      {
        type: "recipeBlock",
        content: [
          para(),
          {
            type: "list",
            content: [
              {
                type: "listItem",
                attrs: { marker: "ordered" },
                content: [para()],
              },
            ],
          },
          para(),
        ],
      },
    ],
  };
}

function findFirstTextblockPos(doc, predicate) {
  let pos = -1;
  doc.descendants((node, p) => {
    if (pos >= 0) return false;
    if (node.isTextblock && predicate(node, p)) {
      pos = p;
      return false;
    }
    return true;
  });
  return pos;
}

describe("migrateRecipeSchema", () => {
  it("rewrites algorithmBlock to recipeBlock", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "algorithmBlock",
          content: [para("a"), para("b"), para("c")],
        },
      ],
    };
    const out = migrateRecipeSchema(input);
    expect(out.content[0].type).toBe("recipeBlock");
    expect(out.content[0].content[0].content[0].text).toBe("a");
  });

  it("is idempotent on already-migrated docs", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "recipeBlock",
          content: [para("x"), para("y"), para("z")],
        },
      ],
    };
    const out = migrateRecipeSchema(input);
    expect(out.content[0].type).toBe("recipeBlock");
  });

  it("leaves null/undefined/non-object inputs unchanged", () => {
    expect(migrateRecipeSchema(null)).toBeNull();
    expect(migrateRecipeSchema(undefined)).toBeUndefined();
    expect(migrateRecipeSchema(42)).toBe(42);
  });
});

function pressKey(editor, key) {
  const ev = new KeyboardEvent("keydown", { key });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev)) || false;
}

function isInsideName(editor, typeName) {
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === typeName) return true;
  }
  return false;
}

describe("RecipeBlock Enter behavior", () => {
  let env;

  beforeEach(() => {
    env = makeEditor(recipeDoc());
  });

  afterEach(() => {
    if (env) env.cleanup();
  });

  it("Enter on empty given slot advances cursor to the do slot", () => {
    const { editor } = env;
    const givenPos = findFirstTextblockPos(editor.state.doc, () => true);
    expect(givenPos).toBeGreaterThan(-1);
    editor.chain().setTextSelection(givenPos + 1).focus().run();

    pressKey(editor, "Enter");
    expect(isInsideName(editor, "listItem")).toBe(true);
  });

  it("Escape exits the recipe block to a paragraph below", () => {
    const { editor } = env;
    const givenPos = findFirstTextblockPos(editor.state.doc, () => true);
    editor.chain().setTextSelection(givenPos + 1).focus().run();

    editor.commands.blockEscExit();
    expect(isInsideName(editor, "recipeBlock")).toBe(false);
  });
});

// D-7 (QA sweep): recipe-block.js's own comment says advancing from the do
// slot "consumes the empty paragraph by moving past it," but the old
// moveBetweenSlots(+1) call only moved the selection — it never removed
// the trailing empty list item Enter itself had just created. Filling the
// do-slot with one item then pressing Enter twice (once to split off a
// fresh empty item, once more to advance) left that empty item behind as
// an orphaned "2." Fixed via advanceFromDoSlot in recipe-block.js.
describe("RecipeBlock do-slot Enter advance consumes the trailing empty item (D-7)", () => {
  function docWithOneDoItem() {
    return {
      type: "doc",
      content: [
        {
          type: "recipeBlock",
          content: [
            para(),
            {
              type: "list",
              content: [
                { type: "listItem", attrs: { marker: "ordered" }, content: [para("item1")] },
              ],
            },
            para(),
          ],
        },
      ],
    };
  }

  it("Enter twice from a filled do-item advances to result without leaving an orphaned empty item", () => {
    const env = makeEditor(docWithOneDoItem());
    const { editor } = env;
    try {
      // Cursor at the end of "item1".
      let itemEndPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "item1") itemEndPos = pos + node.nodeSize;
      });
      expect(itemEndPos).toBeGreaterThan(-1);
      editor.chain().setTextSelection(itemEndPos).focus().run();

      // First Enter: non-empty item -> the list's own keymap splits off a
      // fresh (empty) sibling item — normal "add another item" behavior.
      pressKey(editor, "Enter");
      let listNode = null;
      editor.state.doc.descendants((node) => { if (node.type.name === "list") listNode = node; });
      expect(listNode.childCount).toBe(2);

      // Second Enter: on that now-empty trailing item -> advances to the
      // result slot AND removes the scratch item (no orphaned "2.").
      pressKey(editor, "Enter");
      listNode = null;
      editor.state.doc.descendants((node) => { if (node.type.name === "list") listNode = node; });
      expect(listNode.childCount).toBe(1);
      expect(listNode.child(0).textContent).toBe("item1");

      // Cursor now sits in the result slot (recipeBlock's 3rd child).
      const $from = editor.state.selection.$from;
      let recipeDepth = -1;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "recipeBlock") { recipeDepth = d; break; }
      }
      expect(recipeDepth).toBeGreaterThan(-1);
      expect($from.index(recipeDepth)).toBe(2);
    } finally {
      env.cleanup();
    }
  });

  it("Enter on a do-slot with only a single (never-typed-into) item is left alone", () => {
    // Guard: don't delete the sole item just because it's empty — only a
    // TRAILING scratch item created by a preceding Enter-on-non-empty-item
    // should be consumed.
    const env = makeEditor(recipeDoc()); // do-slot has one empty item
    const { editor } = env;
    try {
      const doItemPos = findFirstTextblockPos(editor.state.doc, (node, pos) => {
        // Second textblock in the doc is the do-slot's empty paragraph.
        return true;
      });
      // Find the do-slot's (list) sole item paragraph directly.
      let doParaPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (doParaPos >= 0) return false;
        if (node.type.name === "listItem") { doParaPos = pos + 2; return false; }
        return true;
      });
      expect(doParaPos).toBeGreaterThan(-1);
      editor.chain().setTextSelection(doParaPos).focus().run();

      pressKey(editor, "Enter"); // advances to result; item is empty but sole — left alone

      let listNode = null;
      editor.state.doc.descendants((node) => { if (node.type.name === "list") listNode = node; });
      expect(listNode.childCount).toBe(1);
    } finally {
      env.cleanup();
    }
  });
});
