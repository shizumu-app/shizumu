import { describe, it, expect } from "vitest";
import { pinKind, pinFamily, kindToFamily, isFilePin, isImagePin, imageMetaOf, pinSearchText, pinModalKind } from "./pin-display.js";

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
  // Regression: every pin-creation path in TipTapEditor stamps
  // object_type "file" for ANY attachment (`pinCategory = isAttachment ?
  // "file" : ...`), image ones included. isFilePin used to return true on
  // that stamp alone, before looking at the content — so a pinned image
  // rendered as a 📎 file row with a filename and a byte count instead of
  // the picture. The content is the authority; the stamp is not.
  it("classifies a pinned image as an image even when object_type says 'file'", () => {
    const imagePin = {
      object_type: "file",
      content: JSON.stringify({
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "attachment", attrs: { kind: "image", blob_hash: "h", filename: "photo.png", mime_type: "image/png", size_bytes: 12 } }],
        }],
      }),
    };
    expect(pinKind(imagePin)).toBe("image");
    expect(isFilePin(imagePin)).toBe(false);
    expect(isImagePin(imagePin)).toBe(true);
    expect(imageMetaOf(imagePin.content)).toEqual({
      blob_hash: "h", filename: "photo.png", mime_type: "image/png", size_bytes: 12,
    });
  });

  it("classifies a bare (non-paragraph-wrapped) image node as an image too", () => {
    const bare = {
      object_type: "file",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "attachment", attrs: { kind: "image", blob_hash: "h2", filename: "shot.jpg" } }],
      }),
    };
    expect(pinKind(bare)).toBe("image");
    expect(isImagePin(bare)).toBe(true);
  });

  it("keeps an image pin in the 'files' family so the panel filter still finds it", () => {
    // The type filter offers six fixed buckets (text/lists/structure/
    // charts/code/files). Images belong with attachments rather than
    // spawning a seventh the panel has no control for.
    expect(kindToFamily("image")).toBe("files");
  });

  it("is not an image pin when the image sits alongside real text", () => {
    // A written line that happens to embed an image is a note, not an
    // image pin — the same split isFilePin already draws for files.
    const mixed = {
      object_type: "note",
      content: JSON.stringify({
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "look at this" },
            { type: "attachment", attrs: { kind: "image", blob_hash: "h", filename: "photo.png" } },
          ],
        }],
      }),
    };
    expect(isImagePin(mixed)).toBe(false);
    expect(pinKind(mixed)).toBe("text");
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
  it("returns 'q&a' / 'table' / 'recipe' / 'decision' / 'code'", () => {
    expect(pinKind(boardPin({ type: "qaBlock", content: [] }))).toBe("q&a");
    expect(pinKind(boardPin({ type: "table", content: [] }))).toBe("table");
    expect(pinKind(boardPin({ type: "recipeBlock", content: [] }))).toBe("recipe");
    expect(pinKind(boardPin({ type: "decisionBlock", content: [] }))).toBe("decision");
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
    expect(kindToFamily("decision")).toBe("structure");
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
  it("returns 'table' / 'q&a' / 'outline' / 'recipe' / 'decision' / 'code'", () => {
    expect(nodeKind(node("table"))).toBe("table");
    expect(nodeKind(node("qaBlock"))).toBe("q&a");
    expect(nodeKind(node("blockquote"))).toBe("outline");
    expect(nodeKind(node("recipeBlock"))).toBe("recipe");
    expect(nodeKind(node("decisionBlock"))).toBe("decision");
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

describe("pinSearchText", () => {
  // Memory's pins tab matched on a local copy of the text walk that (a)
  // returned the RAW JSON string for any pin it did not classify as a
  // board — so searching "paragraph" matched schema keys the user never
  // wrote — and (b) like the FTS indexer, never saw a block's title,
  // because a title is a node attribute rather than a text node.
  it("includes a block title that lives in a node attribute", () => {
    const pin = {
      object_type: "board",
      content: JSON.stringify({
        type: "doc",
        content: [{
          type: "list",
          attrs: { blockTitle: "reading list" },
          content: [{
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "finish chapter 3" }] }],
          }],
        }],
      }),
    };
    const hay = pinSearchText(pin);
    expect(hay).toContain("reading list");
    expect(hay).toContain("finish chapter 3");
  });

  it("includes the pin's own row title", () => {
    expect(pinSearchText({ object_type: "note", title: "the shape of it", content: "body" }))
      .toContain("the shape of it");
  });

  it("includes an attachment filename — the only words a file contributes", () => {
    const pin = {
      object_type: "file",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "attachment", attrs: { kind: "file", filename: "lease-agreement.pdf" } }],
      }),
    };
    expect(pinSearchText(pin)).toContain("lease-agreement.pdf");
  });

  it("never leaks raw JSON for a note whose content is a serialized doc", () => {
    // The old walk fell back to the raw string for anything it didn't call
    // a board, so a note stored as a doc made every schema key searchable.
    const pin = {
      object_type: "note",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "only this" }] }],
      }),
    };
    const hay = pinSearchText(pin);
    expect(hay).toContain("only this");
    expect(hay).not.toContain("paragraph");
    expect(hay).not.toContain("doc");
  });

  it("still reads a note stored as a plain string", () => {
    expect(pinSearchText({ object_type: "note", content: "written straight to the row" }))
      .toContain("written straight to the row");
  });

  it("is empty for a pin with nothing in it", () => {
    // Empty, not the word "null" or "{}" — an empty haystack matches
    // nothing, whereas a stringified blank would match those substrings.
    expect(pinSearchText(null)).toBe("");
    expect(pinSearchText({ object_type: "note", content: null, title: null })).toBe("");
  });
});

describe("pinModalKind", () => {
  // Two surfaces each kept their own list of what counts as a board, and
  // the lists had drifted: SharedObjectsPanel's included "file",
  // Memory's did not. So the SAME pin opened the rich artifact modal from
  // the panel and the plain-text note modal from memory — and the note
  // modal renders pin.content into a <textarea>, which for any pin whose
  // content is a doc means a wall of raw JSON where the picture should be.
  it("opens an image pin as an artifact, so the modal shows the picture", () => {
    const imagePin = {
      object_type: "file",
      content: JSON.stringify({
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "attachment", attrs: { kind: "image", blob_hash: "h", filename: "logo.png" } }],
        }],
      }),
    };
    expect(pinModalKind(imagePin)).toBe("artifact");
  });

  it("opens a file pin as an artifact too", () => {
    // A row click on a file usually hands the blob to the OS before any
    // modal opens, but every other route in (deep link, keyboard, the
    // panel's openPinId effect) must not land on a JSON textarea either.
    const filePin = {
      object_type: "file",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "attachment", attrs: { kind: "file", filename: "a.pdf" } }],
      }),
    };
    expect(pinModalKind(filePin)).toBe("artifact");
  });

  it("opens the structured pin types as artifacts", () => {
    for (const object_type of ["artifact", "board", "table"]) {
      expect(pinModalKind({ object_type, content: "{}" })).toBe("artifact");
    }
  });

  it("opens a plain note as a note", () => {
    // The note modal's textarea is right for exactly this: content that
    // really is a plain string the user typed.
    expect(pinModalKind({ object_type: "note", content: "written straight to the row" })).toBe("note");
  });

  it("opens a note whose content is a serialized doc as an artifact", () => {
    // TipTapEditor writes a note's content as plain text on one path and
    // as a doc on another (see the pinsRich VR fixture). Sending the doc
    // shape to the textarea is how JSON reaches the screen, so the shape
    // decides, not the stamp alone.
    const docNote = {
      object_type: "note",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "three things" }] }],
      }),
    };
    expect(pinModalKind(docNote)).toBe("artifact");
  });

  it("falls back to a note when there is nothing to parse", () => {
    expect(pinModalKind(null)).toBe("note");
    expect(pinModalKind({ object_type: "note", content: null })).toBe("note");
  });
});
