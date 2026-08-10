import { describe, it, expect } from "vitest";
import { buildCarryForwardNodes, pinToNodes } from "../pin-carry-forward.js";

describe("buildCarryForwardNodes", () => {
  it("carries the title forward for a plain paragraph (note) pin, and parses its content instead of inserting raw JSON", () => {
    const notePin = {
      id: "pin-1",
      object_type: "note",
      title: "the real point",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "the actual pinned sentence." }] }],
      }),
    };

    const nodes = buildCarryForwardNodes([notePin]);

    // Title survives as its own labeled line, not silently dropped.
    expect(nodes[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "the real point", marks: [{ type: "bold" }] }],
    });
    // Content is the real parsed node, not the raw JSON string as literal text.
    expect(nodes[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "the actual pinned sentence." }],
    });
    expect(nodes).toHaveLength(2);
  });

  it("omits the title line when a note pin has no title", () => {
    const notePin = {
      id: "pin-2",
      object_type: "note",
      title: "",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "untitled note." }] }],
      }),
    };

    const nodes = buildCarryForwardNodes([notePin]);
    expect(nodes).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "untitled note." }] },
    ]);
  });

  it("still stamps blockTitle onto board-type pins (unchanged behavior)", () => {
    const boardPin = {
      id: "pin-3",
      object_type: "board",
      title: "quote worth keeping",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "a quote" }] }] }],
      }),
    };

    const nodes = buildCarryForwardNodes([boardPin]);
    expect(nodes).toEqual([
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "a quote" }] }],
        attrs: { blockTitle: "quote worth keeping" },
      },
    ]);
  });

  // This used to assert `[]` — that a note whose content isn't JSON is
  // dropped. That codified a bug: TipTapEditor stores a note's content as
  // PLAIN TEXT on one creation path (`pinContent = blockText`) and as a
  // JSON doc on another. Treating "doesn't parse" as "throw the pin away"
  // meant every plain-text note pin vanished from a freshly-trailed page,
  // title and all.
  it("treats unparseable content as the plain text it is, keeping the pin", () => {
    const textPin = { id: "pin-4", object_type: "note", title: "t", content: "not json" };
    expect(buildCarryForwardNodes([textPin])).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "t", marks: [{ type: "bold" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "not json" }] },
    ]);
  });

  it("drops a pin with no usable content at all", () => {
    expect(buildCarryForwardNodes([{ id: "p", object_type: "note", title: "t", content: "   " }])).toEqual([]);
    expect(buildCarryForwardNodes([{ id: "p", object_type: "note", title: "t", content: null }])).toEqual([]);
  });
});

// The single conversion both the carry-forward sweep and the panel's
// "inject here" button go through. They used to have separate
// implementations that each broke the case the other handled.
describe("pinToNodes", () => {
  const jsonDoc = (text) => JSON.stringify({
    type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("keeps the title of a plain-text note", () => {
    const nodes = pinToNodes({ object_type: "note", title: "the frame clicked", content: "a line I wrote" });
    expect(nodes[0].content[0].text).toBe("the frame clicked");
    expect(nodes[1].content[0].text).toBe("a line I wrote");
  });

  it("keeps the title of a JSON note and does not insert raw JSON as text", () => {
    const nodes = pinToNodes({ object_type: "note", title: "second thought", content: jsonDoc("a line I wrote") });
    expect(nodes[0].content[0].text).toBe("second thought");
    expect(nodes[1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "a line I wrote" }] });
    // The failure this guards: the whole doc JSON rendered as visible text.
    expect(JSON.stringify(nodes)).not.toContain('\\"type\\":\\"doc\\"');
  });

  it("stamps blockTitle when the pin has a board node to carry it", () => {
    const nodes = pinToNodes({
      object_type: "board", title: "quote worth keeping",
      content: JSON.stringify({ type: "doc", content: [{ type: "blockquote", content: [] }] }),
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].attrs.blockTitle).toBe("quote worth keeping");
  });

  it("falls back to a label line when the content has no board node to hold a title", () => {
    // A pinned list or heading is not a board type, so there is no
    // blockTitle slot — the title used to be dropped on the floor here.
    const nodes = pinToNodes({
      object_type: "note", title: "three things",
      content: JSON.stringify({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [] }] }),
    });
    expect(nodes[0].content[0].text).toBe("three things");
    expect(nodes[1].type).toBe("heading");
  });

  it("never mutates the caller's node objects", () => {
    const board = { type: "blockquote", content: [], attrs: { blockTitle: null } };
    const pin = { object_type: "board", title: "t", content: JSON.stringify({ type: "doc", content: [board] }) };
    const nodes = pinToNodes(pin);
    expect(nodes[0].attrs.blockTitle).toBe("t");
    expect(board.attrs.blockTitle).toBe(null);
  });

  it("returns nothing for an empty or absent pin", () => {
    expect(pinToNodes(null)).toEqual([]);
    expect(pinToNodes({ object_type: "note", content: "" })).toEqual([]);
  });
});
