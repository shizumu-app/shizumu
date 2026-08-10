// Round-trip coverage for the Chromium-compatible block copy/paste payload
// (D-3 in the QA sweep findings): writing the custom
// application/x-shizumu-block+json MIME type directly via
// navigator.clipboard.write() throws on Chromium ("Type ... not supported
// on write"), breaking ⎘ copy and Ctrl/Cmd+Shift+C on two of shizumu's
// three shipping engines (Windows/win-webview2, Android/android-webview).
// Fix: embed the block JSON inside the text/html payload as an
// HTML-escaped data-shizumu-block attribute, and write only well-known
// clipboard types. These are the pure serialize/parse halves of that
// round trip.
import { describe, it, expect } from "vitest";
import {
  serializeBlockToHtml,
  parseBlockFromHtml,
  escapeHtmlAttr,
  SHIZUMU_BLOCK_ATTR,
} from "../block-clipboard.js";

describe("block-clipboard round trip", () => {
  it("embeds the node JSON in a data-shizumu-block attribute alongside readable HTML", () => {
    const nodeJson = { type: "recipeBlock", content: [{ type: "paragraph" }] };
    const html = serializeBlockToHtml("<p>given</p>", nodeJson);
    expect(html).toContain("<p>given</p>");
    expect(html).toContain(SHIZUMU_BLOCK_ATTR);
  });

  it("round-trips the exact node JSON through parseBlockFromHtml", () => {
    const nodeJson = {
      type: "qaBlock",
      content: [
        { type: "qaPair", content: [
          { type: "paragraph", content: [{ type: "text", text: "Q1" }] },
          { type: "paragraph", content: [{ type: "text", text: "A1" }] },
        ]},
      ],
    };
    const html = serializeBlockToHtml("<div>Q1 A1</div>", nodeJson);
    const parsed = parseBlockFromHtml(html);
    expect(parsed).toEqual(nodeJson);
  });

  it("plain-text / external paste sees readable text, not raw JSON", () => {
    const nodeJson = { type: "paragraph", content: [{ type: "text", text: "hello & <world>" }] };
    const html = serializeBlockToHtml("<p>hello &amp; &lt;world&gt;</p>", nodeJson);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.body.textContent.trim()).toBe("hello & <world>");
  });

  it("HTML-escapes quotes and angle brackets in the embedded JSON so the attribute can't break out", () => {
    const nodeJson = { type: "paragraph", attrs: { title: '"><img src=x>' } };
    const html = serializeBlockToHtml("<p>x</p>", nodeJson);
    // The raw payload must not appear unescaped in the HTML string.
    expect(html).not.toContain('"><img src=x>');
    const parsed = parseBlockFromHtml(html);
    expect(parsed).toEqual(nodeJson);
  });

  it("returns null when there is no shizumu-block wrapper (plain external HTML)", () => {
    expect(parseBlockFromHtml("<p>just some pasted html</p>")).toBeNull();
  });

  it("returns null for empty/missing html", () => {
    expect(parseBlockFromHtml("")).toBeNull();
    expect(parseBlockFromHtml(null)).toBeNull();
  });

  it("returns null when the embedded attribute isn't valid JSON", () => {
    const html = `<div ${SHIZUMU_BLOCK_ATTR}="not-json">text</div>`;
    expect(parseBlockFromHtml(html)).toBeNull();
  });

  it("escapeHtmlAttr escapes &, \", <, >", () => {
    expect(escapeHtmlAttr(`&"<>`)).toBe("&amp;&quot;&lt;&gt;");
  });
});
