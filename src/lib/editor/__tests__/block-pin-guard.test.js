// block-pin-guard.test.js — an entirely empty block used to be pinnable.
//
// Reproduced end to end in the running app: create a `/bullet`, type
// nothing at all, hover, click the gutter's pin handle. The pin popup
// opened; confirming produced a real pin, titled "list", whose whole
// content was the word "list". handlePinBlock's guard was reading
// `hoveredBlock.textContent`, and `hoveredBlock` is the block SHELL —
// `.block-type-chip` is a real `<span>` inside it, so the guard could never
// fire on a board.
//
// The first describe below builds a REAL editor and reads the real DOM, so
// the premise ("the chip is inside the shell, the node is clean") is a
// measured fact here rather than a hand-written string, and stays measured
// if block-shell.js's DOM ever changes.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { ShellTableView } from "../../extensions/table-shell-view.js";
import { blockActionsFor } from "../block-actions.js";
import { UnifiedListExtensions } from "../../extensions/unified-list.js";
import { BlockTitle } from "../../extensions/block-title.js";
import { QABlock } from "../../extensions/qa-block.js";
import { QAPair } from "../../extensions/qa-pair.js";
import { CodeBlockShizumu } from "../../extensions/code-block.js";
import { Attachment } from "../../extensions/attachment.js";
import { Chart } from "../../extensions/chart.js";
import { mayPinBlock, isAttachmentBlockNode, soleAttachmentNode } from "../block-pin-guard.js";

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      // codeBlock: false — the shizumu code block (CodeBlockShizumu) is the
      // one that renders the copy button this file measures; StarterKit's
      // plain node has no NodeView and so no chrome at all.
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false, codeBlock: false }),
      ...UnifiedListExtensions,
      BlockTitle,
      // qaBlock appears in the list schema's content expression, so the
      // schema throws without these two registered.
      QABlock,
      QAPair,
      CodeBlockShizumu,
      Attachment,
      Chart,
      // The table renders its own chip and its own title <input> by hand
      // (table-shell-view.js) — needed by the sheet-row cases below, where
      // an empty table must keep its title row while losing pin/copy.
      Table.configure({ resizable: false, View: ShellTableView }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

/** The facts handlePinBlock has at the guard, read off a real editor:
 *  the top-level DOM block and the top-level ProseMirror node at `index`. */
function factsFor(editor, host, index) {
  const proseMirror = host.querySelector(".ProseMirror");
  const el = proseMirror.children[index];
  const node = editor.state.doc.child(index);
  return { elementText: el?.textContent, nodeText: node?.textContent, el, node };
}

const list = (items) => ({
  type: "list",
  content: items.map((text) => ({
    type: "listItem",
    attrs: { marker: "bullet" },
    content: [text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" }],
  })),
});

describe("mayPinBlock against a real editor's DOM (the live repro)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("refuses an untouched bullet list whose only text is the block-type chip", () => {
    env = makeEditor({ type: "doc", content: [list([""])] });
    const facts = factsFor(env.editor, env.host, 0);

    // The premise, measured rather than assumed: the shell's text is NOT
    // empty (the chip lives inside it) while the node's text is.
    expect(facts.elementText.trim()).not.toBe("");
    expect(facts.el.querySelector(".block-type-chip")).not.toBeNull();
    expect(facts.nodeText.trim()).toBe("");

    expect(mayPinBlock(facts)).toBe(false);
  });

  it("allows a bullet list the user actually wrote in", () => {
    env = makeEditor({ type: "doc", content: [list(["milk", "eggs"])] });
    const facts = factsFor(env.editor, env.host, 0);

    expect(facts.nodeText).toContain("milk");
    expect(mayPinBlock(facts)).toBe(true);
  });

  it("refuses an untouched code block, whose shell text is its copy button", () => {
    env = makeEditor({ type: "doc", content: [{ type: "codeBlock" }] });
    const facts = factsFor(env.editor, env.host, 0);

    // Measured: "copycode" — the copy button plus the chip. Asserted so
    // this "refuses" case is visibly NOT vacuous: the old DOM guard saw
    // text here and let an empty code block through.
    expect(facts.elementText.trim()).toBe("copycode");
    expect(facts.nodeText).toBe("");

    expect(mayPinBlock(facts)).toBe(false);
  });

  it("allows a code block with code in it", () => {
    env = makeEditor({
      type: "doc",
      content: [{ type: "codeBlock", content: [{ type: "text", text: "const sink = true" }] }],
    });
    const facts = factsFor(env.editor, env.host, 0);

    expect(facts.nodeText).toBe("const sink = true");
    expect(mayPinBlock(facts)).toBe(true);
  });

  it("allows an image attachment even though its node text is empty — attachment is an inline atom", () => {
    // THE TRAP. `/image` and `/file` go through this same guard on their way
    // to handlePinBlock's `isBoard || isAttachment` JSON path, which stores
    // the NODE, not text. attachment.js is `inline: true, atom: true`, so
    // ProseMirror's textContent skips it: the line has no text at all and
    // never will, no matter how real the file is. Switching the guard to
    // node text without this exemption would silently stop images and files
    // from being pinnable.
    env = makeEditor({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "attachment", attrs: { filename: "sink.png", mime: "image/png" } }],
      }],
    });
    const facts = factsFor(env.editor, env.host, 0);

    // Measured: node text "" (the atom is skipped) while the rendered chip
    // reads "📎 sink.png 0 B  local ✕" — the filename the user would
    // recognise is DOM-only. Node text alone would refuse this pin.
    expect(facts.nodeText.trim()).toBe("");
    expect(facts.elementText).toContain("sink.png");
    expect(mayPinBlock({ ...facts, hasNonTextContent: true })).toBe(true);
    // And without the exemption it would indeed have been refused — this
    // is the regression the exemption exists to prevent, asserted rather
    // than described.
    expect(mayPinBlock({ ...facts, hasNonTextContent: false })).toBe(false);
  });

  it("allows a chart, whose dataset lives in attrs and never in text", () => {
    // Same shape as the attachment case: chart.js is `atom: true` with the
    // whole series in attrs, so a chart full of data has no more node text
    // than a blank one. Guarding a chart on text would refuse every chart.
    env = makeEditor({
      type: "doc",
      content: [{
        type: "chart",
        attrs: { chartType: "bar", data: [{ label: "mon", value: 3 }] },
      }],
    });
    const facts = factsFor(env.editor, env.host, 0);

    expect(facts.nodeText.trim()).toBe("");
    expect(mayPinBlock({ ...facts, hasNonTextContent: true })).toBe(true);
    expect(mayPinBlock({ ...facts, hasNonTextContent: false })).toBe(false);
  });

  it("allows a plain written paragraph", () => {
    env = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "the rest sinks." }] }],
    });
    const facts = factsFor(env.editor, env.host, 0);

    expect(mayPinBlock(facts)).toBe(true);
  });

  it("refuses an empty paragraph, as the DOM guard already did", () => {
    // The one case the old guard got right — a bare <p> has no NodeView and
    // so no chrome to contaminate it. Asserted so the fix is shown not to
    // have traded one direction of the bug for the other.
    env = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    const facts = factsFor(env.editor, env.host, 0);

    expect(facts.elementText.trim()).toBe("");
    expect(mayPinBlock(facts)).toBe(false);
  });
});

// ── the affordance, not just the flow ────────────────────────────────
// The follow-up defect: the guard above stopped the empty pin, but the
// controls that OFFER it were still computed from `el.textContent` — so
// the gutter and the touch sheet kept showing pin/copy on a block
// handlePinBlock then refused to pin, and the button did nothing. A
// control that does nothing reads as broken; that is how it was reported.
//
// TipTapEditor.svelte now routes all three sites (describeHoverBlock,
// openBlockActionSheet, handlePinBlock) through one blockMayBePinned
// helper that hands mayPinBlock the same facts. These cases lock the
// composition that helper feeds — the row list a block ends up with. The
// end-to-end proof that the component really wires it is the VR state
// `block-actions-sheet` (tests/vr/states.js), which taps a real chip and
// reads the real rows; this is the same contract at unit speed.
describe("the sheet's rows, composed as openBlockActionSheet composes them", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  /** Exactly openBlockActionSheet's composition: DOM facts off the block,
   *  pinnability from mayPinBlock, order from blockActionsFor. */
  function sheetRows({ el, node, hasNonTextContent = false, canConvert = false }) {
    const tag = el.tagName?.toLowerCase();
    const canInsert = tag === "p" || tag === "h1" || tag === "h2" || tag === "h3";
    const canPin = mayPinBlock({
      nodeText: node?.textContent,
      elementText: el.textContent,
      hasNonTextContent,
    });
    return blockActionsFor({
      isBoard: el.classList?.contains("block-shell") || el.classList?.contains("code-block-wrap"),
      hasTitle: !!el.querySelector?.(".board-title-slot"),
      canPin,
      isEmpty: canInsert && !canPin,
      canConvert,
    });
  }

  it("offers pin and copy on a bullet list the user wrote in", () => {
    env = makeEditor({ type: "doc", content: [list(["milk", "eggs"])] });
    const rows = sheetRows({ ...factsFor(env.editor, env.host, 0), canConvert: true });
    expect(rows).toEqual(["pin", "copy", "title", "convert", "delete"]);
  });

  it("drops pin and copy from an untouched bullet list, keeping title and delete", () => {
    env = makeEditor({ type: "doc", content: [list([""])] });
    const facts = factsFor(env.editor, env.host, 0);
    // Not a vacuous "nothing happens": the shell's own text is non-empty
    // (the chip), which is exactly what used to put pin/copy in this list.
    expect(facts.elementText.trim()).not.toBe("");
    expect(sheetRows({ ...facts, canConvert: true }))
      .toEqual(["title", "convert", "delete"]);
  });

  it("drops pin and copy from an empty table — its title row survives", () => {
    // The title is NOT the content: a table whose cells are all empty has
    // nothing to pin even when its title slot is sitting right there. The
    // title row staying is Task 1's regression photograph (an empty board
    // must still be reachable to name and to delete) and must not be
    // weakened to make the pin gating pass.
    env = makeEditor({
      type: "doc",
      content: [{
        type: "table",
        attrs: { blockTitle: "unfilled" },
        content: [{
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [{ type: "paragraph" }] },
            { type: "tableHeader", content: [{ type: "paragraph" }] },
          ],
        }],
      }],
    });
    const facts = factsFor(env.editor, env.host, 0);
    expect(facts.nodeText.trim()).toBe("");
    expect(facts.el.querySelector(".board-title-slot")).not.toBeNull();
    expect(sheetRows(facts)).toEqual(["title", "delete"]);
  });

  it("keeps pin and copy on a table with something in a cell", () => {
    env = makeEditor({
      type: "doc",
      content: [{
        type: "table",
        content: [{
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "day" }] }] },
            { type: "tableHeader", content: [{ type: "paragraph" }] },
          ],
        }],
      }],
    });
    expect(sheetRows(factsFor(env.editor, env.host, 0)))
      .toEqual(["pin", "copy", "title", "delete"]);
  });

  it("keeps pin and copy on an EMPTY chart — a chart's data never lives in its text", () => {
    // The trap in this change. chart.js is `atom: true` with everything in
    // attrs, so text says nothing about whether a chart is empty; the
    // caller passes the exemption and the rows must be unchanged. If this
    // ever goes the other way, page-empty-chart's VR baseline moves too.
    env = makeEditor({ type: "doc", content: [{ type: "chart", attrs: { kind: "flowchart" } }] });
    const facts = factsFor(env.editor, env.host, 0);
    expect(facts.nodeText.trim()).toBe("");
    expect(sheetRows({ ...facts, hasNonTextContent: true }))
      .toEqual(["pin", "copy", "title", "delete"]);
  });

  it("keeps pin and copy on an image line, whose node text is empty by construction", () => {
    env = makeEditor({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "attachment", attrs: { filename: "sink.png", mime: "image/png" } }],
      }],
    });
    const facts = factsFor(env.editor, env.host, 0);
    // A paragraph, so insert-below is in play — and must NOT be offered:
    // an attachment line is not an empty line to insert under.
    expect(sheetRows({ ...facts, hasNonTextContent: true })).toEqual(["pin", "copy", "delete"]);
  });

  it("offers only insert-below on a genuinely empty paragraph", () => {
    // Correct because there is nothing to pin, copy or delete on a bare
    // empty line and it is not a board — the pre-existing behaviour, kept
    // so this change is shown not to have moved the paragraph case.
    env = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    expect(sheetRows(factsFor(env.editor, env.host, 0))).toEqual(["insert-below"]);
  });
});

describe("mayPinBlock's fallback when the DOM block maps to no node", () => {
  it("falls back to the element's text rather than refusing outright", () => {
    // handlePinBlock resolves the node by index into .ProseMirror's
    // children; when that lookup fails (childIndex -1) there is no node to
    // read. A block with no resolvable node is not a NodeView shell either,
    // so it has no chip to leak — the element's own text is the honest
    // fact, and is what the guard used before this fix. Preserved so the
    // change narrows nothing outside the bug it was written for.
    expect(mayPinBlock({ nodeText: null, elementText: "an unmapped line" })).toBe(true);
    expect(mayPinBlock({ nodeText: undefined, elementText: "   " })).toBe(false);
  });

  it("refuses when it is handed nothing at all", () => {
    // Not "nothing happens by accident": with no node, no element and no
    // non-text content, there is provably nothing to put in a pin, and the
    // safe answer to an unanswerable question here is to leave the user's
    // pins alone.
    expect(mayPinBlock()).toBe(false);
    expect(mayPinBlock({})).toBe(false);
  });
});

// ── /image: the pin affordance never appeared ──────────────────────────
// Reported from the running app, and measured there side by side on the
// same build:
//
//     page-image-content   gutter on hover: ["insert"]
//     page-file-content    gutter on hover: ["pin","copy","delete"]
//
// `["insert"]` is the tell: `isEmpty` is `canInsert && !canPin`, so the app
// was classifying an image line as an EMPTY LINE.
//
// The cause was one line in blockPinFacts (TipTapEditor.svelte), which
// decided "is this an attachment" by sniffing a CSS class off the DOM:
//
//     el.classList.contains("attachment-block") || el.querySelector(".attachment-block")
//
// AttachmentBlock.svelte has TWO render branches and only the FILE one
// carries that class; the image branch renders `.local-image-wrap
// .attachment-image`. So the exemption never fired for an image — and an
// attachment is `inline: true, atom: true`, so the paragraph holding it has
// no node text either. Not exempt + no text = empty.
//
// Everything below is read off a REAL editor rendering the REAL Svelte
// NodeView, both branches. The class-sniff facts are asserted, not
// described: a hand-built DOM carrying `.attachment-block` is precisely the
// fabricated shape that let this ship past the cases above.
//
// The fix is not a longer class list. The block's ProseMirror node already
// says what it is, and quickPinFromCursor (Ctrl+P) already read it — which
// is why Ctrl+P pinned an image correctly the whole time while the gutter
// would not even offer the pin. isAttachmentBlockNode is that read, shared
// by both paths so they can no longer disagree.
describe("attachment detection off a real editor, both render branches", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  /** Exactly blockPinFacts's composition (TipTapEditor.svelte), run over a
   *  real editor's DOM block and its real top-level node. */
  function pinFacts(el, node) {
    const dataType = el?.getAttribute?.("data-type");
    return {
      isAttachment: dataType === "attachment" || isAttachmentBlockNode(node),
      isChart: dataType === "chart",
    };
  }

  /** What blockPinFacts USED to ask, kept so the reason each case below
   *  passes stays visible: on a real image line this is false, on a real
   *  file line it is true, and that asymmetry was the whole bug. */
  function shippedClassSniff(el) {
    return !!(el?.classList?.contains?.("attachment-block")
      || el?.querySelector?.(".attachment-block"));
  }

  /** blockMayBePinned + openBlockActionSheet, composed end to end — the
   *  exemption is DERIVED from the block, never handed in by the test. */
  function rowsFor(index) {
    const { el, node } = factsFor(env.editor, env.host, index);
    const facts = pinFacts(el, node);
    const tag = el.tagName?.toLowerCase();
    const canInsert = tag === "p" || tag === "h1" || tag === "h2" || tag === "h3";
    const canPin = mayPinBlock({
      nodeText: node?.textContent,
      elementText: el.textContent,
      hasNonTextContent: facts.isAttachment || facts.isChart,
    });
    return blockActionsFor({
      isBoard: el.classList?.contains("block-shell") || el.classList?.contains("code-block-wrap"),
      hasTitle: !!el.querySelector?.(".board-title-slot"),
      canPin,
      isEmpty: canInsert && !canPin,
      canConvert: false,
    });
  }

  const imageLine = (attrs) => ({
    type: "doc",
    content: [{
      type: "paragraph",
      content: [{
        type: "attachment",
        attrs: {
          kind: "image",
          blob_hash: "b7e2f5c1a9d84630b7f2c5e1a9d84630",
          filename: "the whiteboard sketch.png",
          mime_type: "image/png",
          display: "block",
          collapsed: false,
          ...attrs,
        },
      }],
    }],
  });

  it("offers pin, copy and delete on an image line — not the empty line's insert", () => {
    env = makeEditor(imageLine());
    const { el, node } = factsFor(env.editor, env.host, 0);

    // The premise, measured: the image branch carries none of what the old
    // sniff looked for, and the node has no text to fall back on.
    expect(el.getAttribute("data-type")).toBeNull();
    expect(shippedClassSniff(el)).toBe(false);
    expect(el.querySelector(".attachment-image")).not.toBeNull();
    expect(node.textContent).toBe("");

    expect(rowsFor(0)).toEqual(["pin", "copy", "delete"]);
  });

  it("keeps offering them when the image is COLLAPSED to its filename chip", () => {
    // Issue 2's mechanism, reachable here because the collapsed chip needs
    // no blob to render (it prints node.attrs.filename): the line's DOM text
    // becomes the filename — non-empty — while its NODE text stays empty.
    // Under the pre-6bc66f6 DOM-text guard that mismatch offered a pin the
    // class sniff then failed to categorise as a file, and the generic path
    // produced a pin carrying neither the filename nor the attachment JSON.
    env = makeEditor(imageLine({ collapsed: true }));
    const { el, node } = factsFor(env.editor, env.host, 0);

    expect(el.querySelector(".local-image-chip").textContent)
      .toBe("the whiteboard sketch.png");
    expect(el.textContent).toContain("the whiteboard sketch.png");
    expect(node.textContent).toBe("");
    expect(shippedClassSniff(el)).toBe(false);

    expect(rowsFor(0)).toEqual(["pin", "copy", "delete"]);
    // And the pin it produces is a FILE pin carrying the filename, not a
    // generic one: this is the node handlePinBlock stores as JSON and reads
    // the title off.
    expect(soleAttachmentNode(node)?.attrs?.filename).toBe("the whiteboard sketch.png");
  });

  it("still offers them on a file line — the branch that always worked", () => {
    env = makeEditor({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "attachment", attrs: { kind: "file", filename: "field-notes.pdf" } }],
      }],
    });
    const { el } = factsFor(env.editor, env.host, 0);
    // The asymmetry, asserted: the file branch DOES carry the class the
    // image branch never had. This is why the bug was invisible.
    expect(shippedClassSniff(el)).toBe(true);

    expect(rowsFor(0)).toEqual(["pin", "copy", "delete"]);
  });

  it("treats a line of text with an inline image as a note, not a file pin", () => {
    // isSoleAttachment's job: the whole line is the pin, and the image rides
    // along inside the note's JSON. The block still holds an attachment, so
    // detection is true — but there is no lone attachment to title from.
    env = makeEditor({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "the sketch that started it: " },
          { type: "attachment", attrs: { kind: "image", filename: "sink.png" } },
        ],
      }],
    });
    const { node } = factsFor(env.editor, env.host, 0);

    expect(isAttachmentBlockNode(node)).toBe(true);
    expect(soleAttachmentNode(node)).toBeNull();
    expect(rowsFor(0)).toEqual(["pin", "copy", "delete"]);
  });

  it("says no to a written paragraph — the predicate is not just 'anything'", () => {
    // Not a vacuous negative: a false here is what keeps an ordinary line
    // out of the attachment exemption, so the emptiness guard still gets to
    // refuse a blank one (the case immediately below).
    env = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "the rest sinks." }] }],
    });
    const { node } = factsFor(env.editor, env.host, 0);
    expect(isAttachmentBlockNode(node)).toBe(false);
    expect(soleAttachmentNode(node)).toBeNull();
  });

  it("leaves a blank paragraph offering only insert-below", () => {
    // The regression photograph for the exemption widening: an empty line
    // must NOT become pinnable just because attachment detection moved.
    env = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    expect(rowsFor(0)).toEqual(["insert-below"]);
  });

  it("finds data-type=\"chart\" on the real chart DOM — the sibling sniff is sound", () => {
    // isChart uses the same `dataType === ...` pattern and could have had
    // the same latent bug. It does not: chart.js's NodeView is hand-written
    // JS and sets data-type on its own wrapper (chart.js ~359), unlike the
    // Svelte NodeView an attachment gets, whose wrapper carries none.
    // Measured here rather than assumed, so a move to a Svelte NodeView
    // would surface as this test going red.
    env = makeEditor({ type: "doc", content: [{ type: "chart", attrs: { kind: "flowchart" } }] });
    const { el, node } = factsFor(env.editor, env.host, 0);

    expect(el.getAttribute("data-type")).toBe("chart");
    expect(pinFacts(el, node).isChart).toBe(true);
    expect(isAttachmentBlockNode(node)).toBe(false);
    expect(rowsFor(0)).toEqual(["pin", "copy", "title", "delete"]);
  });
});
