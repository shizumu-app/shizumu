// D-5 (QA sweep): typing directly after picking /recipe or /q&a from the
// slash menu used to land the cursor back in a stray paragraph ABOVE the
// newly-inserted block (the paragraph the "/" was typed in survived,
// empty, as a sibling) instead of inside the block's first slot. Root
// cause: the post-insert cursor-placement walk assumed TipTap's
// insertContent() left the selection AFTER the new block, which didn't
// hold once the block-level node escaped the (now-empty) paragraph it was
// inserted into. Fixed via insertBoardReplacingEmptyLeadingParagraph in
// slash-commands.js, exercised here through the real commandItems entries.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { UnifiedListExtensions } from "../unified-list.js";
import { RecipeBlock } from "../recipe-block.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";
import { commandItems } from "../../slash-commands.js";

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
    ],
    content,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

function findCommand(title) {
  const item = commandItems.find((i) => i.title === title);
  if (!item) throw new Error(`no command item titled "${title}"`);
  return item.command;
}

// Realistic repro: some existing writing above, then a fresh blank line
// where the user typed "/recipe" (or "/q&a") and picked it from the menu.
// The blank paragraph's own bounds ARE the slash range (deleteRange clears
// the typed query text, leaving the paragraph empty at the same position).
function docWithBlankLineAfterContent() {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "existing note" }] },
      { type: "paragraph" },
    ],
  };
}

// The blank second paragraph's sole content position. Also moves the
// live editor selection there — Suggestion's `range` always reflects
// where the real cursor already sits (at minimum spanning the "/"
// trigger character), so a collapsed test range alone isn't representative
// unless the selection itself is placed there too.
function focusBlankLine(editor) {
  const pos = editor.state.doc.child(0).nodeSize + 1;
  editor.commands.setTextSelection(pos);
  return { from: pos, to: pos };
}

describe("slash /recipe and /q&a cursor placement (D-5)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("/recipe replaces the blank line with the block — no stray empty paragraph survives above it", () => {
    env = makeEditor(docWithBlankLineAfterContent());
    const { editor } = env;
    const range = focusBlankLine(editor);

    findCommand("recipe")({ editor, range });

    const doc = editor.state.doc;
    expect(doc.child(0).type.name).toBe("paragraph");
    expect(doc.child(0).textContent).toBe("existing note");
    expect(doc.child(1).type.name).toBe("recipeBlock");
    // No stray EMPTY paragraph inserted between the existing note and the
    // block (the old bug). StarterKit's own TrailingNode extension may
    // still append a trailing empty paragraph AFTER the block (same
    // built-in behavior /table gets) — that's unrelated chrome, not the
    // D-5 regression, so childCount can be 2 or 3, but never with an
    // extra paragraph BEFORE the block.
    expect(doc.childCount).toBeLessThanOrEqual(3);
    for (let i = 2; i < doc.childCount; i++) {
      expect(doc.child(i).type.name).toBe("paragraph");
    }

    // Cursor sits inside the recipeBlock's given (first) paragraph slot.
    const $from = editor.state.selection.$from;
    let insideRecipe = false;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "recipeBlock") insideRecipe = true;
    }
    expect(insideRecipe).toBe(true);
    expect($from.parent.type.name).toBe("paragraph");

    // Typing right after insert lands IN the block, not back in a sibling.
    editor.chain().insertContent("given text").run();
    const recipeNode = editor.state.doc.child(1);
    expect(recipeNode.type.name).toBe("recipeBlock");
    expect(recipeNode.textContent).toContain("given text");
    // The pre-existing note paragraph is untouched by the typed text.
    expect(editor.state.doc.child(0).textContent).toBe("existing note");
  });

  it("/q&a replaces the blank line with the block — no stray empty paragraph survives above it", () => {
    env = makeEditor(docWithBlankLineAfterContent());
    const { editor } = env;
    const range = focusBlankLine(editor);

    findCommand("q&a")({ editor, range });

    const doc = editor.state.doc;
    expect(doc.child(0).textContent).toBe("existing note");
    expect(doc.child(1).type.name).toBe("qaBlock");
    // See the /recipe test above re: TrailingNode's own trailing paragraph.
    expect(doc.childCount).toBeLessThanOrEqual(3);
    for (let i = 2; i < doc.childCount; i++) {
      expect(doc.child(i).type.name).toBe("paragraph");
    }

    const $from = editor.state.selection.$from;
    let insideQA = false;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "qaBlock") insideQA = true;
    }
    expect(insideQA).toBe(true);

    editor.chain().insertContent("my question").run();
    const qaNode = editor.state.doc.child(1);
    expect(qaNode.type.name).toBe("qaBlock");
    // The typed text landed in the Q paragraph (first qaPair's first child).
    expect(qaNode.firstChild.firstChild.textContent).toContain("my question");
  });

  it("/recipe on a blank line mid-paragraph (not the sole content) still inserts without throwing, AND lands the cursor in the given slot", () => {
    // Slash typed alongside other content on the same line — falls back to
    // the generic insertContent path. Coordinator branch-review fix
    // (item 6): that fallback used to skip cursor placement entirely
    // (regression introduced by the D-5 fix), leaving the cursor wherever
    // insertContent's own default selection landed instead of inside the
    // block. Verify it now lands in the given slot here too.
    env = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "before after" }] }],
    });
    const { editor } = env;
    // Range spanning "after" in the middle of non-empty paragraph content.
    // Suggestion always keeps the live cursor at range.to (it's tracking
    // where the user is actually typing) — set it explicitly here so this
    // matches that real invocation shape rather than the editor's default
    // (doc-start) selection.
    const range = { from: 8, to: 13 };
    editor.commands.setTextSelection(range.to);
    expect(() => findCommand("recipe")({ editor, range })).not.toThrow();
    const types = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).toContain("recipeBlock");

    const $from = editor.state.selection.$from;
    let insideRecipe = false;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "recipeBlock") insideRecipe = true;
    }
    expect(insideRecipe).toBe(true);
    expect($from.parent.type.name).toBe("paragraph");

    // Typing right after insert lands IN the block, not wherever
    // insertContent's default selection happened to leave the cursor.
    editor.chain().insertContent("given text").run();
    const recipeNode = editor.state.doc.content.content.find((n) => n.type.name === "recipeBlock");
    expect(recipeNode.textContent).toContain("given text");
  });

  it("/q&a on a blank line mid-paragraph (not the sole content) lands the cursor in the Q slot", () => {
    env = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "before after" }] }],
    });
    const { editor } = env;
    const range = { from: 8, to: 13 };
    editor.commands.setTextSelection(range.to);
    expect(() => findCommand("q&a")({ editor, range })).not.toThrow();

    const $from = editor.state.selection.$from;
    let insideQA = false;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "qaBlock") insideQA = true;
    }
    expect(insideQA).toBe(true);

    editor.chain().insertContent("my question").run();
    const qaNode = editor.state.doc.content.content.find((n) => n.type.name === "qaBlock");
    expect(qaNode.firstChild.firstChild.textContent).toContain("my question");
  });
});
