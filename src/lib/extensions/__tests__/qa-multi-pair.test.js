import { describe, it, expect } from "vitest";
import { migrateQASchema } from "../migrate-qa-schema.js";

const para = (text) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : undefined,
});

describe("migrateQASchema", () => {
  it("returns null/undefined/non-object inputs unchanged", () => {
    expect(migrateQASchema(null)).toBeNull();
    expect(migrateQASchema(undefined)).toBeUndefined();
    expect(migrateQASchema(42)).toBe(42);
    expect(migrateQASchema("hello")).toBe("hello");
  });

  it("wraps a legacy qaBlock { p, p } into qaBlock { qaPair { p, p } } and strips Q:/A: prefixes", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "qaBlock",
          content: [para("Q: what time is it"), para("A: now")],
        },
      ],
    };
    const out = migrateQASchema(input);
    expect(out.content[0].type).toBe("qaBlock");
    expect(out.content[0].content).toHaveLength(1);
    expect(out.content[0].content[0].type).toBe("qaPair");
    // Prefixes are stripped: they now render via CSS ::before.
    expect(out.content[0].content[0].content[0].content[0].text).toBe("what time is it");
    expect(out.content[0].content[0].content[1].content[0].text).toBe("now");
  });

  it("is idempotent: a doc already in the new shape with stripped prefixes stays unchanged", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "qaBlock",
          content: [
            { type: "qaPair", content: [para("a"), para("b")] },
            { type: "qaPair", content: [para("c"), para("d")] },
          ],
        },
      ],
    };
    const out = migrateQASchema(input);
    expect(out.content[0].content).toHaveLength(2);
    expect(out.content[0].content.every((c) => c.type === "qaPair")).toBe(true);
    expect(out.content[0].content[0].content[0].content[0].text).toBe("a");
    expect(out.content[0].content[0].content[1].content[0].text).toBe("b");
  });

  it("strips Q:/A: prefixes from already-wrapped legacy pairs", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "qaBlock",
          content: [
            { type: "qaPair", content: [para("Q: hi"), para("A: hey")] },
          ],
        },
      ],
    };
    const out = migrateQASchema(input);
    expect(out.content[0].content[0].content[0].content[0].text).toBe("hi");
    expect(out.content[0].content[0].content[1].content[0].text).toBe("hey");
  });

  it("groups multiple legacy paragraphs into consecutive qaPairs", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "qaBlock",
          content: [
            para("Q: one"),
            para("A: one"),
            para("Q: two"),
            para("A: two"),
          ],
        },
      ],
    };
    const out = migrateQASchema(input);
    const pairs = out.content[0].content;
    expect(pairs).toHaveLength(2);
    expect(pairs[0].type).toBe("qaPair");
    expect(pairs[0].content[0].content[0].text).toBe("one");
    expect(pairs[0].content[1].content[0].text).toBe("one");
    expect(pairs[1].content[0].content[0].text).toBe("two");
    expect(pairs[1].content[1].content[0].text).toBe("two");
  });

  it("wraps a lone trailing paragraph as a half-pair with an empty A", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "qaBlock",
          content: [para("Q: only one")],
        },
      ],
    };
    const out = migrateQASchema(input);
    const pairs = out.content[0].content;
    expect(pairs).toHaveLength(1);
    expect(pairs[0].type).toBe("qaPair");
    expect(pairs[0].content[0].content[0].text).toBe("only one");
    expect(pairs[0].content[1].type).toBe("paragraph");
    expect(pairs[0].content[1].content).toBeUndefined();
  });

  it("leaves non-qaBlock nodes alone", () => {
    const input = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "intro" }] },
        {
          type: "qaBlock",
          content: [para("Q: hi"), para("A: hey")],
        },
        { type: "paragraph", content: [{ type: "text", text: "outro" }] },
      ],
    };
    const out = migrateQASchema(input);
    expect(out.content[0].content[0].text).toBe("intro");
    expect(out.content[1].type).toBe("qaBlock");
    expect(out.content[1].content[0].type).toBe("qaPair");
    expect(out.content[1].content[0].content[0].content[0].text).toBe("hi");
    expect(out.content[2].content[0].text).toBe("outro");
  });
});
