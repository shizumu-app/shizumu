import { describe, it, expect } from "vitest";
import { renderDocHTML } from "../../lib/render/doc-renderer.js";
import { pinArtifactDoc, pinArtifactHeader, pinArtifactRows } from "../pin-artifact-view.js";

const note = (over = {}) => ({
  id: "pin-1",
  lineage_id: "L1",
  source_page_id: "page-1",
  object_type: "note",
  title: "the second reader",
  content: "what the trail is for",
  ...over,
});

/** A board pin as `refresh_pin_caches` really stores one: a BARE node,
 *  with no doc wrapper. This shape is the whole reason this module exists
 *  — see `renders every stored shape` below. */
const bareTable = () =>
  note({
    object_type: "board",
    content: JSON.stringify({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "scope" }] }] },
          ],
        },
      ],
    }),
  });

/** The other stored shape: doc-wrapped, from the pre-rewrite sync code. */
const wrappedQuote = () =>
  note({
    object_type: "board",
    content: JSON.stringify({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "not time" }] }],
        },
      ],
    }),
  });

describe("pinArtifactDoc — the three shapes the database really holds", () => {
  it("wraps a bare node so the renderer will take it at all", () => {
    // THE DEFECT THIS MODULE WAS EXTRACTED FOR. `refresh_pin_caches` stores
    // bare-node JSON, and `renderDocHTML`'s second guard is
    // `if (!doc || doc.type !== "doc") return ""` — it does not throw, it
    // returns an empty string, so a board pin handed straight to it paints
    // a blank screen with nothing in the console. The assertion is against
    // the RENDERER rather than against the shape, because the shape is only
    // interesting for what the renderer does with it.
    const doc = pinArtifactDoc(bareTable());
    expect(doc.type).toBe("doc");
    expect(renderDocHTML(doc)).toContain("scope");
  });

  it("passes a doc-wrapped pin through", () => {
    expect(renderDocHTML(pinArtifactDoc(wrappedQuote()))).toContain("not time");
  });

  it("turns a note's plain text into paragraphs", () => {
    const doc = pinArtifactDoc(note({ content: "first\nsecond" }));
    expect(doc.content.map((n) => n.content?.[0]?.text)).toEqual(["first", "second"]);
  });

  it("keeps a blank line as an empty paragraph rather than dropping it", () => {
    // The writer's own break between two thoughts is part of what they
    // kept. Dropping it would re-flow their note on the way back to them.
    const doc = pinArtifactDoc(note({ content: "first\n\nsecond" }));
    expect(doc.content).toHaveLength(3);
    expect(doc.content[1]).toEqual({ type: "paragraph" });
  });
});

describe("pinArtifactDoc — the legacy schema pins are frozen in", () => {
  it("migrates a legacy list, which the current schema cannot render at all", () => {
    // Not cosmetic. READONLY_EXTENSIONS no longer carries `bulletList` /
    // `listItem`, so `generateHTML` THROWS on this content and
    // `renderDocHTML` catches it and returns "" — a blank screen. A pin is
    // a frozen snapshot, so the OLDEST pins in a tree are the likeliest to
    // hold the oldest schema, which makes this the common case rather than
    // the edge one. The un-migrated control below is what makes the claim
    // falsifiable: if `renderDocHTML` grew a tolerance for legacy lists,
    // this test would still pass on the migration doing nothing, and the
    // second expectation is what would go red instead.
    const legacy = note({
      object_type: "board",
      content: JSON.stringify({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "the blocker" }] }],
          },
        ],
      }),
    });
    expect(renderDocHTML(pinArtifactDoc(legacy))).toContain("the blocker");
    expect(
      renderDocHTML({
        type: "doc",
        content: [JSON.parse(legacy.content)],
      }),
      "renderDocHTML rendered a legacy list unaided — the migration above is no longer what makes this work",
    ).toBe("");
  });

  it("migrates a legacy algorithmBlock the same way", () => {
    const legacy = note({
      object_type: "board",
      content: JSON.stringify({
        type: "algorithmBlock",
        content: [{ type: "paragraph", content: [{ type: "text", text: "step one" }] }],
      }),
    });
    expect(renderDocHTML(pinArtifactDoc(legacy))).toContain("step one");
  });
});

describe("pinArtifactDoc — when there is nothing to show", () => {
  it("shows nothing rather than schema for a JSON-shaped string that will not parse", () => {
    // NOT an empty-result-means-fine assertion: the alternative to null
    // here is rendering `{"type":"doc"` as the writer's own words. This is
    // the same row `pinNoteDraft` withholds the editor's body field for
    // (pin-draft.js), and the screen's empty state says so in words.
    expect(pinArtifactDoc(note({ content: '{"type":"doc"' }))).toBeNull();
  });

  it("shows nothing for a pin that cached no content", () => {
    // Each of these is a pin the screen must not render a blank `.prose`
    // block for — an empty bordered column reads as a render that failed,
    // where the empty state reads as a pin with nothing behind it.
    expect(pinArtifactDoc(note({ content: null }))).toBeNull();
    expect(pinArtifactDoc(note({ content: "" }))).toBeNull();
    expect(pinArtifactDoc(note({ content: "   " }))).toBeNull();
    expect(pinArtifactDoc(null)).toBeNull();
  });

  it("shows nothing for JSON that parses to something with no node type", () => {
    // `{"a":1}` parses and is an object, and `{type: "doc", content: [it]}`
    // would hand the renderer a node the schema has no name for.
    expect(pinArtifactDoc(note({ content: '{"a":1}' }))).toBeNull();
    expect(pinArtifactDoc(note({ content: "[1,2]" }))).toBeNull();
  });
});

/** An image pin: no readable text at all, so `pinRowLabel` falls all the
 *  way through to the kind. The one shape where title and kind agree. */
const image = () =>
  note({
    object_type: "file",
    title: null,
    content: JSON.stringify({
      type: "attachment",
      attrs: { kind: "image", blob_hash: "abc", filename: "shape.png" },
    }),
  });

describe("pinArtifactHeader", () => {
  it("names the SURFACE in the bar, whatever kind of pin it holds", () => {
    // Twice reconsidered, so the reasoning is in pin-artifact-view.js's own
    // docstring rather than here. In short: the bar held the pin's label
    // (said twice on a phone), then the kind, and now `pin` — the way
    // `pins` and `memory` name their surfaces. The kind is apparent from
    // the writing directly under it, and the duplication this screen
    // actually had came from the title field, which pin-draft.js ended.
    expect(pinArtifactHeader(note())).toEqual({ title: "pin", subtitle: "" });
    expect(pinArtifactHeader(bareTable())).toEqual({ title: "pin", subtitle: "" });
    expect(pinArtifactHeader(image())).toEqual({ title: "pin", subtitle: "" });
    // Including the state the host cannot currently produce: one answer.
    expect(pinArtifactHeader(null)).toEqual({ title: "pin", subtitle: "" });
  });

  it("keeps the bar to one line whatever the pin's shape", () => {
    expect(pinArtifactHeader(note({ title: null })).subtitle).toBe("");
    expect(pinArtifactHeader(image()).subtitle).toBe("");
  });

  it("names the screen before a pin reaches it", () => {
    // The host guards on the pin before pushing, so this is the bar's
    // answer for a state the app cannot currently produce rather than one
    // it can — a title, because NavBar with an empty one is a bare back
    // arrow over nothing.
    expect(pinArtifactHeader(null)).toEqual({ title: "pin", subtitle: "" });
  });
});

describe("pinArtifactRows", () => {
  const ids = (pin) => pinArtifactRows(pin).map((r) => r.id);

  it("offers the way back, the carry and the unpin, in that order", () => {
    // The facts that used to open this list — `from <trail>`, `source
    // removed`, the divergence — are the provenance line now
    // (provenance.js), so every row here is a thing that can be DONE.
    expect(pinArtifactRows(note())).toEqual([
      { id: "source", label: "open the page it came from", kind: "push" },
      { id: "carry", label: "carry forward", kind: "action" },
      { id: "unpin", label: "unpin", kind: "action" },
    ]);
  });

  it("names what the next tap does on the carry, not what the pin is", () => {
    expect(pinArtifactRows(note({ auto_insert: true })).map((r) => r.label)).toEqual([
      "open the page it came from",
      "stop carrying forward",
      "unpin",
    ]);
  });

  it("offers an orphan its unpin and nothing else", () => {
    // CLAUDE.md's pin pointer clause from both ends: the pin survives with
    // its cache, and the page it points at does not — so there is no way
    // back to offer. And no carry: get_carry_forward_pins reads the flag
    // with `AND so.status != 'orphaned'`, so the toggle would write a
    // column nothing can ever read back.
    expect(ids(note({ status: "orphaned" }))).toEqual(["unpin"]);
  });

  it("withholds carry forward from a pin with no trail", () => {
    // `so.lineage_id = ?1` — NULL never equals an id, so the flag on an
    // untrailed pin changes nothing the writer can observe.
    expect(ids(note({ lineage_id: null }))).toEqual(["source", "unpin"]);
  });

  it("offers no way back for a pin that never recorded a source page", () => {
    expect(ids(note({ source_page_id: null }))).toEqual(["carry", "unpin"]);
    expect(ids(note({ source_page_id: "" }))).toEqual(["carry", "unpin"]);
  });

  it("still offers the way back on a diverged pin", () => {
    // Diverged is a fact about the cache, not about the page: the page is
    // there, and the line says `changed elsewhere`.
    expect(ids(note({ status: "diverged" }))).toEqual(["source", "carry", "unpin"]);
  });

  it("never paints unpin as destructive", () => {
    // The return beat: unpinning is part of the model, not a failure of
    // it. `action`, the same kind as its neighbour, and last.
    const rows = pinArtifactRows(note());
    expect(rows[rows.length - 1]).toEqual({ id: "unpin", label: "unpin", kind: "action" });
  });

  it("offers the pin's trail after the way back, when the host can change it", () => {
    // The trail row names where the pin lives and opens the trail picker
    // (trail-manage.js's pinTrailRows). Before the carry, because the
    // carry is about the trail and reads after it.
    expect(pinArtifactRows(note(), { trail: "the book" })).toEqual([
      { id: "source", label: "open the page it came from", kind: "push" },
      { id: "trail", label: "trail", value: "the book", kind: "choice" },
      { id: "carry", label: "carry forward", kind: "action" },
      { id: "unpin", label: "unpin", kind: "action" },
    ]);
  });

  it("offers an orphan its trail too", () => {
    // The orphan still lives on a trail and is listed on that trail's pins;
    // moving it needs no source page.
    expect(pinArtifactRows(note({ status: "orphaned" }), { trail: "no trail" }).map((r) => r.id)).toEqual([
      "trail",
      "unpin",
    ]);
  });

  it("offers nothing for no pin", () => {
    // Empty is the honest answer: the screen shows its "did not open"
    // state instead, and a row under that would be a control over nothing.
    expect(pinArtifactRows(null)).toEqual([]);
  });
});
