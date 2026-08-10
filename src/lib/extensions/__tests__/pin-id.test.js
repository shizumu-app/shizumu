import { describe, it, expect } from "vitest";
import { stripPinIdsFromJSON, isPinnableType } from "../pin-id.js";

describe("stripPinIdsFromJSON", () => {
  it("removes pinId from a leaf node", () => {
    const input = { type: "paragraph", attrs: { pinId: "abc" }, content: [{ type: "text", text: "hello" }] };
    const out = stripPinIdsFromJSON(input);
    expect(out.attrs).toEqual({});
    expect(out.content[0]).toEqual({ type: "text", text: "hello" });
  });

  it("removes pinId from nested children recursively", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { pinId: "outer" },
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", attrs: { pinId: "inner" }, content: [{ type: "text", text: "x" }] },
              ],
            },
          ],
        },
      ],
    };
    const out = stripPinIdsFromJSON(input);
    expect(out.content[0].attrs.pinId).toBeUndefined();
    expect(out.content[0].content[0].content[0].attrs.pinId).toBeUndefined();
  });

  it("preserves other attrs and structure", () => {
    const input = {
      type: "heading",
      attrs: { level: 2, pinId: "x" },
      content: [{ type: "text", text: "title" }],
    };
    const out = stripPinIdsFromJSON(input);
    expect(out.attrs).toEqual({ level: 2 });
    expect(out.type).toBe("heading");
    expect(out.content[0].text).toBe("title");
  });

  it("is a no-op when no pinId present", () => {
    const input = { type: "paragraph", content: [{ type: "text", text: "ok" }] };
    const out = stripPinIdsFromJSON(input);
    expect(out).toEqual(input);
  });

  it("handles arrays at top level", () => {
    const input = [
      { type: "paragraph", attrs: { pinId: "a" } },
      { type: "paragraph", attrs: { pinId: "b" } },
    ];
    const out = stripPinIdsFromJSON(input);
    expect(out[0].attrs).toEqual({});
    expect(out[1].attrs).toEqual({});
  });

  it("handles null and primitives", () => {
    expect(stripPinIdsFromJSON(null)).toBe(null);
    expect(stripPinIdsFromJSON("hello")).toBe("hello");
    expect(stripPinIdsFromJSON(42)).toBe(42);
  });
});

describe("isPinnableType", () => {
  it("returns true for known pinnable types", () => {
    expect(isPinnableType("paragraph")).toBe(true);
    expect(isPinnableType("heading")).toBe(true);
    expect(isPinnableType("list")).toBe(true);
    expect(isPinnableType("blockquote")).toBe(true);
    expect(isPinnableType("qaBlock")).toBe(true);
    expect(isPinnableType("table")).toBe(true);
    expect(isPinnableType("codeBlock")).toBe(true);
  });

  it("returns false for non-pinnable types", () => {
    expect(isPinnableType("text")).toBe(false);
    expect(isPinnableType("listItem")).toBe(false);
    expect(isPinnableType("taskItem")).toBe(false);
  });
});
