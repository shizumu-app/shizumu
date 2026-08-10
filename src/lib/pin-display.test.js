import { describe, it, expect } from "vitest";
import { pinKind, pinFamily, kindToFamily } from "./pin-display.js";

function notePin() {
  return { object_type: "note", content: "hello world", title: "" };
}
function filePin() {
  return {
    object_type: "file",
    content: JSON.stringify({
      type: "doc",
      content: [{ type: "attachment", attrs: { filename: "a.pdf" } }],
    }),
  };
}
function boardPin(node) {
  return {
    object_type: "board",
    content: JSON.stringify({ type: "doc", content: [node] }),
  };
}
function multiBoardPin() {
  return {
    object_type: "board",
    content: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "x" }] },
        { type: "paragraph", content: [{ type: "text", text: "y" }] },
      ],
    }),
  };
}

describe("pinKind", () => {
  it("returns 'text' for plain notes", () => {
    expect(pinKind(notePin())).toBe("text");
  });
  it("returns 'file' for attachment pins", () => {
    expect(pinKind(filePin())).toBe("file");
  });
  it("does not call an image attachment a file pin — an image renders as itself", () => {
    // Images are attachments too now (same blob store as files), but a
    // pinned image should show the picture, not a 📎 chip that opens an
    // external viewer. Same classification a pinned localImage got.
    const imagePin = {
      object_type: "board",
      content: JSON.stringify({
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "attachment", attrs: { kind: "image", blob_hash: "h", filename: "photo.png" } }],
        }],
      }),
    };
    expect(pinKind(imagePin)).not.toBe("file");
  });
  it("still calls a bare file attachment a file pin", () => {
    const bare = {
      object_type: "board",
      content: JSON.stringify({
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "attachment", attrs: { kind: "file", blob_hash: "h", filename: "report.pdf" } }],
        }],
      }),
    };
    expect(pinKind(bare)).toBe("file");
  });
  it("returns 'outline' for blockquote single-node pins", () => {
    expect(pinKind(boardPin({ type: "blockquote", content: [{ type: "paragraph" }] }))).toBe("outline");
  });
  it("returns 'tasks' for a list whose first item is marker=task", () => {
    expect(
      pinKind(
        boardPin({
          type: "list",
          content: [{ type: "listItem", attrs: { marker: "task" }, content: [{ type: "paragraph" }] }],
        }),
      ),
    ).toBe("tasks");
  });
  it("returns 'numbered' for list with marker=ordered", () => {
    expect(
      pinKind(
        boardPin({
          type: "list",
          content: [{ type: "listItem", attrs: { marker: "ordered" }, content: [{ type: "paragraph" }] }],
        }),
      ),
    ).toBe("numbered");
  });
  it("returns 'list' for list with marker=bullet", () => {
    expect(
      pinKind(
        boardPin({
          type: "list",
          content: [{ type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph" }] }],
        }),
      ),
    ).toBe("list");
  });
  it("returns 'chart' for a chart node with unknown kind", () => {
    expect(pinKind(boardPin({ type: "chart", attrs: {} }))).toBe("chart");
  });
  it("returns 'flowchart' / 'mindmap' / 'timeline' for known chart kinds", () => {
    expect(pinKind(boardPin({ type: "chart", attrs: { kind: "flowchart" } }))).toBe("flowchart");
    expect(pinKind(boardPin({ type: "chart", attrs: { kind: "mindmap" } }))).toBe("mindmap");
    expect(pinKind(boardPin({ type: "chart", attrs: { kind: "timeline" } }))).toBe("timeline");
  });
  it("returns 'q&a' / 'table' / 'recipe' / 'code'", () => {
    expect(pinKind(boardPin({ type: "qaBlock", content: [] }))).toBe("q&a");
    expect(pinKind(boardPin({ type: "table", content: [] }))).toBe("table");
    expect(pinKind(boardPin({ type: "recipeBlock", content: [] }))).toBe("recipe");
    expect(pinKind(boardPin({ type: "codeBlock", content: [] }))).toBe("code");
  });
  it("returns 'board' for multi-node pins", () => {
    expect(pinKind(multiBoardPin())).toBe("board");
  });
});

describe("kindToFamily", () => {
  it("maps text", () => {
    expect(kindToFamily("text")).toBe("text");
  });
  it("maps list kinds to lists family", () => {
    expect(kindToFamily("tasks")).toBe("lists");
    expect(kindToFamily("numbered")).toBe("lists");
    expect(kindToFamily("list")).toBe("lists");
  });
  it("maps structure kinds to structure family", () => {
    expect(kindToFamily("outline")).toBe("structure");
    expect(kindToFamily("q&a")).toBe("structure");
    expect(kindToFamily("recipe")).toBe("structure");
    expect(kindToFamily("table")).toBe("structure");
  });
  it("maps chart kinds to charts family", () => {
    expect(kindToFamily("flowchart")).toBe("charts");
    expect(kindToFamily("mindmap")).toBe("charts");
    expect(kindToFamily("timeline")).toBe("charts");
    expect(kindToFamily("chart")).toBe("charts");
  });
  it("maps code to code", () => {
    expect(kindToFamily("code")).toBe("code");
  });
  it("maps file to files", () => {
    expect(kindToFamily("file")).toBe("files");
  });
  it("maps board to null (no family)", () => {
    expect(kindToFamily("board")).toBe(null);
  });
  it("maps unknown / null input to null", () => {
    expect(kindToFamily(null)).toBe(null);
    expect(kindToFamily(undefined)).toBe(null);
    expect(kindToFamily("nonsense")).toBe(null);
  });
});

describe("pinFamily", () => {
  it("composes pinKind then kindToFamily", () => {
    expect(pinFamily(notePin())).toBe("text");
    expect(pinFamily(filePin())).toBe("files");
    expect(pinFamily(boardPin({ type: "blockquote", content: [{ type: "paragraph" }] }))).toBe("structure");
    expect(pinFamily(multiBoardPin())).toBe(null);
  });
});

import { nodeKind, nodeFamily } from "./pin-display.js";

describe("nodeKind", () => {
  const node = (type, attrs = {}, content = []) => ({
    type: { name: type },
    attrs,
    content: { firstChild: content[0] || null },
  });

  it("returns 'file' for attachment", () => {
    expect(nodeKind(node("attachment"))).toBe("file");
    expect(nodeKind(node("attachment", { kind: "file" }))).toBe("file");
  });
  it("returns null for an image attachment — it isn't a file chip", () => {
    expect(nodeKind(node("attachment", { kind: "image" }))).toBe(null);
  });
  it("returns 'table' / 'q&a' / 'outline' / 'recipe' / 'code'", () => {
    expect(nodeKind(node("table"))).toBe("table");
    expect(nodeKind(node("qaBlock"))).toBe("q&a");
    expect(nodeKind(node("blockquote"))).toBe("outline");
    expect(nodeKind(node("recipeBlock"))).toBe("recipe");
    expect(nodeKind(node("codeBlock"))).toBe("code");
  });
  it("returns chart subkinds when attrs.kind is known", () => {
    expect(nodeKind(node("chart", { kind: "flowchart" }))).toBe("flowchart");
    expect(nodeKind(node("chart", { kind: "mindmap" }))).toBe("mindmap");
    expect(nodeKind(node("chart", { kind: "timeline" }))).toBe("timeline");
  });
  it("returns 'chart' for chart with unknown / missing kind", () => {
    expect(nodeKind(node("chart"))).toBe("chart");
    expect(nodeKind(node("chart", { kind: "weird" }))).toBe("chart");
  });
  it("returns list kinds based on listItem marker", () => {
    expect(nodeKind(node("list", {}, [{ attrs: { marker: "task" } }]))).toBe("tasks");
    expect(nodeKind(node("list", {}, [{ attrs: { marker: "ordered" } }]))).toBe("numbered");
    expect(nodeKind(node("list", {}, [{ attrs: { marker: "bullet" } }]))).toBe("list");
    expect(nodeKind(node("list", {}, [{ attrs: { marker: "plain" } }]))).toBe("list");
  });
  it("returns null for paragraph / heading / unknown types", () => {
    expect(nodeKind(node("paragraph"))).toBe(null);
    expect(nodeKind(node("heading"))).toBe(null);
    expect(nodeKind(node("dayMarker"))).toBe(null);
    expect(nodeKind(null)).toBe(null);
    expect(nodeKind(undefined)).toBe(null);
  });
});

describe("nodeFamily", () => {
  const node = (type, attrs = {}) => ({ type: { name: type }, attrs, content: { firstChild: null } });
  it("maps node kinds through kindToFamily", () => {
    expect(nodeFamily(node("blockquote"))).toBe("structure");
    expect(nodeFamily(node("chart", { kind: "flowchart" }))).toBe("charts");
    expect(nodeFamily(node("attachment"))).toBe("files");
    expect(nodeFamily(node("paragraph"))).toBe(null);
  });
});
