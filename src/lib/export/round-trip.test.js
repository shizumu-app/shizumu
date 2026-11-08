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
    // md2 === md1 alone is stable-but-blind: if export dropped the whole
    // block, both sides would be the same empty string and the test would
    // still pass. Assert the slot headers renderRecipe emits are actually
    // in the export before comparing the two passes.
    expect(md1).toContain("### Given");
    expect(md1).toContain("### Steps");
    expect(md1).toContain("### Result");
    expect(md1).toContain("step one");
    expect(md2).toBe(md1);
  });
});

describe("round-trip — decisionBlock", () => {
  it("preserves the three slots", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "decisionBlock",
          content: [
            {
              type: "list",
              content: [
                {
                  type: "listItem",
                  attrs: { marker: "bullet" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "option one" }] }],
                },
                {
                  type: "listItem",
                  attrs: { marker: "bullet" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "option two" }] }],
                },
              ],
            },
            { type: "paragraph", content: [{ type: "text", text: "option two" }] },
            { type: "paragraph", content: [{ type: "text", text: "it scales better" }] },
          ],
        },
      ],
    };
    const { md1, md2 } = roundTrip(doc);
    // Same blindness as the recipe case above — see its comment.
    expect(md1).toContain("### Considered");
    expect(md1).toContain("### Chose");
    expect(md1).toContain("### Because");
    expect(md1).toContain("it scales better");
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

// ── format 2: id, state and pin survive a file ───────────────────────────

const p2 = (t, attrs) => ({ type: "paragraph", ...(attrs ? { attrs } : {}), content: [{ type: "text", text: t }] });
const decisionNode = (attrs) => ({
  type: "decisionBlock", attrs, content: [p2("rent or buy"), p2("rent"), p2("we move in two years")],
});

describe("round-trip — format 2 block lines", () => {
  it("brings a block's stored id back onto the same block", () => {
    const doc = { type: "doc", content: [
      p2("intro"),
      { type: "codeBlock", attrs: { language: "sh", blockId: "c0de00000001" }, content: [{ type: "text", text: "ls\n" }] },
    ] };
    const { md1, md2, parsed } = roundTrip(doc);
    expect(md2).toBe(md1);
    expect(parsed.doc.content[1].attrs.blockId).toBe("c0de00000001");
  });

  it("brings an old page's derived ids back as stored ones, the same ids", () => {
    // Nothing stored: the file carries the ids the page shows, and an import
    // of it stores exactly those.
    const doc = { type: "doc", content: [p2("intro"), decisionNode({})] };
    const { md1, md2, parsed } = roundTrip(doc);
    expect(md2).toBe(md1);
    const line = md1.match(/<!-- shizumu block id=(\S+) kind=decision/);
    expect(parsed.doc.content[1].attrs.blockId).toBe(line[1]);
  });

  it("brings a decision's state and its date back", () => {
    const doc = { type: "doc", content: [
      decisionNode({ blockId: "dec000000001", blockState: "superseded", blockStateAt: "2026-10-30" }),
    ] };
    const { md1, md2, parsed } = roundTrip(doc);
    expect(md2).toBe(md1);
    expect(parsed.doc.content[0].attrs).toMatchObject({
      blockId: "dec000000001", blockState: "superseded", blockStateAt: "2026-10-30",
    });
  });

  it("does not store a q&a's open, which the words already say", () => {
    const doc = { type: "doc", content: [{ type: "qaBlock", content: [
      { type: "qaPair", content: [p2("who signs"), { type: "paragraph" }] },
    ] }] };
    const { md1, md2, parsed } = roundTrip(doc);
    expect(md1).toMatch(/kind=qa state=open/);
    expect(md2).toBe(md1);
    // `open` is computed from the empty answer on every render; storing it
    // would let the chip and the answer disagree (block-state.js header).
    expect(parsed.doc.content[0].attrs.blockState).toBeUndefined();
  });

  it("brings a pin back onto its block, nested in a list too", () => {
    const doc = { type: "doc", content: [
      { type: "blockquote", attrs: { pinId: "PIN1", blockId: "quote0000001" }, content: [p2("pinned")] },
      { type: "list", content: [
        { type: "listItem", attrs: { marker: "bullet" }, content: [p2("deep", { pinId: "PIN2", blockId: "deep00000001" })] },
      ] },
    ] };
    const pins = [
      { id: "PIN1", object_type: "notes", position: 0, content: "" },
      { id: "PIN2", object_type: "notes", position: 1, content: "" },
    ];
    const { md1, md2, parsed } = roundTrip(doc, pins);
    expect(md2).toBe(md1);
    expect(parsed.doc.content[0].attrs).toMatchObject({ pinId: "PIN1", blockId: "quote0000001" });
    expect(parsed.doc.content[1].content[0].content[0].attrs).toMatchObject({ pinId: "PIN2", blockId: "deep00000001" });
  });
});

describe("round-trip — a format 1 file still imports", () => {
  // As 0.8.1 wrote it: no `format:` key, the pin as its own anchor line,
  // no ids, a decision with no state.
  const FORMAT_1 = [
    "---",
    "shizumu: 1",
    "page_id: OLD1",
    "date: 2026-10-01",
    "page_number: 1",
    "---",
    "",
    "<!-- shizumu:pin:PIN1 -->",
    "> pinned",
    "",
    "### Considered",
    "rent or buy",
    "",
    "### Chose",
    "rent",
    "",
    "### Because",
    "we move in two years",
    "",
  ].join("\n");

  it("reads the pin anchor and the decision", () => {
    const { frontmatter, doc } = parsePage(FORMAT_1);
    expect(frontmatter.page_id).toBe("OLD1");
    expect(frontmatter.format).toBeUndefined();
    expect(doc.content[0]).toMatchObject({ type: "blockquote", attrs: { pinId: "PIN1" } });
    expect(doc.content[1].type).toBe("decisionBlock");
    // No line, no stored state: the editor's default (standing) applies.
    expect(doc.content[1].attrs.blockState).toBeUndefined();
    expect(doc.content[0].attrs.blockId).toBeUndefined();
  });

  it("writes it back out as format 2 with the pin on its block line", () => {
    const { doc } = parsePage(FORMAT_1);
    const md = serializePage({
      page: makePage(doc, { id: "OLD1" }),
      pins: [{ id: "PIN1", object_type: "notes", position: 0, content: "" }],
    });
    expect(md).toContain("format: 2");
    expect(md).toMatch(/<!-- shizumu block id=d\S+ pin=PIN1 -->\n> pinned/);
    expect(md).toMatch(/<!-- shizumu block id=d\S+ kind=decision state=standing -->\n### Considered/);
  });
});
