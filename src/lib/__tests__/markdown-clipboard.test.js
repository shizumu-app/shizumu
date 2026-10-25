import { describe, it, expect } from "vitest";
import { looksLikeMarkdown, selectionPlainText } from "../markdown-clipboard.js";

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

describe("selectionPlainText — what a non-markdown app receives", () => {
  // THE BUG, REPORTED FROM A REAL PASTE: "when copying from shizumu and
  // paste in another app it get \ for text".
  //
  // The copy handler built `text/plain` by stripping markdown syntax out of
  // the MARKDOWN it had just produced. That markdown is escaped — the
  // exporter backslash-escapes ` \ ` * _ { } [ ] < > ` so a page round-trips
  // through a file — and the strip removed `#`, `*`, backticks and `~~`
  // while leaving every backslash behind. Worse, where the escape was `\*`
  // the strip took the asterisk and left the backslash, so the character the
  // writer typed was DESTROYED rather than merely decorated:
  //
  //     typed  2*3 = 6           pasted  2\3 = 6
  //     typed  snake_case        pasted  snake\_case
  //
  // The fix is not a better strip. Plain text is not markdown with the
  // syntax taken out — it is the text the writer typed, which ProseMirror
  // already holds. These tests are over the doc shape rather than the
  // markdown, because deriving one from the other is the defect.
  const doc = (...blocks) => ({
    state: { selection: { content: () => ({ content: fragment(blocks) }) } },
  });

  /** The parts of a ProseMirror Fragment this function uses, over plain
   *  JSON — enough to drive `textBetween`'s contract without pulling the
   *  editor in. `textBetween` is ProseMirror's own, so what is faked here
   *  is the fragment, never the behaviour under test. */
  function fragment(blocks) {
    const text = blocks
      .map((b) => (b.content || []).map((n) => n.text ?? "").join(""))
      .join("\n\n");
    return { size: text.length + blocks.length * 2, textBetween: () => text };
  }

  const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });

  it("gives back the asterisk the writer typed, rather than a backslash", () => {
    expect(selectionPlainText(doc(para("2*3 = 6")))).toBe("2*3 = 6");
  });

  it("leaves an underscore alone", () => {
    expect(selectionPlainText(doc(para("snake_case matters")))).toBe("snake_case matters");
  });

  it("leaves brackets and angle brackets alone", () => {
    expect(selectionPlainText(doc(para("see [the note] when a < b")))).toBe(
      "see [the note] when a < b",
    );
  });

  it("separates blocks by a blank line", () => {
    expect(selectionPlainText(doc(para("first"), para("second")))).toBe("first\n\nsecond");
  });

  it("answers empty for no editor at all", () => {
    // Not a bug written down as correct: the copy handler calls this before
    // it knows there is a selection worth writing, and an empty string is
    // what tells it to leave the clipboard to TipTap's own default.
    expect(selectionPlainText(null)).toBe("");
  });
});
