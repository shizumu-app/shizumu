import { describe, it, expect } from "vitest";

// Inline copy of the helper from SharedObjectsPanel.svelte's saveAndCloseModal.
// Keep in lockstep with the source.
function spliceNodeByPinId(doc, pinId, newNode) {
  function walk(node) {
    if (node?.attrs?.pinId === pinId) return newNode;
    if (Array.isArray(node?.content)) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  }
  return walk(doc);
}

describe("spliceNodeByPinId", () => {
  it("replaces the matched node and preserves siblings", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "list", attrs: { pinId: "P1" }, content: [] },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    };
    const newNode = { type: "list", attrs: { pinId: "P1", blockTitle: "edited" }, content: [{ type: "listItem", content: [{ type: "paragraph" }] }] };
    const out = spliceNodeByPinId(doc, "P1", newNode);
    expect(out.content[0]).toEqual(doc.content[0]);
    expect(out.content[1]).toEqual(newNode);
    expect(out.content[2]).toEqual(doc.content[2]);
  });

  it("is a no-op when pinId is not found", () => {
    const doc = { type: "doc", content: [{ type: "paragraph" }] };
    const out = spliceNodeByPinId(doc, "missing", { type: "list" });
    expect(out).toEqual(doc);
  });

  it("descends into nested content", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "blockquote",
        content: [
          { type: "list", attrs: { pinId: "NESTED" }, content: [] },
        ],
      }],
    };
    const newNode = { type: "list", attrs: { pinId: "NESTED", blockTitle: "fresh" }, content: [] };
    const out = spliceNodeByPinId(doc, "NESTED", newNode);
    expect(out.content[0].content[0]).toEqual(newNode);
  });
});
