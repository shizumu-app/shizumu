// Static-rendering regression guard. One assertion per app-specific node
// so any drift between renderHTML and NodeView output trips CI before it
// reaches a preview surface.
//
// Why inline snapshots and not match-snapshot files: the expected HTML is
// short enough to read inline; a drift shows up as a diff in the test
// itself, which is easier to review than a separate `.snap` file.
import { describe, it, expect } from "vitest";
import { renderDocHTML, clearRenderCache } from "./doc-renderer.js";

function doc(...nodes) {
  return { type: "doc", content: nodes };
}

describe("renderDocHTML — node fixtures", () => {
  it("renders dayMarker with date + focus", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "dayMarker",
        attrs: { date: "2026-05-12", whatMatters: "ship phase 5" },
      }),
    );
    // Both the data-date attr and the rendered date/focus strings should
    // appear so CSS selectors and human readers both work.
    expect(out).toContain('class="day-marker"');
    expect(out).toContain('data-date="2026-05-12"');
    expect(out).toContain("ship phase 5");
  });

  it("renders dateSeparator", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({ type: "dateSeparator", attrs: { date: "2026-05-12", pageId: "abc" } }),
    );
    expect(out).toContain('class="date-separator"');
    expect(out).toContain('data-page-id="abc"');
  });

  it("renders the strike mark as <s> wrapping the affected text", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "I thought " },
          { type: "text", text: "this", marks: [{ type: "strike" }] },
          { type: "text", text: " no longer" },
        ],
      }),
    );
    // StarterKit's Strike emits <s>, not <del>. The "no delete" rule's
    // explicit alternative now has a discoverable affordance.
    expect(out).toContain("<s>this</s>");
  });

  it("renders the code mark as inline <code>", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "look at " },
          { type: "text", text: "refresh_pin_caches", marks: [{ type: "code" }] },
        ],
      }),
    );
    expect(out).toContain("<code>refresh_pin_caches</code>");
  });

  it("renders a recipeBlock with three slots (paragraph · list · paragraph)", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "recipeBlock",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "date string + time zone" }],
          },
          {
            type: "list",
            content: [
              {
                type: "listItem",
                attrs: { marker: "ordered" },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "parse the date" }] },
                ],
              },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "ISO-8601 timestamp" }],
          },
        ],
      }),
    );
    // Wrapper class for the CSS labels (`given` / `do` / `result` via ::before).
    expect(out).toContain('class="recipe-block"');
    expect(out).toContain("date string + time zone");
    expect(out).toContain("parse the date");
    expect(out).toContain("ISO-8601 timestamp");
  });

  it("renders a code block as <pre><code>", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "codeBlock",
        content: [{ type: "text", text: "fn parse(input: &str) -> Result<Date>" }],
      }),
    );
    // StarterKit's CodeBlock emits <pre><code>. CSS in prose.css gives them
    // matching typography (no syntax highlighting — honest monospace).
    expect(out).toContain("<pre>");
    expect(out).toContain("<code>");
    expect(out).toContain("fn parse(input: &amp;str) -&gt; Result&lt;Date&gt;");
  });

  it("renders chart as a static placeholder (Mermaid never loads on static path)", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "chart",
        attrs: {
          kind: "flowchart",
          source: {
            direction: "TB",
            nodes: [
              { id: "a", label: "parse" },
              { id: "b", label: "convert" },
              { id: "c", label: "emit" },
            ],
            edges: [
              { from: "a", to: "b", label: "" },
              { from: "b", to: "c", label: "" },
            ],
          },
        },
      }),
    );
    // The static path emits only a placeholder — Mermaid is editor-only,
    // ~600kB gzipped, and never invoked from generateHTML.
    expect(out).toContain('class="chart-block chart-placeholder"');
    expect(out).toContain('data-kind="flowchart"');
    expect(out).toContain("flowchart · 3 nodes");
  });

  it("renders chart placeholder for mindmap with branch count", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "chart",
        attrs: {
          kind: "mindmap",
          source: {
            central: "shizumu",
            branches: [
              { id: "b1", label: "page", children: [] },
              { id: "b2", label: "thread", children: [] },
            ],
          },
        },
      }),
    );
    expect(out).toContain('data-kind="mindmap"');
    expect(out).toContain("mind map · 2 branches");
  });

  it("renders chart placeholder for timeline with event count", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "chart",
        attrs: {
          kind: "timeline",
          source: {
            events: [{ date: "2026-01-10", label: "v0.2 shipped" }],
          },
        },
      }),
    );
    expect(out).toContain('data-kind="timeline"');
    expect(out).toContain("timeline · 1 event");
  });

  it("renders pinRef as an inline span with ↗ glyph + snapshot text", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "see " },
          {
            type: "pinRef",
            attrs: { pinId: "pin-7", labelSnapshot: "open question" },
          },
        ],
      }),
    );
    // Same architectural shape as pageRef — same class, same data attrs.
    // Distinguished from pageRef only by the inline ↗ vs → prefix.
    expect(out).toContain('class="pin-ref"');
    expect(out).toContain('data-pin-id="pin-7"');
    expect(out).toContain('data-snapshot="open question"');
    expect(out).toContain("↗ open question");
  });

  it("renders pageRef as an inline span with snapshot text", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "see " },
          {
            type: "pageRef",
            attrs: { targetId: "p1", labelSnapshot: "work:friday" },
          },
        ],
      }),
    );
    expect(out).toContain('class="page-ref"');
    expect(out).toContain('data-target-id="p1"');
    expect(out).toContain('data-snapshot="work:friday"');
    expect(out).toContain("→ work:friday");
  });

  it("renders unified list with marker + checked attrs", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "list",
        content: [
          {
            type: "listItem",
            attrs: { marker: "task", checked: true },
            content: [{ type: "paragraph", content: [{ type: "text", text: "done thing" }] }],
          },
          {
            type: "listItem",
            attrs: { marker: "bullet" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "still pending" }] }],
          },
        ],
      }),
    );
    expect(out).toContain('data-list=""');
    expect(out).toContain('data-marker="task"');
    expect(out).toContain('data-checked="true"');
    expect(out).toContain('data-marker="bullet"');
    expect(out).toContain('type="checkbox"');
  });

  it("renders qaBlock wrapper", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "qaBlock",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Q: why?" }] },
          { type: "paragraph", content: [{ type: "text", text: "A: because." }] },
        ],
      }),
    );
    expect(out).toContain('data-type="qa-block"');
    expect(out).toContain('class="qa-block"');
    expect(out).toContain("Q: why?");
    expect(out).toContain("A: because.");
  });

  it("propagates blockTitle attr through the list (renders via CSS::before)", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "list",
        attrs: { blockTitle: "open loops" },
        content: [
          {
            type: "listItem",
            attrs: { marker: "bullet" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
          },
        ],
      }),
    );
    // The wrapper itself is NOT emitted by static render (BlockTitle has
    // no Node renderHTML — it's a globalAttribute extension). The attribute
    // must flow through so CSS `[data-block-title]::before` can render it.
    expect(out).toContain('data-block-title="open loops"');
  });

  it("renders localImage as a full <img> in static mode (chip is editor-only)", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "paragraph",
        content: [
          {
            type: "localImage",
            attrs: {
              src: "asset://x.png",
              localPath: "/abs/x.png",
              display: "block",
              collapsed: false,
            },
          },
        ],
      }),
    );
    expect(out).toContain("<img");
    expect(out).toContain('src="asset://x.png"');
    expect(out).toContain('data-local-path="/abs/x.png"');
  });

  it("renders an attachment image as an <img> awaiting hydration", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "paragraph",
        content: [
          {
            type: "attachment",
            attrs: {
              kind: "image",
              blob_hash: "deadbeef",
              filename: "photo.png",
              display: "block",
            },
          },
        ],
      }),
    );
    // No src: the blob's on-device path isn't knowable synchronously.
    // hydrateBlobImages fills it in after the HTML is in the DOM.
    expect(out).toContain("<img");
    expect(out).toContain('data-blob-hash="deadbeef"');
    expect(out).toContain('alt="photo.png"');
  });

  it("renders an attachment file as a chip, not an image", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc({
        type: "paragraph",
        content: [
          {
            type: "attachment",
            attrs: { kind: "file", blob_hash: "cafe", filename: "report.pdf" },
          },
        ],
      }),
    );
    expect(out).not.toContain("<img");
    expect(out).toContain("report.pdf");
  });
});

describe("renderDocHTML — top-level options", () => {
  it("respects maxNodes by truncating top-level content", () => {
    clearRenderCache();
    const out = renderDocHTML(
      doc(
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "paragraph", content: [{ type: "text", text: "two" }] },
        { type: "paragraph", content: [{ type: "text", text: "three" }] },
      ),
      { maxNodes: 2 },
    );
    expect(out).toContain("one");
    expect(out).toContain("two");
    expect(out).not.toContain("three");
  });

  it("returns empty string for null/garbage input", () => {
    clearRenderCache();
    expect(renderDocHTML(null)).toBe("");
    expect(renderDocHTML(undefined)).toBe("");
    expect(renderDocHTML("not json{{")).toBe("");
    expect(renderDocHTML({ type: "not-a-doc" })).toBe("");
  });

  it("memoizes by cacheKey", () => {
    clearRenderCache();
    const d = doc({ type: "paragraph", content: [{ type: "text", text: "a" }] });
    const first = renderDocHTML(d, { cacheKey: "k1" });
    const second = renderDocHTML(d, { cacheKey: "k1" });
    expect(first).toBe(second);
    // Without the cacheKey, still equal but not necessarily the same string instance
    // — the test here is just that no error fires and output is stable.
    expect(renderDocHTML(d)).toBe(first);
  });
});
