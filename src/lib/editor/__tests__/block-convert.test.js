import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { UnifiedListExtensions } from "../../extensions/unified-list.js";
import { RecipeBlock } from "../../extensions/recipe-block.js";
import { DecisionBlock } from "../../extensions/decision-block.js";
import { QABlock } from "../../extensions/qa-block.js";
import { QAPair } from "../../extensions/qa-pair.js";
import { CodeBlockShizumu } from "../../extensions/code-block.js";
import { BlockTitle } from "../../extensions/block-title.js";
import { PinId } from "../../extensions/pin-id.js";
import { BlockEscExit } from "../../extensions/block-esc-exit.js";
// A tiny real block-level atom (group "block", atom: true, no content) that
// needs no mermaid — the shape the ATOM_TEXT line refuses, available as a
// LIVE node so the live-Node cases below aren't limited to shapes that
// convert cleanly.
import { DateSeparator } from "../../extensions/date-separator.js";
import {
  CONVERTIBLE_TYPES,
  CONVERT_TARGETS,
  convertTargetsFor,
  convertBlockNode,
} from "../block-convert.js";

// Reuses the makeEditor pattern from
// src/lib/extensions/__tests__/recipe-keyboard.test.js — a real Editor gets
// us a real `schema` (and, for the round-trip assertions, a way to build
// real nodes from the JSON this module produces, proving it's not just
// JSON that LOOKS right but JSON the schema actually accepts).
function makeEditor() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false, codeBlock: false }),
      ...UnifiedListExtensions,
      RecipeBlock,
      DecisionBlock,
      QABlock,
      QAPair,
      CodeBlockShizumu,
      BlockTitle,
      PinId,
      BlockEscExit,
      DateSeparator,
    ],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

const text = (t) => ({ type: "text", text: t });
const para = (t) => (t ? { type: "paragraph", content: [text(t)] } : { type: "paragraph" });
const item = (marker, t, extra) => ({
  type: "listItem",
  attrs: { marker, checked: false, blockTitle: null, pinId: null, ...extra },
  content: [para(t)],
});
const list = (marker, texts, attrs) => ({
  type: "list",
  attrs: { blockTitle: null, pinId: null, ...attrs },
  content: texts.map((t) => item(marker, t)),
});

// Concatenate every text node under a node/array-of-nodes, depth-first, for
// "did the words survive" comparisons that don't care about the new
// structure (paragraph vs listItem vs qaPair) or added labels.
function allText(json) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    if (n.type === "text") out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(json);
  return out.join("");
}

describe("convertTargetsFor", () => {
  it("refuses a type not in CONVERTIBLE_TYPES", () => {
    for (const t of ["chart", "table", "attachment", "dayMarker", "paragraph", "heading"]) {
      expect(convertTargetsFor(t)).toEqual([]);
    }
  });

  it("does not offer a list's own current marker as a target", () => {
    expect(convertTargetsFor("list", { marker: "bullet" })).not.toContain("bullet");
    expect(convertTargetsFor("list", { marker: "bullet" })).toEqual(
      expect.arrayContaining(["ordered", "task", "blockquote", "qaBlock", "codeBlock", "paragraphs"]),
    );
    expect(convertTargetsFor("list", { marker: "ordered" })).not.toContain("ordered");
    expect(convertTargetsFor("list", { marker: "task" })).not.toContain("task");
  });

  it("defaults an unspecified list marker to bullet (the schema default)", () => {
    expect(convertTargetsFor("list", {})).not.toContain("bullet");
  });

  it("does not offer blockquote/qaBlock/codeBlock as a target of their own type", () => {
    expect(convertTargetsFor("blockquote")).not.toContain("blockquote");
    expect(convertTargetsFor("qaBlock")).not.toContain("qaBlock");
    expect(convertTargetsFor("codeBlock")).not.toContain("codeBlock");
  });

  it("offers every CONVERT_TARGETS entry for recipeBlock/decisionBlock (no target shares their shape)", () => {
    expect(convertTargetsFor("recipeBlock")).toEqual(CONVERT_TARGETS);
    expect(convertTargetsFor("decisionBlock")).toEqual(CONVERT_TARGETS);
  });
});

describe("convertTargetsFor — lookahead into nested content (fix-wave item 10)", () => {
  // Given only a type name the function cannot see inside the block, so a
  // table- or atom-bearing board still offered rows that convertBlockNode
  // now refuses — the user tapped "convert to bullet" and nothing happened.
  // Given the whole node, every target that would refuse is dropped up front.
  const tableJson = () => ({
    type: "table",
    content: [{
      type: "tableRow",
      content: [{ type: "tableCell", attrs: {}, content: [para("cell")] }],
    }],
  });
  const chartJson = () => ({ type: "chart", attrs: { kind: "flowchart" } });

  it("a blockquote containing a table offers nothing at all", () => {
    const quote = { type: "blockquote", attrs: { blockTitle: null, pinId: null }, content: [para("hi"), tableJson()] };
    expect(convertTargetsFor(quote)).toEqual([]);
  });

  it("a blockquote containing a chart offers nothing at all (C2's other half)", () => {
    const quote = { type: "blockquote", attrs: { blockTitle: null, pinId: null }, content: [para("hello"), chartJson()] };
    expect(convertTargetsFor(quote)).toEqual([]);
  });

  it("a recipeBlock whose structural slot is a table offers nothing at all", () => {
    const recipe = {
      type: "recipeBlock",
      attrs: { blockTitle: null, pinId: null },
      content: [para("given"), tableJson(), para("result")],
    };
    expect(convertTargetsFor(recipe)).toEqual([]);
  });

  it("a clean blockquote node offers exactly what its type name does", () => {
    const quote = { type: "blockquote", attrs: { blockTitle: null, pinId: null }, content: [para("hi")] };
    expect(convertTargetsFor(quote)).toEqual(convertTargetsFor("blockquote"));
  });

  it("a list with a nested table keeps the three marker targets and loses the flattening ones", () => {
    // setListMarkerDeep rewrites attrs in place, so bullet/ordered/task never
    // walk into the table and never lose it — refusing them too would remove
    // a conversion that works.
    const withTable = list("bullet", ["one"]);
    withTable.content[0].content.push(tableJson());
    expect(convertTargetsFor(withTable)).toEqual(["ordered", "task"]);
  });

  it("reads a list's current marker off the node when given one, without sourceAttrs", () => {
    expect(convertTargetsFor(list("ordered", ["a"]))).not.toContain("ordered");
    expect(convertTargetsFor(list("ordered", ["a"]))).toContain("bullet");
  });

  it("an empty blockquote drops only the paragraphs target", () => {
    // convertBlockNode refuses "paragraphs" on an empty flatten (replaceWith
    // an empty array is a delete); the other targets fall back to one empty
    // paragraph and are genuinely available.
    const quote = { type: "blockquote", attrs: { blockTitle: null, pinId: null } };
    const targets = convertTargetsFor(quote);
    expect(targets).not.toContain("paragraphs");
    expect(targets).toContain("bullet");
  });

  it("every target it offers for a node is one convertBlockNode actually performs", () => {
    // The point of the whole item: no offered row may silently no-op.
    const sources = [
      { type: "blockquote", attrs: { blockTitle: null, pinId: null }, content: [para("hi"), tableJson()] },
      { type: "blockquote", attrs: { blockTitle: null, pinId: null }, content: [para("hello"), chartJson()] },
      { type: "blockquote", attrs: { blockTitle: null, pinId: null }, content: [para("plain")] },
      list("bullet", ["one", "two"]),
      (() => { const l = list("bullet", ["one"]); l.content[0].content.push(tableJson()); return l; })(),
    ];
    for (const src of sources) {
      for (const target of convertTargetsFor(src)) {
        expect(convertBlockNode(src, target)).not.toBeNull();
      }
    }
  });
});

describe("convertTargetsFor — a live ProseMirror Node answers the same as its toJSON()", () => {
  // Node mode is what the block-actions sheet will pass once the frozen
  // TipTapEditor.svelte call site is rewired, and what it has in hand there
  // is a LIVE node (`doc.nodeAt`), not JSON. A live Node passes
  // `typeof source === "object"` but carries a NodeType object in `.type`
  // and a Fragment in `.content` — neither shape this module walks — so
  // before `asNodeJson` it fell past every branch and returned `[]`: a sheet
  // with no convert rows at all, and nothing logged. Every case below runs
  // both shapes side by side; identical output IS the contract.
  let ctx;
  beforeEach(() => { ctx = makeEditor(); });
  afterEach(() => ctx.cleanup());

  const dateSeparatorJson = () => ({ type: "dateSeparator", attrs: { date: "2026-08-25", pageId: "p1" } });

  const cases = [
    ["a clean blockquote", () => ({ type: "blockquote", content: [para("hi"), para("there")] })],
    ["a bullet list", () => list("bullet", ["one", "two"])],
    ["an ordered list (current marker must drop out)", () => list("ordered", ["one"])],
    ["a qaBlock", () => ({ type: "qaBlock", content: [{ type: "qaPair", content: [para("q"), para("a")] }] })],
    ["a blockquote holding a divider (carried)", () => ({
      type: "blockquote",
      content: [para("hi"), { type: "horizontalRule" }],
    })],
    ["a blockquote holding a dateSeparator (refused)", () => ({
      type: "blockquote",
      content: [para("hi"), dateSeparatorJson()],
    })],
    ["an empty blockquote", () => ({ type: "blockquote", content: [{ type: "paragraph" }] })],
  ];

  for (const [label, build] of cases) {
    it(`agrees on ${label}`, () => {
      const node = ctx.editor.schema.nodeFromJSON(build());
      const fromLiveNode = convertTargetsFor(node);
      const fromJson = convertTargetsFor(node.toJSON());
      expect(fromLiveNode).toEqual(fromJson);
    });
  }

  it("a live node still produces the real target list, not an empty one", () => {
    // The bug's signature was an EMPTY array, so "both agree" alone could be
    // satisfied by both being broken. Pin the actual answer for two shapes:
    // one that converts (six targets, its own shape excluded) and one that
    // refuses outright.
    const quote = ctx.editor.schema.nodeFromJSON({ type: "blockquote", content: [para("hi")] });
    expect(convertTargetsFor(quote)).toEqual(["bullet", "ordered", "task", "qaBlock", "codeBlock", "paragraphs"]);

    const withSeparator = ctx.editor.schema.nodeFromJSON({
      type: "blockquote",
      content: [para("hi"), dateSeparatorJson()],
    });
    // Empty is the RIGHT answer here and not the bug's empty: a
    // dateSeparator carries a date no paragraph can hold, so every target
    // refuses (see ATOM_TEXT) and offering a row that no-ops would be worse.
    expect(convertTargetsFor(withSeparator)).toEqual([]);
  });

  it("a non-node object with no toJSON still returns [] rather than throwing", () => {
    // Facts-only mode passes a string; anything else object-shaped that is
    // neither JSON nor a Node (a DOM element handed in by mistake, say) has
    // no type name to read, so [] — "offer nothing" — is the safe answer,
    // matching the pre-existing behaviour for an unrecognised type.
    expect(convertTargetsFor({ nodeName: "DIV" })).toEqual([]);
    expect(convertTargetsFor(null)).toEqual([]);
  });
});

describe("convertBlockNode — refused conversions", () => {
  it("returns null for a type not in CONVERTIBLE_TYPES", () => {
    expect(convertBlockNode({ type: "table", content: [] }, "paragraphs")).toBeNull();
    expect(convertBlockNode({ type: "chart" }, "paragraphs")).toBeNull();
    expect(convertBlockNode({ type: "attachment" }, "paragraphs")).toBeNull();
  });

  it("returns null converting a list to its own current marker", () => {
    expect(convertBlockNode(list("bullet", ["a"]), "bullet")).toBeNull();
  });

  it("returns null for a target not in CONVERT_TARGETS", () => {
    expect(convertBlockNode(list("bullet", ["a"]), "recipeBlock")).toBeNull();
  });
});

describe("convertBlockNode — lossless: list marker round-trip", () => {
  it("bullet -> ordered -> bullet reproduces the original JSON", () => {
    const original = list("bullet", ["a", "b"]);
    const toOrdered = convertBlockNode(original, "ordered");
    expect(toOrdered.content.every((li) => li.attrs.marker === "ordered")).toBe(true);
    const backToBullet = convertBlockNode(toOrdered, "bullet");
    expect(backToBullet).toEqual(original);
  });

  it("sets marker on EVERY item, not just one", () => {
    const original = list("bullet", ["a", "b", "c"]);
    const converted = convertBlockNode(original, "task");
    expect(converted.content.map((li) => li.attrs.marker)).toEqual(["task", "task", "task"]);
  });

  it("keeps nesting: a nested sublist's items also get the new marker", () => {
    const original = list("bullet", ["a"]);
    original.content[0].content.push(list("bullet", ["nested"]));
    const converted = convertBlockNode(original, "ordered");
    const outerMarker = converted.content[0].attrs.marker;
    const nestedList = converted.content[0].content.find((c) => c.type === "list");
    expect(outerMarker).toBe("ordered");
    expect(nestedList.content[0].attrs.marker).toBe("ordered");
  });

  it("keeps checked when converting INTO task; drops it otherwise", () => {
    const withChecked = list("task", ["done"]);
    withChecked.content[0].attrs.checked = true;
    const toOrdered = convertBlockNode(withChecked, "ordered");
    expect(toOrdered.content[0].attrs.checked).toBe(false);
    const backToTask = convertBlockNode(toOrdered, "task");
    // checked was already dropped by the ordered hop — this asserts the
    // RULE (task target reads whatever checked is currently on the item),
    // not that checked survived a hop that the matrix never promises to
    // preserve it through.
    expect(backToTask.content[0].attrs.checked).toBe(false);
  });
});

describe("convertBlockNode — lossless: list <-> blockquote round-trip", () => {
  it("list -> blockquote -> list reproduces the original JSON (flat, no nesting)", () => {
    const original = list("bullet", ["first", "second"]);
    const asQuote = convertBlockNode(original, "blockquote");
    expect(asQuote.type).toBe("blockquote");
    expect(asQuote.content).toEqual([para("first"), para("second")]);
    const backToList = convertBlockNode(asQuote, "bullet");
    expect(backToList).toEqual(original);
  });
});

describe("convertBlockNode — list/blockquote -> paragraphs", () => {
  it("N items -> N paragraphs", () => {
    const result = convertBlockNode(list("bullet", ["a", "b", "c"]), "paragraphs");
    expect(result).toEqual([para("a"), para("b"), para("c")]);
  });

  it("blockquote -> paragraphs: N children -> N paragraphs", () => {
    const quote = { type: "blockquote", attrs: { blockTitle: null, pinId: null }, content: [para("x"), para("y")] };
    expect(convertBlockNode(quote, "paragraphs")).toEqual([para("x"), para("y")]);
  });
});

describe("convertBlockNode — lossy: qaBlock -> list/blockquote/paragraphs", () => {
  const qa = {
    type: "qaBlock",
    attrs: { blockTitle: null, pinId: null },
    content: [
      { type: "qaPair", content: [para("what happened"), para("a delay")] },
      { type: "qaPair", content: [para("why"), para("")] },
    ],
  };

  it("prefixes Q/A text and preserves all original text", () => {
    const result = convertBlockNode(qa, "paragraphs");
    // Node-level, not just concatenated text: the label is its OWN leading
    // text node (F7 — merging it into the first run made it inherit that
    // run's marks), and the user's run follows unchanged. `allText` alone
    // cannot tell those two structures apart, which is exactly the bug F7
    // fixed, so assert the nodes and keep the text check alongside.
    expect(result[0].content).toEqual([{ type: "text", text: "Q: " }, { type: "text", text: "what happened" }]);
    expect(result[1].content).toEqual([{ type: "text", text: "A: " }, { type: "text", text: "a delay" }]);
    expect(allText(result[0])).toBe("Q: what happened");
    expect(allText(result[1])).toBe("A: a delay");
    expect(allText(result)).toContain("what happened");
    expect(allText(result)).toContain("a delay");
    expect(allText(result)).toContain("why");
  });

  it("skips the prefix on an empty paragraph", () => {
    const result = convertBlockNode(qa, "paragraphs");
    // The second pair's A is an empty paragraph (para("") has no content) —
    // it must stay content-less, not become a lone "A: " with nothing after
    // it (CLAUDE.md: a plain-text pin note vanishing silently was hidden by
    // an under-specified empty case just like this one).
    const secondA = result[3];
    expect(secondA.content).toBeUndefined();
  });

  it("converts to list and to blockquote too, preserving all text", () => {
    const asList = convertBlockNode(qa, "bullet");
    expect(asList.type).toBe("list");
    expect(allText(asList)).toContain("what happened");
    const asQuote = convertBlockNode(qa, "blockquote");
    expect(asQuote.type).toBe("blockquote");
    expect(allText(asQuote)).toContain("a delay");
  });
});

describe("convertBlockNode — lossy: recipeBlock/decisionBlock -> list/blockquote/paragraphs", () => {
  const recipe = {
    type: "recipeBlock",
    attrs: { blockTitle: null, pinId: null },
    content: [para("raw input"), list("bullet", ["step one", "step two"]), para("clean output")],
  };
  const decision = {
    type: "decisionBlock",
    attrs: { blockTitle: null, pinId: null },
    content: [list("bullet", ["option A", "option B"]), para("option A"), para("it was cheaper")],
  };

  it("recipeBlock: labels given/do/result, structural slot flattens to paragraphs", () => {
    const result = convertBlockNode(recipe, "paragraphs");
    // Node-level: a labelled paragraph is [label node, user's run] and an
    // unlabelled one (the structural slot's second item) is the user's run
    // alone — the label must not be merged into the run, and must not sprout
    // on a line that never had one.
    expect(result[0].content).toEqual([{ type: "text", text: "given: " }, { type: "text", text: "raw input" }]);
    expect(result[1].content).toEqual([{ type: "text", text: "do: " }, { type: "text", text: "step one" }]);
    expect(result[2].content).toEqual([{ type: "text", text: "step two" }]);
    expect(result[3].content).toEqual([{ type: "text", text: "result: " }, { type: "text", text: "clean output" }]);
    expect(allText(result[0])).toBe("given: raw input");
    expect(allText(result[1])).toBe("do: step one");
    expect(allText(result[2])).toBe("step two");
    expect(allText(result[3])).toBe("result: clean output");
  });

  it("decisionBlock: labels considered/chose/because, structural slot (index 0) flattens to paragraphs", () => {
    const result = convertBlockNode(decision, "paragraphs");
    // Node-level, same reason as the recipe case above.
    expect(result[0].content).toEqual([{ type: "text", text: "considered: " }, { type: "text", text: "option A" }]);
    expect(result[1].content).toEqual([{ type: "text", text: "option B" }]);
    expect(result[2].content).toEqual([{ type: "text", text: "chose: " }, { type: "text", text: "option A" }]);
    expect(result[3].content).toEqual([{ type: "text", text: "because: " }, { type: "text", text: "it was cheaper" }]);
    expect(allText(result[0])).toBe("considered: option A");
    expect(allText(result[1])).toBe("option B");
    expect(allText(result[2])).toBe("chose: option A");
    expect(allText(result[3])).toBe("because: it was cheaper");
  });

  it("preserves all text converting recipeBlock/decisionBlock to blockquote and list too", () => {
    for (const target of ["blockquote", "bullet"]) {
      expect(allText(convertBlockNode(recipe, target))).toContain("clean output");
      expect(allText(convertBlockNode(decision, target))).toContain("it was cheaper");
    }
  });
});

describe("convertBlockNode — lossy: paragraphs/list/blockquote -> qaBlock", () => {
  it("pairs textblocks 2-by-2", () => {
    const original = list("bullet", ["q1", "a1", "q2", "a2"]);
    const result = convertBlockNode(original, "qaBlock");
    expect(result.type).toBe("qaBlock");
    expect(result.content).toHaveLength(2);
    expect(result.content[0].content).toEqual([para("q1"), para("a1")]);
    expect(result.content[1].content).toEqual([para("q2"), para("a2")]);
  });

  it("synthesizes an empty A on an odd count", () => {
    const original = list("bullet", ["q1", "a1", "q2"]);
    const result = convertBlockNode(original, "qaBlock");
    expect(result.content).toHaveLength(2);
    expect(result.content[1].content[0]).toEqual(para("q2"));
    expect(result.content[1].content[1]).toEqual(para());
  });

  it("blockquote -> qaBlock preserves all text", () => {
    const quote = { type: "blockquote", attrs: { blockTitle: null, pinId: null }, content: [para("x"), para("y")] };
    const result = convertBlockNode(quote, "qaBlock");
    expect(allText(result)).toBe("xy");
  });
});

describe("convertBlockNode — any convertible -> codeBlock", () => {
  it("concatenates textblocks with \\n, marks stripped, default language", () => {
    const original = list("bullet", ["line one", "line two"]);
    const result = convertBlockNode(original, "codeBlock");
    expect(result.type).toBe("codeBlock");
    expect(result.attrs.language).toBeNull();
    expect(result.content).toEqual([{ type: "text", text: "line one\nline two" }]);
  });

  it("does not add Q:/A: or slot labels — codeBlock is not a label surface", () => {
    const qa = {
      type: "qaBlock",
      attrs: { blockTitle: null, pinId: null },
      content: [{ type: "qaPair", content: [para("what"), para("this")] }],
    };
    const result = convertBlockNode(qa, "codeBlock");
    expect(result.content[0].text).toBe("what\nthis");
  });

  it("round-trips codeBlock -> paragraphs on its own multi-line text", () => {
    const code = { type: "codeBlock", attrs: { language: "js", blockTitle: null, pinId: null }, content: [{ type: "text", text: "a\nb" }] };
    const result = convertBlockNode(code, "paragraphs");
    expect(result).toEqual([para("a"), para("b")]);
  });
});

describe("convertBlockNode — attrs handling", () => {
  it("carries blockTitle through the conversion", () => {
    const original = list("bullet", ["a"], { blockTitle: "my title" });
    const converted = convertBlockNode(original, "blockquote");
    expect(converted.attrs.blockTitle).toBe("my title");
  });

  it("drops pinId on the converted node — the pin pointed at the old shape", () => {
    const original = list("bullet", ["a"], { pinId: "pin-123" });
    const converted = convertBlockNode(original, "blockquote");
    expect(converted.attrs.pinId).toBeNull();
  });

  it("keeps a pinId that sits on a paragraph INSIDE the block (F6)", () => {
    // The board's own pinId is dropped (above) — it described the old shape.
    // A pin on a paragraph nested inside it is a different pointer: that
    // paragraph survives the conversion with its text intact, so the pin's
    // cached content still matches and the pointer stays honest. The
    // listItem marker path already preserved it; the flatten path silently
    // dropped it (F6's undocumented asymmetry).
    const quote = {
      type: "blockquote",
      attrs: { blockTitle: null, pinId: null },
      content: [
        { type: "paragraph", attrs: { pinId: "PIN-A" }, content: [text("pinned line")] },
        para("plain line"),
      ],
    };
    const paragraphs = convertBlockNode(quote, "paragraphs");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].attrs.pinId).toBe("PIN-A");
    expect(allText(paragraphs[0])).toBe("pinned line");
    // The unpinned sibling gains no attrs it didn't have.
    expect(paragraphs[1].attrs?.pinId).toBeUndefined();
  });

  it("keeps a nested paragraph's pinId through the list and blockquote targets too", () => {
    const quote = {
      type: "blockquote",
      attrs: { blockTitle: null, pinId: null },
      content: [{ type: "paragraph", attrs: { pinId: "PIN-B" }, content: [text("kept")] }],
    };
    expect(convertBlockNode(quote, "bullet").content[0].content[0].attrs.pinId).toBe("PIN-B");
    expect(convertBlockNode(quote, "task").content[0].content[0].attrs.pinId).toBe("PIN-B");
    // blockquote -> blockquote isn't offered, so use a list source for the
    // blockquote target.
    const pinnedList = list("bullet", ["kept"]);
    pinnedList.content[0].content[0] = { type: "paragraph", attrs: { pinId: "PIN-C" }, content: [text("kept")] };
    expect(convertBlockNode(pinnedList, "blockquote").content[0].attrs.pinId).toBe("PIN-C");
  });
});

describe("convertBlockNode — prefixParagraph's label is its own unmarked run (F7)", () => {
  // `{ ...first, text: label + first.text }` made the synthesised label
  // inherit the first run's marks, so a bold answer produced a bold "A: ".
  // The label is this module's own structural text, not the user's writing.
  const bold = (t) => ({ type: "text", text: t, marks: [{ type: "bold" }] });

  it("an answer whose first run is bold gets an unmarked 'A: ' and keeps the bold run intact", () => {
    const qa = {
      type: "qaBlock",
      attrs: { blockTitle: null, pinId: null },
      content: [{
        type: "qaPair",
        content: [
          { type: "paragraph", content: [text("plain question")] },
          { type: "paragraph", content: [bold("BOLD ANSWER")] },
        ],
      }],
    };
    const paragraphs = convertBlockNode(qa, "paragraphs");
    // [0] = "Q: plain question", [1] = "A: " + the bold run.
    const answer = paragraphs[1];
    expect(answer.content[0]).toEqual({ type: "text", text: "A: " });
    expect(answer.content[0].marks).toBeUndefined();
    expect(answer.content[1]).toEqual(bold("BOLD ANSWER"));
    expect(allText(answer)).toBe("A: BOLD ANSWER");
  });

  it("a recipe slot label is unmarked too, and the marked run that follows survives", () => {
    const recipe = {
      type: "recipeBlock",
      attrs: { blockTitle: null, pinId: null },
      content: [
        { type: "paragraph", content: [bold("inputs")] },
        list("ordered", ["step"]),
        para("out"),
      ],
    };
    const paragraphs = convertBlockNode(recipe, "paragraphs");
    expect(paragraphs[0].content[0]).toEqual({ type: "text", text: "given: " });
    expect(paragraphs[0].content[1]).toEqual(bold("inputs"));
  });
});

describe("convertBlockNode — every result is real schema-valid content (node.check())", () => {
  let ctx;
  beforeEach(() => { ctx = makeEditor(); });
  afterEach(() => ctx.cleanup());

  // `schema.nodeFromJSON` calls `type.create`, not `createChecked` — it
  // never validates content, so it would happily accept an invalid
  // `paragraph(tableRow(...))` (F1) without throwing. `.check()` on the
  // resulting real pm Node DOES validate content recursively and throws on
  // a mismatch — that's the assertion this suite needs to actually be able
  // to fail. Covers EVERY offered target for each fixture, including
  // "paragraphs" (previously skipped entirely).
  it("checks every offered-target conversion, including the paragraphs target", () => {
    const { schema } = ctx.editor;
    const recipeFixture = {
      type: "recipeBlock",
      attrs: { blockTitle: null, pinId: null },
      content: [para("given"), list("bullet", ["step"]), para("result")],
    };
    const decisionFixture = {
      type: "decisionBlock",
      attrs: { blockTitle: null, pinId: null },
      content: [list("bullet", ["option"]), para("chose"), para("because")],
    };
    const cases = [
      [list("bullet", ["a", "b"]), ["ordered", "task", "blockquote", "qaBlock", "codeBlock", "paragraphs"]],
      [
        { type: "blockquote", attrs: { blockTitle: null, pinId: null }, content: [para("x"), para("y")] },
        ["bullet", "ordered", "task", "qaBlock", "codeBlock", "paragraphs"],
      ],
      [
        { type: "qaBlock", attrs: { blockTitle: null, pinId: null }, content: [{ type: "qaPair", content: [para("q"), para("a")] }] },
        ["bullet", "ordered", "task", "blockquote", "codeBlock", "paragraphs"],
      ],
      [recipeFixture, ["bullet", "ordered", "task", "blockquote", "qaBlock", "codeBlock", "paragraphs"]],
      [decisionFixture, ["bullet", "ordered", "task", "blockquote", "qaBlock", "codeBlock", "paragraphs"]],
      [
        { type: "codeBlock", attrs: { language: "js", blockTitle: null, pinId: null }, content: [{ type: "text", text: "a\nb" }] },
        ["bullet", "ordered", "task", "blockquote", "qaBlock", "paragraphs"],
      ],
    ];
    for (const [source, targets] of cases) {
      for (const target of targets) {
        const json = convertBlockNode(source, target, schema);
        expect(json).not.toBeNull();
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          expect(() => schema.nodeFromJSON(item).check()).not.toThrow();
        }
      }
    }
  });
});

describe("convertBlockNode — F1 regression: refuses rather than fabricates invalid content", () => {
  // A table's content is `tableRow+` (tableRow's is `tableCell+`) — block-
  // shaped, not inline. Schema-legal nested inside a StarterKit blockquote
  // ("block+"), a recipeBlock's structural (do) slot, or a decisionBlock's
  // structural (considered) slot content: "block" — but the flattener has
  // no way to represent it as paragraph content. Before the fix, the
  // default branch wrapped it anyway, producing `paragraph(tableRow(...))`
  // — accepted by `nodeFromJSON`/`replaceWith`, rejected only by
  // `doc.check()` on the LIVE doc after the transaction already landed.
  const tableJson = () => ({
    type: "table",
    content: [{ type: "tableRow", content: [{ type: "tableCell", content: [para("cell")] }] }],
  });

  it("a blockquote containing a table refuses EVERY offered target", () => {
    const quote = {
      type: "blockquote",
      attrs: { blockTitle: null, pinId: null },
      content: [para("before"), tableJson(), para("after")],
    };
    for (const target of convertTargetsFor("blockquote")) {
      expect(convertBlockNode(quote, target)).toBeNull();
    }
  });

  it("a recipeBlock whose structural (do) slot IS a table also refuses", () => {
    const recipe = {
      type: "recipeBlock",
      attrs: { blockTitle: null, pinId: null },
      content: [para("given"), tableJson(), para("result")],
    };
    for (const target of convertTargetsFor("recipeBlock")) {
      expect(convertBlockNode(recipe, target)).toBeNull();
    }
  });

  it("a decisionBlock whose structural (considered) slot IS a table also refuses", () => {
    const decision = {
      type: "decisionBlock",
      attrs: { blockTitle: null, pinId: null },
      content: [tableJson(), para("chose"), para("because")],
    };
    for (const target of convertTargetsFor("decisionBlock")) {
      expect(convertBlockNode(decision, target)).toBeNull();
    }
  });
});

describe("convertBlockNode — F2 regression: a convert must never become a delete", () => {
  it("a blockquote holding only a chart refuses the paragraphs target instead of returning []", () => {
    // `tr.replaceWith(pos, pos + size, [])` does not throw — it deletes the
    // block outright. flattenToParagraphs legitimately produces zero
    // paragraphs here (a chart is an atom with no text to extract), and the
    // "paragraphs" target is the one builder that would hand that empty
    // array straight to replaceWith. Refusing beats silently deleting the
    // user's content.
    const quote = {
      type: "blockquote",
      attrs: { blockTitle: null, pinId: null },
      content: [{ type: "chart", attrs: {} }],
    };
    expect(convertBlockNode(quote, "paragraphs")).toBeNull();
  });
});

describe("convertBlockNode — C2 regression: a nested block-level ATOM refuses too", () => {
  // The F2 fix above guarded exactly one of the six exits. `hasBlockShapedChild`
  // inspects a `content` ARRAY, so it catches a nested table — but a
  // block-level atom (chart: chart.js `group: "block", atom: true`; dayMarker:
  // day-marker.js the same) carries no `content` array at all, fell through
  // both walks' default branch, and hit `return []` — "contributes nothing",
  // i.e. silently deleted. No `null` propagated, so the conversion succeeded
  // and the diagram was gone. Both are schema-legal inside a StarterKit
  // blockquote and in a recipeBlock/decisionBlock structural slot. See
  // final-review.md C2.
  const chartJson = () => ({ type: "chart", attrs: { kind: "flowchart" } });
  const dayMarkerJson = () => ({ type: "dayMarker", attrs: { date: "2026-08-25", focus: "x" } });

  it("a blockquote of paragraph + chart refuses EVERY target rather than dropping the chart", () => {
    const quote = {
      type: "blockquote",
      attrs: { blockTitle: null, pinId: null },
      content: [para("hello"), chartJson()],
    };
    const targets = convertTargetsFor("blockquote");
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(convertBlockNode(quote, target)).toBeNull();
    }
  });

  it("a blockquote holding only a chart refuses the list and codeBlock targets too, not just paragraphs", () => {
    // These are the two exits the F2 test left open: "bullet" produced
    // `list[listItem[paragraph()]]` and "codeBlock" produced an empty
    // codeBlock — both valid-looking nodes with the chart deleted.
    const quote = {
      type: "blockquote",
      attrs: { blockTitle: null, pinId: null },
      content: [chartJson()],
    };
    expect(convertBlockNode(quote, "bullet")).toBeNull();
    expect(convertBlockNode(quote, "codeBlock")).toBeNull();
  });

  it("a dayMarker in a decisionBlock's structural slot refuses every target", () => {
    const decision = {
      type: "decisionBlock",
      attrs: { blockTitle: null, pinId: null },
      content: [dayMarkerJson(), para("chose"), para("because")],
    };
    for (const target of convertTargetsFor("decisionBlock")) {
      expect(convertBlockNode(decision, target)).toBeNull();
    }
  });

  it("bullet <-> ordered <-> task is unaffected — setListMarkerDeep preserves nested atoms", () => {
    // The marker path rewrites attrs in place instead of flattening, so it
    // never walks into (and never loses) a nested atom. Asserting it stays
    // convertible guards against over-broad refusal from the fix above.
    const withChart = list("bullet", ["one"]);
    withChart.content[0].content.push(chartJson());
    const converted = convertBlockNode(withChart, "ordered");
    expect(converted).not.toBeNull();
    expect(JSON.stringify(converted)).toContain('"chart"');
  });
});

describe("convertBlockNode — where the atom line is drawn: carry a divider, refuse a chart", () => {
  // C2's refusal was written against "a block-level atom has no content
  // array", which also caught `horizontalRule` — so a blockquote with a
  // `/divider` in it offered NOTHING, a regression on a far commoner block
  // than one holding a chart. The line is not "has content" but "does a text
  // form lose anything": a rule carries no data, `---` renders it whole (and
  // is what export/markdown.js already writes for one), so it is carried; a
  // chart / dayMarker / dateSeparator each carry data a paragraph cannot
  // hold, so they still refuse. See ATOM_TEXT in block-convert.js.
  const rule = () => ({ type: "horizontalRule" });
  const chartJson = () => ({ type: "chart", attrs: { kind: "flowchart" } });
  const quoteWithRule = () => ({
    type: "blockquote",
    attrs: { blockTitle: null, pinId: null },
    content: [para("before"), rule(), para("after")],
  });

  it("a blockquote holding a divider offers every target its type name does", () => {
    expect(convertTargetsFor(quoteWithRule())).toEqual(convertTargetsFor("blockquote"));
  });

  it("converts on all seven targets, keeping the rule as ---", () => {
    for (const target of CONVERT_TARGETS) {
      const converted = convertBlockNode(quoteWithRule(), target);
      if (target === "blockquote") {
        // Never offered: the source already IS a blockquote.
        expect(converted).toBeNull();
        continue;
      }
      expect(converted).not.toBeNull();
      const flat = allText(converted);
      expect(flat).toContain("before");
      expect(flat).toContain("---");
      expect(flat).toContain("after");
    }
  });

  it("the carried rule is its own paragraph, not welded onto a neighbour", () => {
    const paragraphs = convertBlockNode(quoteWithRule(), "paragraphs");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "---" }] });
  });

  it("the codeBlock target carries it as its own line", () => {
    const code = convertBlockNode(quoteWithRule(), "codeBlock");
    expect(code.content[0].text).toBe("before\n---\nafter");
  });

  it("a blockquote holding ONLY a divider is no longer empty, so paragraphs is offered", () => {
    const quote = { type: "blockquote", attrs: { blockTitle: null, pinId: null }, content: [rule()] };
    expect(convertTargetsFor(quote)).toContain("paragraphs");
    expect(convertBlockNode(quote, "paragraphs")).toEqual([{ type: "paragraph", content: [{ type: "text", text: "---" }] }]);
  });

  it("a rule nested deeper (in a list item, in a slot block) is carried too", () => {
    const withRule = list("bullet", ["one"]);
    withRule.content[0].content.push(rule());
    expect(allText(convertBlockNode(withRule, "blockquote"))).toBe("one---");

    const recipe = {
      type: "recipeBlock",
      attrs: { blockTitle: null, pinId: null },
      content: [para("given"), rule(), para("result")],
    };
    // The rule IS the "do" slot here, so it takes that slot's label — the
    // carried paragraph behaves like any other flattened one.
    expect(allText(convertBlockNode(recipe, "paragraphs"))).toBe("given: givendo: ---result: result");
  });

  it("a chart in the same position still refuses every target", () => {
    // The other side of the line, asserted next to the carry case so the two
    // cannot drift apart: widening the carry set to "any atom" would turn
    // this green and silently delete a diagram.
    const quote = {
      type: "blockquote",
      attrs: { blockTitle: null, pinId: null },
      content: [para("before"), chartJson(), para("after")],
    };
    expect(convertTargetsFor(quote)).toEqual([]);
    for (const target of CONVERT_TARGETS) {
      expect(convertBlockNode(quote, target)).toBeNull();
    }
  });

  it("a divider AND a chart together still refuse — one carryable atom does not rescue the block", () => {
    const quote = {
      type: "blockquote",
      attrs: { blockTitle: null, pinId: null },
      content: [para("before"), rule(), chartJson()],
    };
    expect(convertTargetsFor(quote)).toEqual([]);
  });

  it("every carried result is schema-valid content", () => {
    const ctx = makeEditor();
    try {
      const { schema } = ctx.editor;
      for (const target of convertTargetsFor(quoteWithRule())) {
        const json = convertBlockNode(quoteWithRule(), target, schema);
        for (const item of Array.isArray(json) ? json : [json]) {
          expect(() => schema.nodeFromJSON(item).check()).not.toThrow();
        }
      }
    } finally {
      ctx.cleanup();
    }
  });
});

describe("convertBlockNode — F4: hardBreak becomes a real newline in the codeBlock target", () => {
  it("does not weld the two sides of a hardBreak together", () => {
    const original = list("bullet", ["placeholder"]);
    original.content[0].content[0] = {
      type: "paragraph",
      content: [text("a"), { type: "hardBreak" }, text("b")],
    };
    const result = convertBlockNode(original, "codeBlock");
    expect(result.content[0].text).toBe("a\nb");
  });
});
