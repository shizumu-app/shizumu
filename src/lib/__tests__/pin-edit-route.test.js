import { describe, it, expect, vi } from "vitest";
import { pinModalFor, pinForModal, pinEditRoute, findPinNode, textIntoNode, writePinEdit } from "../pin-edit-route.js";

const node = { type: "paragraph", attrs: { pinId: "p1" }, content: [{ type: "text", text: "ibis" }] };
const docRow = { id: "p1", object_type: "note", content: JSON.stringify({ type: "doc", content: [node] }) };
const textRow = { id: "p1", object_type: "note", content: "written straight to the row" };

describe("pinModalFor", () => {
  it("opens the artifact modal for any pin whose node is in the editor", () => {
    // J2.14: the note modal writes only the row, and the page's next save
    // rewrote the row from the node.
    expect(pinModalFor(textRow, node)).toBe("artifact");
    expect(pinModalFor(docRow, node)).toBe("artifact");
  });
  it("falls back to the content's shape when the node is not here", () => {
    expect(pinModalFor(textRow, null)).toBe("note");
    expect(pinModalFor(docRow, undefined)).toBe("artifact");
  });
});

describe("pinForModal", () => {
  it("shows the live node, stamp included, when the editor holds it", () => {
    const shown = pinForModal(textRow, node);
    expect(JSON.parse(shown.content)).toEqual({ type: "doc", content: [node] });
    expect(shown.id).toBe("p1");
  });
  it("is the row itself otherwise", () => {
    expect(pinForModal(docRow, null)).toBe(docRow);
  });
  it("shows every block of a pin over several, not a doc inside a doc", () => {
    const run = { type: "doc", content: [node, node] };
    expect(JSON.parse(pinForModal(textRow, run).content)).toEqual(run);
  });
});

describe("pinEditRoute", () => {
  it("tries the editor, then the stored page, then the row", () => {
    expect(pinEditRoute({ liveHere: true, sourcePageId: "q" })).toEqual(["editor", "source", "row"]);
  });
  it("skips the editor when it does not hold the node", () => {
    // J2.8: the splice into an editor without the stamp returned false and
    // the edit went nowhere.
    expect(pinEditRoute({ liveHere: false, sourcePageId: "q" })).toEqual(["source", "row"]);
  });
  it("has only the row for a pin that points at no page", () => {
    expect(pinEditRoute({ liveHere: false, sourcePageId: null })).toEqual(["row"]);
  });
});

describe("findPinNode", () => {
  it("finds a stamped node at any depth", () => {
    const doc = { type: "doc", content: [{ type: "blockquote", content: [node] }] };
    expect(findPinNode(doc, "p1")).toBe(node);
  });
  it("is null for a page without the node", () => {
    // Null is the answer that sends the edit on to the row instead of
    // saving the page unchanged.
    expect(findPinNode({ type: "doc", content: [{ type: "paragraph" }] }, "p1")).toBeNull();
    expect(findPinNode(null, "p1")).toBeNull();
  });
});

describe("textIntoNode", () => {
  it("puts a note's text into its paragraph, stamp kept, lines as breaks", () => {
    expect(textIntoNode(node, "ibis\nmerlin")).toEqual({ type: "paragraph", attrs: { pinId: "p1" },
      content: [{ type: "text", text: "ibis" }, { type: "hardBreak" }, { type: "text", text: "merlin" }] });
  });
  it("refuses a node that does not hold plain text", () => {
    // Null makes writePinEdit stop rather than write the row, which the
    // page's next save would overwrite.
    expect(textIntoNode({ type: "table", attrs: { pinId: "p1" } }, "x")).toBeNull();
  });
});

describe("writePinEdit", () => {
  const stored = (doc) => ({
    calls: [],
    loadPage: vi.fn(async () => JSON.stringify(doc)),
    savePage: vi.fn(async () => {}),
    updateRow: vi.fn(async () => {}),
  });
  const edited = { ...node, content: [{ type: "text", text: "ibis merlin" }] };

  it("settles an open editor's pending save before it reads and writes the stored page", async () => {
    // Review of 9c: the editor open on the page, with a save pending, would
    // otherwise save its copy without the edited node a moment later.
    const order = [];
    const deps = stored({ type: "doc", content: [node] });
    deps.beforeSourceWrite = vi.fn(async () => { await Promise.resolve(); order.push("flush"); });
    deps.loadPage.mockImplementation(async () => { order.push("load"); return JSON.stringify({ type: "doc", content: [node] }); });
    const landed = await writePinEdit({ pin: { id: "p1", source_page_id: "q" }, liveNode: null,
      nodeFor: () => edited, rowContent: "", rowTitle: null, deps });
    expect(landed).toBe("source");
    expect(order).toEqual(["flush", "load"]);
    expect(deps.beforeSourceWrite).toHaveBeenCalledWith("q");
    expect(JSON.parse(deps.savePage.mock.calls[0][1]).content[0]).toEqual(edited);
  });

  it("does not write the row when the page holds the node but the edit cannot go into it", async () => {
    const deps = stored({ type: "doc", content: [node] });
    const landed = await writePinEdit({ pin: { id: "p1", source_page_id: "q" }, liveNode: null,
      nodeFor: () => null, rowContent: "x", rowTitle: null, deps });
    expect(landed).toBeNull();
    expect(deps.updateRow).not.toHaveBeenCalled();
  });

  it("writes the row when no page holds the node", async () => {
    const deps = stored({ type: "doc", content: [] });
    const landed = await writePinEdit({ pin: { id: "p1", source_page_id: "q" }, liveNode: null,
      nodeFor: () => edited, rowContent: "row text", rowTitle: "t", deps });
    expect(landed).toBe("row");
    expect(deps.updateRow).toHaveBeenCalledWith("p1", "row text", "t");
    expect(deps.savePage).not.toHaveBeenCalled();
  });
});
