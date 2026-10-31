import { describe, it, expect } from "vitest";
import { holdsPin, stampedPinIds } from "../pin-node.js";
import { findPinNode, splicePinNode } from "../pin-edit-route.js";

// An @-mention of a pin is a `pinRef` node that carries the pin's id in the
// same `pinId` attr as the pinned block. Treating it as the block rewrote the
// pin with the mention (desktop scenario mentions-backlinks.mjs, 2026-10-24).
const block = { type: "paragraph", attrs: { pinId: "P" }, content: [{ type: "text", text: "milk" }] };
const mention = { type: "pinRef", attrs: { pinId: "P", labelSnapshot: "groceries" } };
const doc = { type: "doc", content: [{ type: "paragraph", content: [mention] }, block] };

describe("holdsPin", () => {
  it("is the pinned block, by id", () => {
    expect(holdsPin(block)).toBe(true);
    expect(holdsPin(block, "P")).toBe(true);
    expect(holdsPin(block, "Q")).toBe(false);
  });

  it("is never a mention of the pin", () => {
    expect(holdsPin(mention)).toBe(false);
    expect(holdsPin(mention, "P")).toBe(false);
  });

  // ProseMirror nodes name their type on an object, not a string.
  it("reads a ProseMirror node's type name too", () => {
    expect(holdsPin({ type: { name: "pinRef" }, attrs: { pinId: "P" } })).toBe(false);
    expect(holdsPin({ type: { name: "paragraph" }, attrs: { pinId: "P" } })).toBe(true);
  });

  // An unpinned node has pinId null, which is not a pin.
  it("is not a node without a pin id", () => {
    expect(holdsPin({ type: "paragraph", attrs: { pinId: null } })).toBe(false);
  });
});

describe("pin edits skip a mention that comes first", () => {
  it("finds the block, not the mention above it", () => {
    expect(findPinNode(doc, "P")).toBe(block);
  });

  it("splices the block and leaves the mention as it was", () => {
    const edited = { ...block, content: [{ type: "text", text: "milk, eggs" }] };
    const out = splicePinNode(doc, "P", edited);
    expect(out.content[0].content[0]).toBe(mention);
    // A stamped copy of the edit, not the same object (pin-run.js stamps
    // every block it puts back).
    expect(out.content[1]).toEqual(edited);
  });
});

describe("stampedPinIds", () => {
  it("lists every pin stamped on a block or inside it, and no mention", () => {
    const list = {
      type: "list", attrs: { pinId: "outer" },
      content: [{ type: "listItem", content: [
        { type: "paragraph", attrs: { pinId: "inner" }, content: [{ type: "pinRef", attrs: { pinId: "mentioned" } }] },
      ] }],
    };
    expect(stampedPinIds(list).sort()).toEqual(["inner", "outer"]);
    expect(stampedPinIds({ type: "paragraph", content: [{ type: "text", text: "plain" }] })).toEqual([]);
  });
});
