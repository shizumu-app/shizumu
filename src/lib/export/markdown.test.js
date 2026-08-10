// Smoke tests for the markdown serializer. The full round-trip suite
// (serialize → parse → assert equivalence) lives in round-trip.test.js
// once the parser exists. These tests assert serializer output shape only.

import { describe, it, expect } from "vitest";
import {
  serializePage,
  serializeTrail,
  serializeReadme,
  attachmentImageExportName,
} from "./markdown.js";

function makePage(overrides = {}) {
  return {
    id: "PAGE1",
    date: "2026-05-19",
    page_number: 1,
    what_matters_now: "settle the export shape",
    created_at: "2026-05-19T09:00:00Z",
    updated_at: "2026-05-19T15:00:00Z",
    content_json: JSON.stringify({ type: "doc", content: [] }),
    ...overrides,
  };
}

describe("frontmatter", () => {
  it("emits the format version sentinel", () => {
    const out = serializePage({ page: makePage() });
    expect(out.startsWith("---\nshizumu: 1\n")).toBe(true);
  });

  it("preserves page identity fields", () => {
    const out = serializePage({
      page: makePage(),
      lineage: { id: "LIN1", name: "book", mode: "discrete", created_at: "x" },
      lineagePath: "shizumu › book",
    });
    expect(out).toContain("page_id: PAGE1");
    expect(out).toContain("lineage_id: LIN1");
    expect(out).toContain("lineage_path: shizumu › book");
    expect(out).toContain("date: 2026-05-19");
  });

  it("omits null fields", () => {
    const out = serializePage({ page: makePage() });
    expect(out).not.toContain("lineage_id: null");
    expect(out).not.toContain("lineage_path: null");
    expect(out).not.toMatch(/^pins:/m);
  });

  it("emits pins list with content as literal block", () => {
    const out = serializePage({
      page: makePage(),
      pins: [
        {
          id: "PIN1",
          object_type: "board",
          title: "first pin",
          auto_insert: false,
          lineage_id: "LIN1",
          position: 0,
          content: "plain text content",
        },
      ],
    });
    expect(out).toContain("pins:");
    expect(out).toContain("- id: PIN1");
    expect(out).toContain("scope: trail");
    expect(out).toContain("content: |");
    expect(out).toContain("plain text content");
  });

  it("derives global scope when pin has no lineage_id", () => {
    const out = serializePage({
      page: makePage(),
      pins: [
        { id: "PIN1", object_type: "notes", title: "g", auto_insert: true, position: 0, content: "" },
      ],
    });
    expect(out).toContain("scope: global");
  });
});

describe("body — simple blocks", () => {
  it("renders paragraphs", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "first line." }] },
            { type: "paragraph", content: [{ type: "text", text: "second line." }] },
          ],
        }),
      }),
    });
    expect(out).toContain("first line.");
    expect(out).toContain("second line.");
    // Blank line between paragraphs.
    expect(out).toMatch(/first line\.\n\nsecond line\./);
  });

  it("renders an attachment image as a markdown image pointing at the copied asset", () => {
    const attrs = { kind: "image", blob_hash: "deadbeefcafe", filename: "photo.png" };
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "attachment", attrs }] }],
        }),
      }),
    });
    expect(out).toContain(`![photo.png](../images/${attachmentImageExportName(attrs)})`);
  });

  it("names an exported image by hash prefix so same-named blobs don't collide", () => {
    const a = attachmentImageExportName({ blob_hash: "aaaaaaaaaa", filename: "shot.png" });
    const b = attachmentImageExportName({ blob_hash: "bbbbbbbbbb", filename: "shot.png" });
    expect(a).not.toBe(b);
    expect(a).toMatch(/shot\.png$/);
  });

  it("drops a file attachment from markdown — its bytes aren't exported", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [{
            type: "paragraph",
            content: [
              { type: "text", text: "see " },
              { type: "attachment", attrs: { kind: "file", blob_hash: "f1", filename: "report.pdf" } },
            ],
          }],
        }),
      }),
    });
    // Surrounding text survives (the serializer trims the trailing space).
    expect(out).toContain("see");
    expect(out).not.toContain("report.pdf");
  });

  it("renders headings at the correct level", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "h1" }] },
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "h2" }] },
            { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "h3" }] },
          ],
        }),
      }),
    });
    expect(out).toContain("# h1");
    expect(out).toContain("## h2");
    expect(out).toContain("### h3");
  });

  it("renders blockquote with > prefix", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "blockquote",
              content: [{ type: "paragraph", content: [{ type: "text", text: "a quote" }] }],
            },
          ],
        }),
      }),
    });
    expect(out).toContain("> a quote");
  });

  it("renders inline marks", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "a " },
                { type: "text", text: "bold", marks: [{ type: "bold" }] },
                { type: "text", text: " and " },
                { type: "text", text: "italic", marks: [{ type: "italic" }] },
                { type: "text", text: " and " },
                { type: "text", text: "code", marks: [{ type: "code" }] },
              ],
            },
          ],
        }),
      }),
    });
    expect(out).toContain("a **bold** and *italic* and `code`");
  });
});

describe("body — lists", () => {
  function listDoc(items) {
    return JSON.stringify({
      type: "doc",
      content: [
        {
          type: "list",
          content: items.map((it) => ({
            type: "listItem",
            attrs: { marker: it.marker, checked: it.checked || false },
            content: [{ type: "paragraph", content: [{ type: "text", text: it.text }] }],
          })),
        },
      ],
    });
  }

  it("renders bullet items with -", () => {
    const out = serializePage({
      page: makePage({
        content_json: listDoc([{ marker: "bullet", text: "a" }, { marker: "bullet", text: "b" }]),
      }),
    });
    expect(out).toContain("- a");
    expect(out).toContain("- b");
  });

  it("renders ordered items with incrementing numbers", () => {
    const out = serializePage({
      page: makePage({
        content_json: listDoc([
          { marker: "ordered", text: "first" },
          { marker: "ordered", text: "second" },
          { marker: "ordered", text: "third" },
        ]),
      }),
    });
    expect(out).toContain("1. first");
    expect(out).toContain("2. second");
    expect(out).toContain("3. third");
  });

  it("renders task items with [ ] / [x]", () => {
    const out = serializePage({
      page: makePage({
        content_json: listDoc([
          { marker: "task", text: "todo", checked: false },
          { marker: "task", text: "done", checked: true },
        ]),
      }),
    });
    expect(out).toContain("- [ ] todo");
    expect(out).toContain("- [x] done");
  });
});

describe("body — code and chart", () => {
  it("renders codeBlock with fence and language", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "codeBlock",
              attrs: { language: "rust" },
              content: [{ type: "text", text: "fn main() {}\n" }],
            },
          ],
        }),
      }),
    });
    expect(out).toContain("```rust\nfn main() {}\n```");
  });

  it("renders chart as fenced mermaid block", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "chart",
              attrs: {
                kind: "flowchart",
                source: {
                  direction: "TB",
                  nodes: [{ id: "a", label: "start", shape: "rect" }],
                  edges: [],
                },
              },
            },
          ],
        }),
      }),
    });
    expect(out).toContain("```mermaid");
    expect(out).toContain("flowchart TB");
    expect(out).toContain('a["start"]');
  });
});

describe("body — block-level decorations", () => {
  it("emits the pin anchor comment before a pinned block", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "blockquote",
              attrs: { pinId: "PIN1" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "pinned" }] }],
            },
          ],
        }),
      }),
      pins: [{ id: "PIN1", object_type: "board", title: "x", auto_insert: false, position: 0, content: "" }],
    });
    expect(out).toContain("<!-- shizumu:pin:PIN1 -->");
    // Anchor immediately precedes the blockquote.
    expect(out).toMatch(/<!-- shizumu:pin:PIN1 -->\n> pinned/);
  });

  it("does NOT emit the anchor when pinId is not in knownPinIds", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "blockquote",
              attrs: { pinId: "GHOST" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "stale" }] }],
            },
          ],
        }),
      }),
      pins: [],
    });
    expect(out).not.toContain("shizumu:pin:GHOST");
  });

  it("emits blockTitle as a bold prelude line", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "list",
              attrs: { blockTitle: "shopping" },
              content: [
                {
                  type: "listItem",
                  attrs: { marker: "bullet" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "milk" }] }],
                },
              ],
            },
          ],
        }),
      }),
    });
    expect(out).toMatch(/\*\*shopping\*\*\n- milk/);
  });
});

describe("body — dayMarker", () => {
  it("renders as H2 heading with date and focus", () => {
    const out = serializePage({
      page: makePage({
        content_json: JSON.stringify({
          type: "doc",
          content: [
            { type: "dayMarker", attrs: { date: "2026-05-19", whatMatters: "settle export" } },
          ],
        }),
      }),
    });
    expect(out).toContain("## 2026-05-19 — settle export");
  });
});

describe("serializeTrail / serializeReadme", () => {
  it("trail file carries lineage metadata", () => {
    const out = serializeTrail({
      lineage: { id: "LIN1", name: "book", mode: "continuous", created_at: "x" },
      parent: null,
    });
    expect(out).toContain("kind: trail");
    expect(out).toContain("lineage_id: LIN1");
    expect(out).toContain("mode: continuous");
    expect(out).toContain("# book");
  });

  it("readme carries export summary", () => {
    const out = serializeReadme({
      summary: {
        exported_at: "2026-05-19T15:00:00Z",
        page_count: 47,
        trail_count: 8,
        image_count: 3,
        shizumu_version: "0.3.0",
      },
    });
    expect(out).toContain("page_count: 47");
    expect(out).toContain("trail_count: 8");
    expect(out).toContain("shizumu export — 47 pages across 8 trails — 2026-05-19");
  });
});
