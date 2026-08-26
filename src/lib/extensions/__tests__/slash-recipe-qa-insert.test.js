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
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { UnifiedListExtensions } from "../unified-list.js";
import { RecipeBlock } from "../recipe-block.js";
import { DecisionBlock } from "../decision-block.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";
import { BlockTitle } from "../block-title.js";
import { ShellTableView } from "../table-shell-view.js";
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
      DecisionBlock,
      QABlock,
      QAPair,
      BlockTitle,
      Table.configure({ resizable: true, View: ShellTableView }),
      TableRow,
      TableHeader,
      TableCell,
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

// Task 1 / Plan 1c, step A3: /table and /outline already call
// armPendingTitleFocus(editor) right after ensureLeadingParagraph(editor)
// so the freshly-mounted NodeView enters title-edit mode immediately.
// /recipe and /q&a never got that call, so today the user has to click
// into the title by hand after picking either command from the slash
// menu. Today this leaves pendingFocusPos unset (null) for both.
describe("slash /recipe and /q&a arm pendingFocusPos on insert (A3)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("/recipe sets blockTitle.pendingFocusPos to the inserted recipeBlock's position", () => {
    env = makeEditor(docWithBlankLineAfterContent());
    const { editor } = env;
    const range = focusBlankLine(editor);
    // The blank line (doc.child(1)) is replaced in place by the new block,
    // so the inserted node's own position is wherever that blank line
    // started — captured before the command runs, since child(0) itself
    // is untouched by the command.
    const expectedPos = editor.state.doc.child(0).nodeSize;

    findCommand("recipe")({ editor, range });

    expect(editor.state.doc.child(1).type.name).toBe("recipeBlock");
    expect(editor.storage.blockTitle.pendingFocusPos).toBe(expectedPos);
  });

  it("/q&a sets blockTitle.pendingFocusPos to the inserted qaBlock's position", () => {
    env = makeEditor(docWithBlankLineAfterContent());
    const { editor } = env;
    const range = focusBlankLine(editor);
    const expectedPos = editor.state.doc.child(0).nodeSize;

    findCommand("q&a")({ editor, range });

    expect(editor.state.doc.child(1).type.name).toBe("qaBlock");
    expect(editor.storage.blockTitle.pendingFocusPos).toBe(expectedPos);
  });
});

// Fix round 1 (task-1-report.md): /table already called armPendingTitleFocus
// before this task started, but NODEVIEW_BOARD_TYPES never included "table",
// so the call was a silent no-op — the whole point of A2 (per the plan) is
// that this call "actually lands the cursor in the new slot" once
// ShellTableView has a real title slot to focus. Covers the pendingFocusPos
// half directly; the actual-focus half is exercised only where jsdom's
// rAF/focus semantics make it reliable (see the comment below).
describe("slash /table arms pendingFocusPos on insert (fix round 1)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("/table sets blockTitle.pendingFocusPos to the inserted table's position", () => {
    env = makeEditor(docWithBlankLineAfterContent());
    const { editor } = env;
    const range = focusBlankLine(editor);

    findCommand("table")({ editor, range });

    // insertTable's own placement logic isn't the D-5 replace-in-place path
    // (that's insertBoardReplacingEmptyLeadingParagraph, /recipe and /q&a
    // only) — assert pendingFocusPos addresses a real table node rather
    // than hardcoding a position that depends on exactly how insertTable
    // lays out the doc.
    const pos = editor.storage.blockTitle.pendingFocusPos;
    expect(typeof pos).toBe("number");
    const node = editor.state.doc.nodeAt(pos);
    expect(node?.type.name).toBe("table");
  });

  // jsdom's focus/rAF semantics differ from real browsers: tried this for
  // real (awaiting two nested rAF ticks, same as consumePendingFocus's own
  // schedule — ShellTableView's own rAF, then bindTitleSlot's enterEditMode
  // rAF nested inside it) and document.activeElement was NOT the slot —
  // jsdom's requestAnimationFrame timer and its focus() handling don't
  // compose reliably enough for this assertion. This is the identical
  // finding already on record for a createBoardNodeView board: see
  // block-title.test.js's `it.skip("after pendingFocusPos is set, slot
  // enters edit mode within two frames", ...)` ("Title slot auto-focus
  // after slash creation (Task 8 Part B)"), which carries the same caveat.
  // Skipped rather than asserted false-negative; the retry/focus logic
  // itself is shared (bindTitleSlot) and already covered by that file's
  // code-level tests plus manual verification, per that same precedent.
  it.skip("after the rAF consume step, the table's .board-title-slot is the focused element", async () => {
    env = makeEditor(docWithBlankLineAfterContent());
    const { editor, host } = env;
    const range = focusBlankLine(editor);

    findCommand("table")({ editor, range });

    // Two frames: one for ShellTableView's own consumePendingFocus() rAF,
    // one for bindTitleSlot's enterEditMode() rAF nested inside it.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const slot = host.querySelector(".tableWrapper > .board-title-slot");
    expect(slot).toBeTruthy();
    expect(document.activeElement).toBe(slot);
  });
});

// Task 3: /table's slash-menu row now opens a row×col size grid instead of
// inserting a hardcoded 3×3 (see slash-commands.js's renderTableSizeGrid
// and editor/table-size-picker.js). The grid's own DOM/decision logic has
// its own test coverage; this exercises the actual insertion path the grid
// commits into — the same commandItems("table").command the item list
// always called, now given an explicit size as its second argument.
describe("slash /table honors a chosen size (Task 3)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("committing a 4x2 pick inserts a table with 4 rows and 2 cells per row, and arms pendingFocusPos", () => {
    env = makeEditor(docWithBlankLineAfterContent());
    const { editor } = env;
    const range = focusBlankLine(editor);

    findCommand("table")({ editor, range }, { rows: 4, cols: 2 });

    let table = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "table") table = node;
    });
    expect(table).not.toBeNull();
    // Row count INCLUDES the header row — withHeaderRow:true makes the
    // first of these 4 rows a tableHeader row, not an extra row on top of
    // the 4 the user picked.
    expect(table.childCount).toBe(4);
    table.forEach((row) => {
      expect(row.childCount).toBe(2);
    });

    const pos = editor.storage.blockTitle.pendingFocusPos;
    expect(typeof pos).toBe("number");
    expect(editor.state.doc.nodeAt(pos)?.type.name).toBe("table");
  });

  it("a size below the 2-row floor (e.g. from a bad direct call) still clamps to 2 rows, matching table-size-picker's clampTableSize", () => {
    env = makeEditor(docWithBlankLineAfterContent());
    const { editor } = env;
    const range = focusBlankLine(editor);

    findCommand("table")({ editor, range }, { rows: 1, cols: 5 });

    let table = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "table") table = node;
    });
    expect(table.childCount).toBe(2);
    table.forEach((row) => {
      expect(row.childCount).toBe(5);
    });
  });
});

function isInsideName(editor, typeName) {
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === typeName) return true;
  }
  return false;
}

// /decision's first slot is a LIST (unlike /recipe's plain paragraph
// "given" slot), so its first textblock is two levels down — the exact
// neighbourhood of the documented D-5 bug.
// insertBoardReplacingEmptyLeadingParagraph places the cursor via
// firstTextblockContentPos, which descends through the list/listItem
// wrapper to find that first textblock; these two cases confirm it does.
describe("slash /decision cursor placement (D-5 at a list-first slot)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("/decision replaces the blank line with the block — cursor lands inside the considered list's item paragraph", () => {
    env = makeEditor(docWithBlankLineAfterContent());
    const { editor } = env;
    const range = focusBlankLine(editor);

    findCommand("decision")({ editor, range });

    const doc = editor.state.doc;
    expect(doc.child(0).textContent).toBe("existing note");
    expect(doc.child(1).type.name).toBe("decisionBlock");

    expect(isInsideName(editor, "listItem")).toBe(true);
    expect(isInsideName(editor, "decisionBlock")).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");

    editor.chain().insertContent("option one").run();
    const decisionNode = editor.state.doc.child(1);
    expect(decisionNode.type.name).toBe("decisionBlock");
    expect(decisionNode.textContent).toContain("option one");
  });

  it("/decision on a blank line mid-paragraph (not the sole content) lands the cursor in the considered list's item paragraph", () => {
    env = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "before after" }] }],
    });
    const { editor } = env;
    const range = { from: 8, to: 13 };
    editor.commands.setTextSelection(range.to);
    expect(() => findCommand("decision")({ editor, range })).not.toThrow();

    expect(isInsideName(editor, "listItem")).toBe(true);
    expect(isInsideName(editor, "decisionBlock")).toBe(true);

    editor.chain().insertContent("option one").run();
    const decisionNode = editor.state.doc.content.content.find((n) => n.type.name === "decisionBlock");
    expect(decisionNode.textContent).toContain("option one");
  });
});

// Fix A (found by driving the live app): /table on a BLANK page produced
// [paragraph, table, paragraph] — every other block produces [block,
// paragraph] since cf8082e ("stop parking an empty line above the first
// block on a page") — and never landed the cursor in its title slot.
//
// One root cause, both symptoms. ensureLeadingParagraph inserted the
// paragraph at 0 AND the selection ended up inside it (measured live:
// selection.from 1, parent paragraph). armPendingTitleFocus's walk asks
// which TOP-LEVEL node contains the selection, got paragraph@0, which is
// not in NODEVIEW_BOARD_TYPES, and returned without arming — so
// ShellTableView's consumePendingFocus found null. The consume side was
// correct all along.
//
// Fix: "table" joins TITLE_ESCAPE_TYPES in editor/slash-insert-target.js,
// so needsLeadingParagraph("table") is false, no paragraph is parked, the
// selection stays in the table's first cell, and the walk resolves to the
// table itself.
describe("slash /table on a blank page (live-app Fix A)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  function blankPage() {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  // The blank page's sole content position, where a user typing "/" stands.
  function focusBlankPage(editor) {
    editor.commands.setTextSelection(1);
    return { from: 1, to: 1 };
  }

  it("inserts the table as the FIRST node — no stray empty paragraph parked above it", () => {
    env = makeEditor(blankPage());
    const { editor } = env;
    const range = focusBlankPage(editor);

    findCommand("table")({ editor, range });

    const types = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types[0]).toBe("table");
    // Anything after the table is StarterKit TrailingNode's own trailing
    // paragraph — the same chrome every other block gets. What must not
    // exist is a paragraph BEFORE the table.
    expect(types.indexOf("paragraph")).toBeGreaterThan(0);
  });

  it("arms pendingFocusPos at the table's own position rather than leaving it null", () => {
    // This is the focus half of the same bug: with the paragraph parked at
    // 0 the selection sat inside it, so nothing was ever armed and the
    // table's title slot never entered edit mode.
    env = makeEditor(blankPage());
    const { editor } = env;
    const range = focusBlankPage(editor);

    findCommand("table")({ editor, range });

    const pos = editor.storage.blockTitle.pendingFocusPos;
    expect(pos).not.toBeNull();
    expect(typeof pos).toBe("number");
    expect(editor.state.doc.nodeAt(pos)?.type.name).toBe("table");
    // And it is the document's first node, i.e. position 0.
    expect(pos).toBe(0);
  });

  it("leaves the cursor inside the table's first cell, not in a paragraph above it", () => {
    env = makeEditor(blankPage());
    const { editor } = env;
    const range = focusBlankPage(editor);

    findCommand("table")({ editor, range });

    expect(isInsideName(editor, "table")).toBe(true);
  });
});
