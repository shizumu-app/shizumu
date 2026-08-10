import { describe, it, expect } from "vitest";
import { looksLikeMarkdown } from "../markdown-clipboard.js";

describe("looksLikeMarkdown", () => {
  it("returns true for a heading paired with a bullet list", () => {
    expect(looksLikeMarkdown("# Title\n\n- one\n- two")).toBe(true);
  });

  it("returns true for a fenced code block", () => {
    expect(looksLikeMarkdown("plain\n```js\ncode\n```\nplain")).toBe(true);
  });

  it("returns true for a lone fenced code block", () => {
    expect(looksLikeMarkdown("```js\ncode\n```")).toBe(true);
  });

  it("returns true for a bold pair combined with a heading", () => {
    expect(looksLikeMarkdown("hello **world**\n# done")).toBe(true);
  });

  it("returns true for a bullet list under a heading", () => {
    expect(looksLikeMarkdown("# Setup\n\n- one\n- two")).toBe(true);
  });

  it("returns false for plain prose with no markdown markers", () => {
    expect(looksLikeMarkdown("just a paragraph of words.")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(looksLikeMarkdown("")).toBe(false);
  });

  it("does NOT misfire on a single asterisk (multiplication, etc.)", () => {
    expect(looksLikeMarkdown("a * b = c")).toBe(false);
  });

  it("returns false for shell output that starts with a comment", () => {
    expect(looksLikeMarkdown("# comment\necho hi")).toBe(false);
  });
});

// Regression: a copied checklist item pasted back as literal text.
// looksLikeMarkdown required TWO distinct marker types, and a list is only
// one — so no list payload could ever qualify. The paste fell through to
// plain text and inserted "- [ ] make default font size 17 by default"
// verbatim; copying that item again prefixed another marker, compounding to
// "- [ ] - [ ] …".
describe("looksLikeMarkdown — list payloads", () => {
  it("accepts a single task line, which prose never produces", () => {
    expect(looksLikeMarkdown("- [ ] make default font size 17 by default")).toBe(true);
    expect(looksLikeMarkdown("- [x] done thing")).toBe(true);
    expect(looksLikeMarkdown("* [ ] star marker")).toBe(true);
  });

  it("accepts two or more list lines", () => {
    expect(looksLikeMarkdown("- one\n- two")).toBe(true);
    expect(looksLikeMarkdown("1. first\n2. second")).toBe(true);
  });

  it("still rejects a lone bullet line — too close to ordinary prose", () => {
    expect(looksLikeMarkdown("- a single bullet line")).toBe(false);
  });

  it("still rejects the plain text it was written to protect", () => {
    expect(looksLikeMarkdown("just a sentence about nothing")).toBe(false);
    expect(looksLikeMarkdown("a dash - mid sentence is not a list")).toBe(false);
    // A unified diff opens lines with -/+ but without the trailing space.
    expect(looksLikeMarkdown("-removed line\n+added line")).toBe(false);
  });
});
