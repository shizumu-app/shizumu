import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Blockquote } from "@tiptap/extension-blockquote";
import { UnifiedListExtensions } from "../extensions/unified-list.js";
import { PinId } from "../extensions/pin-id.js";
import { QABlock } from "../extensions/qa-block.js";
import { QAPair } from "../extensions/qa-pair.js";
import { findPinRun, withPinRun, pinContentNodes, replacePinRunInEditor } from "../pin-run.js";

const para = (text, pinId) => ({
  type: "paragraph",
  ...(pinId ? { attrs: { pinId } } : {}),
  content: [{ type: "text", text }],
});
const texts = (doc) => {
  const out = [];
  const walk = (n) => {
    if (n?.text) out.push(n.text);
    (n?.content || []).forEach(walk);
  };
  walk(doc);
  return out;
};

// A reading-notes page with one pin over three blocks in the middle.
const notes = () => ({
  type: "doc",
  content: [
    para("chapter three"),
    para("the ferry leaves at six", "P"),
    para("the harbour master is gruff", "P"),
    para("ask about the night boat", "P"),
    para("chapter four"),
  ],
});

describe("findPinRun", () => {
  it("finds every block of a pin made over several blocks, in order", () => {
    expect(findPinRun(notes(), "P").map((n) => n.content[0].text)).toEqual([
      "the ferry leaves at six",
      "the harbour master is gruff",
      "ask about the night boat",
    ]);
  });

  it("counts a stamped block once, not its stamped insides", () => {
    const doc = { type: "doc", content: [{ type: "blockquote", attrs: { pinId: "P" }, content: [para("inside", "P")] }] };
    expect(findPinRun(doc, "P")).toHaveLength(1);
  });

  it("does not take a mention of the pin for the pin", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "pinRef", attrs: { pinId: "P" } }] }] };
    expect(findPinRun(doc, "P")).toEqual([]);
  });
});

describe("withPinRun", () => {
  it("replaces the whole run once, where it began", () => {
    // The bug: only the first block was replaced, and the old second and
    // third stayed below the edit, still stamped.
    const out = withPinRun(notes(), "P", [
      para("the ferry leaves at seven"),
      para("the harbour master was kind"),
      para("ask about the night boat"),
    ]);
    expect(texts(out)).toEqual([
      "chapter three",
      "the ferry leaves at seven",
      "the harbour master was kind",
      "ask about the night boat",
      "chapter four",
    ]);
  });

  it("stamps every edited block, so the pin is what the pin screen showed", () => {
    const out = withPinRun(notes(), "P", [para("one"), para("two")]);
    expect(findPinRun(out, "P").map((n) => n.content[0].text)).toEqual(["one", "two"]);
  });

  it("removes a run's block that sits in another container", () => {
    const doc = {
      type: "doc",
      content: [para("a", "P"), { type: "blockquote", content: [para("b", "P")] }],
    };
    const out = withPinRun(doc, "P", [para("merged")]);
    expect(texts(out)).toEqual(["merged"]);
    expect(out.content[1].content).toEqual([]);
  });

  it("drops the empty paragraph an editor adds after a closing list, so the pin keeps its own blocks", () => {
    // The phone's pin editor ends a pin that closes on a list with an empty
    // paragraph; stamped and spliced, it became a fifth block of a
    // four-block pin and a blank line in the page (J12.6 on the A16,
    // 2026-10-29). Empty paragraphs BETWEEN blocks are the writer's and stay.
    const list = { type: "list", content: [{ type: "listItem", content: [para("a thread")] }] };
    const out = withPinRun(notes(), "P", [{ type: "paragraph" }, para("one"), { type: "paragraph" }, list, { type: "paragraph" }]);
    expect(findPinRun(out, "P").map((n) => n.type)).toEqual(["paragraph", "paragraph", "list"]);
    expect(out.content.filter((n) => n.type === "paragraph" && !n.content)).toHaveLength(1);
  });

  it("leaves the doc alone for an empty replacement", () => {
    // Removing a pinned block is unpin's job, not a save's.
    const before = notes();
    expect(withPinRun(before, "P", [])).toBe(before);
  });

  it("returns a doc holding no such pin unchanged, and mutates nothing", () => {
    const before = notes();
    const copy = JSON.parse(JSON.stringify(before));
    expect(withPinRun(before, "OTHER", [para("x")])).toBe(before);
    withPinRun(before, "P", [para("x")]);
    expect(before).toEqual(copy);
  });
});

describe("pinContentNodes", () => {
  it("reads both shapes a pin's content takes", () => {
    expect(pinContentNodes({ type: "doc", content: [para("a"), para("b")] })).toHaveLength(2);
    expect(pinContentNodes(para("a"))).toHaveLength(1);
    expect(pinContentNodes(null)).toEqual([]);
  });
});

describe("replacePinRunInEditor", () => {
  let editor;
  afterEach(() => editor?.destroy());
  const make = (content) => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, Text, Blockquote, ...UnifiedListExtensions, PinId, QABlock, QAPair],
      content,
    });
    return editor;
  };

  it("puts an edited three-block pin back once in the open page", () => {
    make(notes());
    const ok = replacePinRunInEditor(editor, "P", [
      para("the ferry leaves at seven"),
      para("the harbour master was kind"),
      para("ask about the night boat"),
    ]);
    expect(ok).toBe(true);
    const doc = editor.getJSON();
    expect(texts(doc)).toEqual([
      "chapter three",
      "the ferry leaves at seven",
      "the harbour master was kind",
      "ask about the night boat",
      "chapter four",
    ]);
    expect(findPinRun(doc, "P")).toHaveLength(3);
  });

  it("takes a doc of several blocks, the shape the desktop modal saves", () => {
    make(notes());
    expect(replacePinRunInEditor(editor, "P", { type: "doc", content: [para("one"), para("two")] })).toBe(true);
    expect(texts(editor.getJSON())).toEqual(["chapter three", "one", "two", "chapter four"]);
  });

  it("answers false for a pin the page does not hold", () => {
    make(notes());
    expect(replacePinRunInEditor(editor, "OTHER", [para("x")])).toBe(false);
    expect(texts(editor.getJSON())).toEqual(texts(notes()));
  });
});
