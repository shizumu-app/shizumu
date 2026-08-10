import { describe, expect, test } from "vitest";
import { extractSnippetWithMatch, flattenDocText } from "../snippet.js";

const doc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "this is the start of the body" }] },
    { type: "dayMarker", attrs: { date: "2026-05-12", whatMatters: "ignored" } },
    { type: "paragraph", content: [{ type: "text", text: "and here is the BRANCH word for matching" }] },
    { type: "paragraph", content: [{ type: "text", text: "more trailing context after the branch" }] },
  ],
};

describe("flattenDocText", () => {
  test("skips dayMarker", () => {
    const out = flattenDocText(doc);
    expect(out).not.toContain("ignored");
    expect(out).toContain("this is the start");
  });
  test("returns empty for missing input", () => {
    expect(flattenDocText(null)).toBe("");
    expect(flattenDocText(undefined)).toBe("");
  });
});

describe("extractSnippetWithMatch", () => {
  test("returns null when no match", () => {
    expect(extractSnippetWithMatch(doc, "nonexistent")).toBeNull();
  });
  test("returns null when query empty", () => {
    expect(extractSnippetWithMatch(doc, "")).toBeNull();
    expect(extractSnippetWithMatch(doc, "  ")).toBeNull();
  });
  test("returns null when content empty", () => {
    expect(extractSnippetWithMatch(null, "x")).toBeNull();
    expect(extractSnippetWithMatch({}, "x")).toBeNull();
  });
  test("finds first case-insensitive match and returns window", () => {
    const out = extractSnippetWithMatch(doc, "branch");
    expect(out).not.toBeNull();
    expect(out.match.toLowerCase()).toBe("branch");
    expect(out.before.length).toBeGreaterThan(0);
    expect(out.after.length).toBeGreaterThan(0);
  });
  test("preserves original casing in `match`", () => {
    const out = extractSnippetWithMatch(doc, "branch");
    // First "BRANCH" should be the one returned (uppercase in source).
    expect(out.match).toBe("BRANCH");
  });
  test("ellipsis prefix when not at start", () => {
    const out = extractSnippetWithMatch(doc, "BRANCH", 5);
    expect(out.before.startsWith("…")).toBe(true);
  });
  test("accepts stringified JSON", () => {
    const out = extractSnippetWithMatch(JSON.stringify(doc), "BRANCH");
    expect(out).not.toBeNull();
  });
});
