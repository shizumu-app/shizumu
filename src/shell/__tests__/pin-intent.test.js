import { describe, it, expect } from "vitest";
import { pinIntent, TITLE_MAX, UNTITLED } from "../pin-intent.js";

// A block descriptor with the shape ShellApp reads off the editor. Every
// test below overrides only the fields it is about, so a field that grows
// a default here changes every case at once rather than in twenty places.
function block(over = {}) {
  return {
    pos: 0,
    isBoard: false,
    isAttachment: false,
    pinned: false,
    hasContent: true,
    text: "",
    blockTitle: "",
    filename: "",
    kind: null,
    ...over,
  };
}

const paragraph = (text, over = {}) => block({ text, kind: null, ...over });
const list = (text, over = {}) => block({ text, isBoard: true, kind: "list", ...over });

describe("pinIntent — what gets pinned", () => {
  it("pins the caret's own block", () => {
    const intent = pinIntent({ scope: "block", blocks: [paragraph("kept going", { pos: 4 })] });
    expect(intent.positions).toEqual([4]);
  });

  it("pins every block a selection touches, whole", () => {
    // The range's own from/to never appear in the answer, and that is the
    // behaviour rather than a simplification: confirmPin stamps TOP-LEVEL
    // positions onto the source nodes, and half a paragraph has no
    // top-level position to stamp. So a range dragged through the middle
    // of two paragraphs pins both of them entire — the same thing the
    // desktop's handlePinSelection does.
    const intent = pinIntent({
      scope: "selection",
      blocks: [paragraph("first", { pos: 0 }), paragraph("second", { pos: 7 })],
      selectionText: "rst sec",
    });
    expect(intent.positions).toEqual([0, 7]);
  });

  it("declines a block with nothing in it", () => {
    // NOT a "nothing happens" assertion left unexplained. An empty
    // paragraph passes mayPinBlock as false, and a pin is a permanent
    // artifact: pinning it would write a row whose title, content and
    // snippet are all empty, which is the "an 'untitled' card that says
    // nothing" case block-pin-guard.js exists for. The caller renders the
    // button dead on this answer, so null here is what keeps the control
    // from being live-and-inert.
    expect(pinIntent({ scope: "block", blocks: [paragraph("", { hasContent: false })] })).toBeNull();
  });

  it("declines a selection that is only a divider", () => {
    // A node selection on a horizontalRule is a NON-empty selection —
    // `selectionEmpty` is false, so the selection strip is on screen and
    // pin-selection would otherwise be live — over a block with no
    // content in text, attrs or anywhere else (block-pin-guard.js's
    // "NOT exempt, deliberately" note). Same reason as above: the row it
    // would write says nothing.
    const rule = block({ hasContent: false, text: "", kind: null });
    expect(pinIntent({ scope: "selection", blocks: [rule], selectionText: "" })).toBeNull();
  });

  it("keeps a divider that a range merely crosses", () => {
    // `some`, not `every`. A drag from one paragraph past a divider into
    // the next is a range with writing in it; dropping the rule from the
    // middle would pin content the writer did not select.
    const intent = pinIntent({
      scope: "selection",
      blocks: [
        paragraph("above", { pos: 0 }),
        block({ pos: 7, hasContent: false }),
        paragraph("below", { pos: 8 }),
      ],
      selectionText: "above below",
    });
    expect(intent.positions).toEqual([0, 7, 8]);
  });

  it("declines a block that is already pinned", () => {
    // Not a tidiness rule and not a "nothing happens" assertion left
    // unexplained. A node holds ONE pinId, and confirmPin overwrites it
    // with the new row's id — so a second pin of the same block does not
    // sit beside the first, it takes the first's stamp, and
    // refresh_pin_caches then orphans a pin whose id is no longer in the
    // saved content_json. null here is what keeps a kept block kept.
    expect(
      pinIntent({ scope: "block", blocks: [paragraph("kept going", { pinned: true })] }),
    ).toBeNull();
  });

  it("declines a range where any one block is already pinned", () => {
    // `some`, not `every`. The stamp this pin would write lands on every
    // covered position, so one already-pinned block inside a wider
    // selection is one pin about to be orphaned — and it is the block the
    // writer is least likely to be looking at.
    expect(
      pinIntent({
        scope: "selection",
        blocks: [paragraph("one", { pos: 0 }), paragraph("two", { pos: 5, pinned: true })],
        selectionText: "one two",
      }),
    ).toBeNull();
  });

  it("declines when there are no blocks at all", () => {
    // The snapshot is one transaction stale and nodeAt answered null, or
    // the caret is at depth 0 with no node selection. Either way there is
    // no position to stamp and no node to serialise.
    expect(pinIntent({ scope: "block", blocks: [] })).toBeNull();
    expect(pinIntent({})).toBeNull();
  });
});

describe("pinIntent — which category", () => {
  it("calls a paragraph a note", () => {
    expect(pinIntent({ scope: "block", blocks: [paragraph("a sentence")] }).category).toBe("note");
  });

  it("calls a board a board", () => {
    expect(pinIntent({ scope: "block", blocks: [list("milkeggs")] }).category).toBe("board");
  });

  it("calls a line that is only a file a file", () => {
    const file = block({ isAttachment: true, filename: "notes.pdf", kind: "file" });
    expect(pinIntent({ scope: "block", blocks: [file] }).category).toBe("file");
  });

  it("calls a line mixing text and a file a note, not a file", () => {
    // isAttachment means the line is ONLY the attachment
    // (soleAttachmentNode). A line with words beside the file is a line,
    // and pinning it as a "file" would make the row render a 📎 chip
    // handing the blob to the OS instead of showing what was written.
    const mixed = block({ isAttachment: false, text: "see this", kind: null });
    expect(pinIntent({ scope: "block", blocks: [mixed] }).category).toBe("note");
  });

  it("calls a multi-block selection a board even when every block is a paragraph", () => {
    const intent = pinIntent({
      scope: "selection",
      blocks: [paragraph("one", { pos: 0 }), paragraph("two", { pos: 5 })],
      selectionText: "one two",
    });
    expect(intent.category).toBe("board");
  });

  it("calls one word inside one paragraph a note, where the desktop says board", () => {
    // The one place the phone deliberately disagrees with
    // handlePinSelection, which sets category "board" for EVERY selection.
    // pinKind (pin-display.js) has no branch for a board holding a single
    // paragraph, so it falls through to the literal word "board" — a
    // quoted phrase would carry a chip claiming it is a composite.
    const intent = pinIntent({
      scope: "selection",
      blocks: [paragraph("the whole sentence")],
      selectionText: "whole",
    });
    expect(intent.category).toBe("note");
  });
});

describe("pinIntent — what it is called", () => {
  it("takes the selected words when there is a selection", () => {
    const intent = pinIntent({
      scope: "selection",
      blocks: [paragraph("the whole sentence")],
      selectionText: "whole sentence",
    });
    expect(intent.title).toBe("whole sentence");
  });

  it("takes the block's own words when there is no selection", () => {
    expect(pinIntent({ scope: "block", blocks: [paragraph("kept going")] }).title).toBe(
      "kept going",
    );
  });

  it("prefers a name the writer typed over anything derived", () => {
    const named = list("milkeggs", { blockTitle: "shopping" });
    expect(pinIntent({ scope: "block", blocks: [named] }).title).toBe("shopping");
  });

  it("names a board by its kind rather than by its run-together items", () => {
    // node.textContent joins a list's items with NO separator, so the
    // text of a two-item list is "milkeggs" — not a name and not even a
    // phrase. handlePinBlock reached the same answer through the DOM;
    // this reaches it from the node.
    expect(pinIntent({ scope: "block", blocks: [list("milkeggs")] }).title).toBe("list");
    const table = block({ isBoard: true, text: "abcd", kind: "table" });
    expect(pinIntent({ scope: "block", blocks: [table] }).title).toBe("table");
    const quote = block({ isBoard: true, text: "a point", kind: "outline" });
    expect(pinIntent({ scope: "block", blocks: [quote] }).title).toBe("outline");
  });

  it("names a file by its filename", () => {
    const file = block({ isAttachment: true, filename: "budget.xlsx", kind: "file", text: "" });
    expect(pinIntent({ scope: "block", blocks: [file] }).title).toBe("budget.xlsx");
  });

  it("names a chart by its kind, since an atom has no text at all", () => {
    // A chart is atom: true with its whole dataset in attrs, so
    // node.textContent is "" however full it is. mayPinBlock exempts it,
    // which means it reaches the title ladder with nothing but its kind.
    const chart = block({ isBoard: true, text: "", kind: "flowchart" });
    expect(pinIntent({ scope: "block", blocks: [chart] }).title).toBe("flowchart");
  });

  it("falls to untitled only when the block has content and no name of any sort", () => {
    // The floor, reached in practice by an attachment whose attrs lost
    // their filename. Asserted here rather than left as an unreachable
    // branch: the module takes descriptors, so the case is drivable even
    // though the editor rarely produces it.
    const nameless = block({ isAttachment: true, filename: "", kind: null, text: "" });
    expect(pinIntent({ scope: "block", blocks: [nameless] }).title).toBe(UNTITLED);
  });

  it("collapses newlines and runs of space", () => {
    // A title is one line by the time anything renders it —
    // pinDisplayTitle splits on "\n" and keeps the first — so a stored
    // newline silently truncates the title at the break.
    const intent = pinIntent({
      scope: "selection",
      blocks: [paragraph("x", { pos: 0 }), paragraph("y", { pos: 3 })],
      selectionText: "first line\n\nsecond   line",
    });
    expect(intent.title).toBe("first line second line");
  });

  it("caps at 60 and appends no ellipsis", () => {
    // The two reasons, from the module header: pinDisplayTitle already
    // elides at 60 and adds its own "…", so a stored one would be elided
    // twice; and pinSearchText matches the RAW title, where an ellipsis
    // the writer never typed sits inside the haystack.
    const long = "a".repeat(200);
    const title = pinIntent({ scope: "block", blocks: [paragraph(long)] }).title;
    expect(title).toHaveLength(TITLE_MAX);
    expect(title.endsWith("…")).toBe(false);
    expect(title).toBe("a".repeat(TITLE_MAX));
  });

  it("leaves a title shorter than the cap exactly as written", () => {
    const title = pinIntent({ scope: "block", blocks: [paragraph("short enough")] }).title;
    expect(title).toBe("short enough");
  });
});
