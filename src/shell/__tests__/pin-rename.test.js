// The cross-page half of a board rename (ShellApp.savePin → renameOnNode):
// the one node carrying the pinId gets its `blockTitle` slot rewritten,
// wherever it sits, and nothing else in the doc moves.
import { describe, it, expect } from "vitest";
import { withTitleAtPinId, withNodesAtPinId } from "../pin-rename.js";

const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

describe("withTitleAtPinId", () => {
  it("writes the title onto the node carrying the pinId and leaves its neighbours", () => {
    const doc = {
      type: "doc",
      content: [
        para("before"),
        { type: "table", attrs: { pinId: "a", blockTitle: "old" }, content: [] },
        { type: "table", attrs: { pinId: "b", blockTitle: "other" }, content: [] },
      ],
    };
    const out = withTitleAtPinId(doc, "a", "new");
    expect(out.content[1].attrs).toEqual({ pinId: "a", blockTitle: "new" });
    expect(out.content[0]).toEqual(para("before"));
    expect(out.content[2]).toEqual(doc.content[2]);
  });

  it("finds the node at any depth — a board pinned inside a list item", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "list",
          content: [
            {
              type: "listItem",
              content: [{ type: "blockquote", attrs: { pinId: "a", blockTitle: "" }, content: [para("q")] }],
            },
          ],
        },
      ],
    };
    const out = withTitleAtPinId(doc, "a", "deep");
    expect(out.content[0].content[0].content[0].attrs.blockTitle).toBe("deep");
  });

  it("writes null for an emptied field, with the key present", () => {
    // Present-and-null is what `extract_block_title` (commands.rs) reads as
    // "the slot was cleared; clear the row" — an absent key would be "no
    // opinion" and leave the row's old title standing.
    const doc = { type: "doc", content: [{ type: "table", attrs: { pinId: "a", blockTitle: "old" }, content: [] }] };
    const out = withTitleAtPinId(doc, "a", null);
    expect("blockTitle" in out.content[0].attrs).toBe(true);
    expect(out.content[0].attrs.blockTitle).toBeNull();
  });

  it("does not mutate the doc it was given", () => {
    const doc = { type: "doc", content: [{ type: "table", attrs: { pinId: "a", blockTitle: "old" }, content: [] }] };
    const frozen = JSON.stringify(doc);
    withTitleAtPinId(doc, "a", "new");
    expect(JSON.stringify(doc)).toBe(frozen);
  });

  it("returns the doc unchanged when no node carries the pinId", () => {
    // Not an empty result: the caller saves whatever comes back, and a
    // doc that lost its content on a missed pinId would be data loss on a
    // rename. Same shape in, same shape out.
    const doc = { type: "doc", content: [para("only prose")] };
    expect(withTitleAtPinId(doc, "missing", "new")).toEqual(doc);
  });
});

describe("withNodesAtPinId", () => {
  const doc = (over = []) => ({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      { type: "table", attrs: { pinId: "P1", blockTitle: "the shape" }, content: [] },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ...over,
    ],
  });

  it("puts the edited block where the pinned one was", () => {
    // The report: a table fixed on its pin screen, and the page it came
    // from still showing the old one.
    const next = { type: "table", attrs: { blockTitle: "the shape" }, content: [{ type: "tableRow" }] };
    const out = withNodesAtPinId(doc(), "P1", [next]);
    expect(out.content[1].content).toEqual([{ type: "tableRow" }]);
    expect(out.content[0]).toEqual(doc().content[0]);
    expect(out.content[2]).toEqual(doc().content[2]);
  });

  it("stamps the pin's id back onto the block that replaces it", () => {
    // A doc rebuilt by a serializer can come back without the attr, and a
    // page spliced with no pinId in it is a pin orphaned by its own save.
    const out = withNodesAtPinId(doc(), "P1", [{ type: "table", content: [] }]);
    expect(out.content[1].attrs.pinId).toBe("P1");
  });

  it("keeps every block the writer left behind, with the pin on the first", () => {
    // The desktop keeps the first node and drops the rest; a writer who
    // split a pinned block in two would lose the second half.
    const out = withNodesAtPinId(doc(), "P1", [
      { type: "table", content: [] },
      { type: "paragraph", content: [{ type: "text", text: "and a thought" }] },
    ]);
    expect(out.content.map((n) => n.type)).toEqual(["paragraph", "table", "paragraph", "paragraph"]);
    expect(out.content[1].attrs.pinId).toBe("P1");
    expect(out.content[2].attrs?.pinId).toBeUndefined();
    expect(out.content[2].content[0].text).toBe("and a thought");
  });

  it("reaches a pinned block nested inside another", () => {
    const nested = {
      type: "doc",
      content: [{ type: "blockquote", content: [{ type: "paragraph", attrs: { pinId: "P1" } }] }],
    };
    const out = withNodesAtPinId(nested, "P1", [
      { type: "paragraph", content: [{ type: "text", text: "kept" }] },
    ]);
    expect(out.content[0].content[0].content[0].text).toBe("kept");
    expect(out.content[0].content[0].attrs.pinId).toBe("P1");
  });

  it("leaves a doc that carries no such pin exactly as it was", () => {
    const before = doc();
    expect(withNodesAtPinId(before, "OTHER", [{ type: "paragraph" }])).toEqual(before);
  });

  it("leaves the doc alone for an empty replacement", () => {
    // Deleting a pinned block is `unpin`'s job, not a save's.
    const before = doc();
    expect(withNodesAtPinId(before, "P1", [])).toBe(before);
    expect(withNodesAtPinId(before, "P1", null)).toBe(before);
  });

  it("does not mutate what it was given", () => {
    const before = doc();
    const copy = JSON.parse(JSON.stringify(before));
    withNodesAtPinId(before, "P1", [{ type: "table", content: [] }]);
    expect(before).toEqual(copy);
  });
});
