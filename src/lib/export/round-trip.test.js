// Round-trip stability gate for the v0.3 export format.
//
// For each supported construct: build a TipTap doc → serialize → parse →
// re-serialize → assert byte-equal. This proves format stability without
// requiring the importer command to exist. When the importer ships later,
// it reuses parse.js — so anything that round-trips here will round-trip
// through the importer too.

import { describe, it, expect } from "vitest";
import { serializePage } from "./markdown.js";
import { parsePage } from "./parse.js";

function makePage(doc, overrides = {}) {
  return {
    id: "PAGE1",
    date: "2026-05-19",
    page_number: 1,
    what_matters_now: "rt test",
    created_at: "2026-05-19T09:00:00Z",
    updated_at: "2026-05-19T15:00:00Z",
    content_json: JSON.stringify(doc),
    ...overrides,
  };
}

function roundTrip(doc, pins = []) {
  const page = makePage(doc);
  const md1 = serializePage({ page, pins });
  const parsed = parsePage(md1);
  // Reconstruct a page with the parsed doc and re-serialize.
  const page2 = makePage(parsed.doc);
  const md2 = serializePage({ page: page2, pins });
  return { md1, md2, parsed };
}

describe("round-trip — simple blocks", () => {
  it("paragraph", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }] };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });

  it("headings 1/2/3", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "h1" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "h2" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "h3" }] },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });

  it("blockquote", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "a wise quote" }] }],
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });

  it("horizontalRule", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "above" }] },
        { type: "horizontalRule" },
        { type: "paragraph", content: [{ type: "text", text: "below" }] },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });
});

describe("round-trip — inline marks", () => {
  it("bold / italic / code / strike", () => {
    const doc = {
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
            { type: "text", text: " and " },
            { type: "text", text: "strike", marks: [{ type: "strike" }] },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });

  it("link", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "visit " },
            { type: "text", text: "shizumu", marks: [{ type: "link", attrs: { href: "https://shizumu.app" } }] },
          ],
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });

  it("hardBreak", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "first line" },
            { type: "hardBreak" },
            { type: "text", text: "second line" },
          ],
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });
});

describe("round-trip — lists", () => {
  function listDoc(items) {
    return {
      type: "doc",
      content: [
        {
          type: "list",
          content: items.map((it) => ({
            type: "listItem",
            attrs: { marker: it.marker, ...(it.marker === "task" ? { checked: !!it.checked } : {}) },
            content: [{ type: "paragraph", content: [{ type: "text", text: it.text }] }],
          })),
        },
      ],
    };
  }

  it("bullet list", () => {
    const { md1, md2 } = roundTrip(listDoc([
      { marker: "bullet", text: "a" },
      { marker: "bullet", text: "b" },
      { marker: "bullet", text: "c" },
    ]));
    expect(md2).toBe(md1);
  });

  it("ordered list", () => {
    const { md1, md2 } = roundTrip(listDoc([
      { marker: "ordered", text: "first" },
      { marker: "ordered", text: "second" },
      { marker: "ordered", text: "third" },
    ]));
    expect(md2).toBe(md1);
  });

  it("task list with mixed checked state", () => {
    const { md1, md2 } = roundTrip(listDoc([
      { marker: "task", text: "todo", checked: false },
      { marker: "task", text: "done", checked: true },
    ]));
    expect(md2).toBe(md1);
  });
});

describe("round-trip — table", () => {
  it("simple GFM table", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "name" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "qty" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "milk" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "eggs" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "6" }] }] },
              ],
            },
          ],
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });
});

describe("round-trip — code & chart", () => {
  it("codeBlock with language", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "rust" },
          content: [{ type: "text", text: "fn main() {}\n" }],
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });

  it("chart (flowchart) round-trips structured source", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "chart",
          attrs: {
            kind: "flowchart",
            source: {
              direction: "LR",
              nodes: [
                { id: "a", label: "start", shape: "rect" },
                { id: "b", label: "end", shape: "rounded" },
              ],
              edges: [{ from: "a", to: "b", label: "next" }],
            },
          },
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });

  it("chart (timeline) round-trips", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "chart",
          attrs: {
            kind: "timeline",
            source: {
              title: "release timeline",
              events: [
                { date: "2026-05-01", label: "design", kind: "event" },
                { date: "2026-05-19", label: "v0.3 tag", kind: "milestone" },
              ],
            },
          },
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });
});

describe("round-trip — dayMarker", () => {
  it("preserves date and whatMatters", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "dayMarker", attrs: { date: "2026-05-19", whatMatters: "settle export" } },
        { type: "paragraph", content: [{ type: "text", text: "today's writing." }] },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });
});

describe("round-trip — qaBlock", () => {
  it("multi-pair qaBlock", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "qaBlock",
          content: [
            {
              type: "qaPair",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "why?" }] },
                { type: "paragraph", content: [{ type: "text", text: "because." }] },
              ],
            },
            {
              type: "qaPair",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "how?" }] },
                { type: "paragraph", content: [{ type: "text", text: "carefully." }] },
              ],
            },
          ],
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });
});

describe("round-trip — recipeBlock", () => {
  it("preserves the three slots", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "recipeBlock",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "given inputs" }] },
            {
              type: "list",
              content: [
                {
                  type: "listItem",
                  attrs: { marker: "ordered" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "step one" }] }],
                },
                {
                  type: "listItem",
                  attrs: { marker: "ordered" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "step two" }] }],
                },
              ],
            },
            { type: "paragraph", content: [{ type: "text", text: "produce output" }] },
          ],
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });
});

describe("round-trip — block-level decorations", () => {
  it("pin anchor comment preserved", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          attrs: { pinId: "PIN1" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "pinned" }] }],
        },
      ],
    };
    const pins = [{ id: "PIN1", object_type: "board", title: "x", auto_insert: false, position: 0, content: "" }];
    const { md1, md2 } = roundTrip(doc, pins);
    expect(md2).toBe(md1);
  });

  it("blockTitle attr preserved as bold prelude", () => {
    const doc = {
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
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });
});

describe("round-trip — composite page", () => {
  it("paragraph + heading + list + codeBlock + dayMarker", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "dayMarker", attrs: { date: "2026-05-19", whatMatters: "compose" } },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "morning" }] },
        { type: "paragraph", content: [{ type: "text", text: "a thought." }] },
        {
          type: "list",
          content: [
            {
              type: "listItem",
              attrs: { marker: "task", checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "write" }] }],
            },
            {
              type: "listItem",
              attrs: { marker: "task", checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "ship" }] }],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "bash" },
          content: [{ type: "text", text: "echo hi\n" }],
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });

  it("round-trips a mixed shizumu + markdown doc", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Mixed" }] },
        { type: "paragraph", content: [
          { type: "text", text: "intro with " },
          { type: "text", marks: [{ type: "bold" }], text: "bold" },
          { type: "text", text: " and " },
          { type: "text", marks: [{ type: "code" }], text: "code" },
          { type: "text", text: "." },
        ]},
        {
          type: "list",
          content: [
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "alpha" }] }],
            },
            {
              type: "listItem",
              attrs: { marker: "bullet" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "beta" }] }],
            },
          ],
        },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }] },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    expect(md2).toBe(md1);
  });
});
