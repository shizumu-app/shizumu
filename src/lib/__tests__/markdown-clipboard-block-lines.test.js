// A copied selection is not a page. The markdown it puts on the clipboard
// carries the writing, and of the export's `<!-- shizumu block … -->` lines
// only what gives a block its meaning: a decision's kind, state and date.
// Without that, cutting a superseded decision and pasting it (the ordinary
// way to move one, to another page too) brought it back as standing, with
// no date (review #4). Never the id or the pin: a paste is a new block,
// and a pin bound to the copy would follow it instead of its source.
import { describe, it, expect } from "vitest";
import { serializeSelection, parseAndInsert } from "../markdown-clipboard.js";
import { serializePage } from "../export/markdown.js";

const p = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

function fakeEditor(nodes) {
  return { state: { selection: { content: () => ({ content: { toJSON: () => nodes } }) } } };
}

function pasteTarget() {
  const target = { inserted: null };
  target.chain = () => ({
    focus: () => ({
      insertContent: (content) => {
        target.inserted = content;
        return { run: () => true };
      },
    }),
  });
  return target;
}

const SUPERSEDED = {
  type: "decisionBlock",
  attrs: { blockId: "abc000000001", blockState: "superseded", blockStateAt: "2026-10-30", pinId: "pin-1" },
  content: [p("a"), p("b"), p("c")],
};

describe("serializeSelection", () => {
  it("copies a decision with its kind, state and date, and no id or pin", () => {
    const md = serializeSelection(fakeEditor([SUPERSEDED]));
    expect(md).toContain("<!-- shizumu block kind=decision state=superseded at=2026-10-30 -->");
    expect(md).not.toContain("id=");
    expect(md).not.toContain("pin=");
    expect(md).toContain("### Considered");
  });

  it("gives prose, code and tables no line: they have no state to keep", () => {
    const md = serializeSelection(fakeEditor([
      p("words"),
      { type: "codeBlock", content: [{ type: "text", text: "ls" }] },
    ]));
    expect(md).toContain("```\nls\n```");
    expect(md).not.toContain("<!--");
  });
});

describe("cut and paste", () => {
  it("brings a superseded decision back superseded, with its date", () => {
    const target = pasteTarget();
    expect(parseAndInsert(target, serializeSelection(fakeEditor([SUPERSEDED])))).toBe(true);
    const decision = target.inserted.find((n) => n.type === "decisionBlock");
    expect(decision.attrs.blockState).toBe("superseded");
    expect(decision.attrs.blockStateAt).toBe("2026-10-30");
  });

  it("never re-binds a pin or reuses an id from pasted export text", () => {
    // An exported page file pasted in carries both; the paste is new blocks.
    const file = serializePage({
      page: {
        id: "page-1", date: "2026-10-30", page_number: 1, what_matters_now: null,
        created_at: "", updated_at: "",
        content_json: JSON.stringify({ type: "doc", content: [SUPERSEDED, { ...p("kept words"), attrs: { blockId: "abc000000002", pinId: "pin-2" } }] }),
      },
      pins: [{ id: "pin-1", source_page_id: "page-1" }, { id: "pin-2", source_page_id: "page-1" }],
    });
    const md = file.replace(/^---\n[\s\S]*?\n---\n/, "");
    expect(md).toContain("pin=pin-1");
    expect(md).toContain("id=abc000000001");
    const target = pasteTarget();
    parseAndInsert(target, md);
    const flat = JSON.stringify(target.inserted);
    expect(flat).not.toContain("pin-1");
    expect(flat).not.toContain("pin-2");
    expect(flat).not.toContain("abc00000000");
    expect(target.inserted.find((n) => n.type === "decisionBlock").attrs.blockState).toBe("superseded");
  });
});
