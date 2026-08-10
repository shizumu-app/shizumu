import { describe, it, expect } from "vitest";
import { migrateListSchema } from "../migrate-list-schema.js";

describe("migrateListSchema", () => {
  it("returns null/undefined/primitive inputs unchanged", () => {
    expect(migrateListSchema(null)).toBeNull();
    expect(migrateListSchema(undefined)).toBeUndefined();
    expect(migrateListSchema(42)).toBe(42);
    expect(migrateListSchema("hello")).toBe("hello");
  });

  it("maps taskList → list and rewrites taskItem children", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }],
            },
          ],
        },
      ],
    };
    const out = migrateListSchema(input);
    expect(out.type).toBe("doc");
    expect(out.content[0].type).toBe("list");
    expect(out.content[0].content).toHaveLength(2);
    expect(out.content[0].content[0]).toMatchObject({
      type: "listItem",
      attrs: { marker: "task", checked: true },
    });
    expect(out.content[0].content[1]).toMatchObject({
      type: "listItem",
      attrs: { marker: "task", checked: false },
    });
  });

  it("maps bulletList → list and preserves listItem markers", () => {
    const input = {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          attrs: { marker: "bullet" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
        },
        {
          type: "listItem",
          attrs: { marker: "plain" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "y" }] }],
        },
      ],
    };
    const out = migrateListSchema(input);
    expect(out.type).toBe("list");
    expect(out.content[0].attrs.marker).toBe("bullet");
    expect(out.content[1].attrs.marker).toBe("plain");
  });

  it("maps orderedList → list and adds default marker to bare listItems", () => {
    const input = {
      type: "orderedList",
      attrs: { start: 1 },
      content: [
        {
          type: "listItem",
          // legacy listItem with no marker attr
          content: [{ type: "paragraph", content: [{ type: "text", text: "step 1" }] }],
        },
      ],
    };
    const out = migrateListSchema(input);
    expect(out.type).toBe("list");
    // start attr from orderedList is dropped
    expect(out.attrs).toBeUndefined();
    // listItem missing marker gets bullet default (the test would set marker
    // to ordered explicitly via the slash command path; for migrating an
    // existing legacy ordered list, we rely on a follow-up pass to mark
    // ordered — this test documents that we DON'T magically inherit from
    // the parent. See the next test for the explicit-ordered path.)
    expect(out.content[0].attrs).toEqual({ marker: "bullet", checked: false });
  });

  it("preserves explicit listItem marker even when parent is migrated", () => {
    const input = {
      type: "orderedList",
      content: [
        {
          type: "listItem",
          attrs: { marker: "ordered" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }],
        },
      ],
    };
    const out = migrateListSchema(input);
    expect(out.content[0].attrs.marker).toBe("ordered");
  });

  it("preserves pinId attribute through migration", () => {
    const input = {
      type: "taskList",
      attrs: { pinId: "abc-123" },
      content: [
        {
          type: "taskItem",
          attrs: { checked: false, pinId: "item-pin" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
        },
      ],
    };
    const out = migrateListSchema(input);
    expect(out.attrs.pinId).toBe("abc-123");
    expect(out.content[0].attrs.pinId).toBe("item-pin");
    expect(out.content[0].attrs.marker).toBe("task");
  });

  it("preserves blockTitle attribute through container migration", () => {
    const input = {
      type: "taskList",
      attrs: { blockTitle: "launch wednesday" },
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
        },
      ],
    };
    const out = migrateListSchema(input);
    expect(out.attrs.blockTitle).toBe("launch wednesday");
  });

  it("recurses into nested lists inside list items", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "outer" }] },
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: true },
                      content: [{ type: "paragraph", content: [{ type: "text", text: "inner" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = migrateListSchema(input);
    expect(out.content[0].type).toBe("list");
    const outerItem = out.content[0].content[0];
    expect(outerItem.type).toBe("listItem");
    expect(outerItem.content[1].type).toBe("list");
    expect(outerItem.content[1].content[0]).toMatchObject({
      type: "listItem",
      attrs: { marker: "task", checked: true },
    });
  });

  it("walks into other block types and migrates lists found inside", () => {
    const input = {
      type: "blockquote",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
            },
          ],
        },
      ],
    };
    const out = migrateListSchema(input);
    expect(out.type).toBe("blockquote");
    expect(out.content[0].type).toBe("list");
  });

  it("is idempotent — running twice produces the same output", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true, pinId: "p1" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              attrs: { marker: "plain" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }],
            },
          ],
        },
      ],
    };
    const once = migrateListSchema(input);
    const twice = migrateListSchema(once);
    expect(twice).toEqual(once);
  });

  it("handles arrays at the top level (not just objects)", () => {
    const input = [
      { type: "taskList", content: [] },
      { type: "paragraph", content: [{ type: "text", text: "hi" }] },
    ];
    const out = migrateListSchema(input);
    expect(out[0].type).toBe("list");
    expect(out[1].type).toBe("paragraph");
  });

  it("does not mutate the input", () => {
    const input = {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
        },
      ],
    };
    const inputCopy = JSON.parse(JSON.stringify(input));
    migrateListSchema(input);
    expect(input).toEqual(inputCopy);
  });

  it("handles missing content arrays gracefully", () => {
    const input = { type: "taskList" };
    const out = migrateListSchema(input);
    expect(out).toEqual({ type: "list", attrs: undefined, content: [] });
  });

  it("leaves unrelated node types untouched", () => {
    const input = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "title" }] },
        { type: "paragraph", content: [{ type: "text", text: "body" }] },
        { type: "horizontalRule" },
        { type: "qaBlock", content: [
          { type: "paragraph", content: [{ type: "text", text: "Q: ?" }] },
          { type: "paragraph", content: [{ type: "text", text: "A: !" }] },
        ] },
      ],
    };
    const out = migrateListSchema(input);
    expect(out).toEqual(input);
  });
});
