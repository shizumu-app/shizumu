import { describe, it, expect } from "vitest";
import { sanitizePastedHtml } from "../paste-sanitize.js";

describe("sanitizePastedHtml", () => {
  it("wraps a bare inline selection (span) in a paragraph instead of leaving it unparseable", () => {
    // Exactly what Chromium/WebKit produce serializing a plain-text
    // selection to text/html: a bare <span> with computed inline styles,
    // no surrounding block. Without the <p> wrap, ProseMirror's parseSlice
    // has no block context to resolve into and TipTap falls back to
    // inserting the raw source string as literal text.
    const html = '<span style="color: rgb(44, 36, 32);">the actual pinned sentence right here.</span>';
    const result = sanitizePastedHtml(html);
    // span itself stays (it's an allowed passthrough tag, just stripped of
    // its inline style) — what matters is the <p> wrapper now giving
    // ProseMirror's parser a block context, instead of a bare top-level
    // span it can't resolve and falls back to embedding as literal text.
    expect(result).toBe("<p><span>the actual pinned sentence right here.</span></p>");
  });

  it("wraps bare inline content with formatting marks intact", () => {
    const html = "<strong>bold</strong> and <em>italic</em>";
    const result = sanitizePastedHtml(html);
    expect(result).toBe("<p><strong>bold</strong> and <em>italic</em></p>");
  });

  it("leaves already block-wrapped content unwrapped (unchanged behavior)", () => {
    const html = "<p>a paragraph</p>";
    expect(sanitizePastedHtml(html)).toBe("<p>a paragraph</p>");
  });

  it("leaves multi-block content unwrapped when any top-level block tag is present", () => {
    const html = "<h2>title</h2><p>body</p>";
    expect(sanitizePastedHtml(html)).toBe("<h2>title</h2><p>body</p>");
  });

  it("still strips disallowed tags and attributes", () => {
    const html = '<script>alert(1)</script><p class="foo" onclick="bad()">safe <span style="color:red">text</span></p>';
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("script");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("class=");
    expect(result).not.toContain("style=");
    expect(result).toContain("safe");
    expect(result).toContain("text");
  });

  it("returns null for empty content", () => {
    expect(sanitizePastedHtml("")).toBeNull();
    expect(sanitizePastedHtml("   ")).toBeNull();
  });

  it("still round-trips a list (block-level, keeps its own structure)", () => {
    const html = '<ul data-type="taskList"><li data-checked="true">done</li></ul>';
    const result = sanitizePastedHtml(html);
    expect(result).toBe('<ul data-type="taskList"><li data-checked="true">done</li></ul>');
  });
});
