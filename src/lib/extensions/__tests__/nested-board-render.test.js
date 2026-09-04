// Issue #3. Typing "> " at the head of a line already inside an outline
// looked like the app ate the characters. It did not: the input rule fired,
// the doc nested a blockquote inside a blockquote, and the nested board
// rendered with no chrome and no indentation whatsoever — pixel-identical
// to a sibling paragraph. Nothing on screen changed, so the only reading
// available to the user was "my keystrokes vanished".
//
// createBoardNodeView drops the block-shell for any nested board, a
// decision taken for a board sitting inside a LIST ITEM, where the item's
// own grid supplies the indent. A board nested anywhere else gets its
// indent from nowhere.
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { buildEditingExtensions } from "../../render/shared-extensions.js";

// Every test here constructs a real editor over the full extension set,
// which is seconds of work when the whole suite is running in parallel on a
// loaded machine. The 5s default is there to catch a hang, not to police
// legitimate setup cost, and these timed out against it in a full run while
// passing in isolation.
vi.setConfig({ testTimeout: 30000 });

let editor = null;
afterEach(() => { editor?.destroy(); editor = null; });

function mount(content) {
  const host = document.createElement("div");
  host.className = "prose";
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: buildEditingExtensions({}), content });
  return host;
}

const quote = (...content) => ({ type: "blockquote", content });
const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const list = (...content) => ({ type: "list", content });
const item = (...content) => ({ type: "listItem", attrs: { marker: "bullet" }, content });

describe("a nested board is visible", () => {
  it("an outline inside an outline carries the nested marker class", () => {
    const host = mount({ type: "doc", content: [quote(para("outer"), quote(para("inner")))] });
    const inner = host.querySelector(".board-content .board-nested");
    expect(inner, "the nested outline must be marked so CSS can indent it").not.toBe(null);
    expect(inner.querySelector("blockquote")).not.toBe(null);
  });

  it("a top-level board still gets the full shell — title slot and chip", () => {
    const host = mount({ type: "doc", content: [quote(para("outer"))] });
    const shell = host.querySelector(".block-shell[data-board='blockquote']");
    expect(shell).not.toBe(null);
    expect(shell.querySelector(".board-title-slot")).not.toBe(null);
    expect(shell.querySelector(".block-type-chip")?.textContent).toBe("outline");
  });

  it("a nested board still gets NO title slot and NO chip (decision B stands)", () => {
    const host = mount({ type: "doc", content: [quote(para("outer"), quote(para("inner")))] });
    const inner = host.querySelector(".board-content .board-nested");
    expect(inner.querySelector(".board-title-slot")).toBe(null);
    expect(inner.querySelector(".block-type-chip")).toBe(null);
  });

  it("a list nested in a list item is marked the same way — the CSS, not the JS, decides", () => {
    const host = mount({
      type: "doc",
      content: [list(item(para("a"), list(item(para("a.1")))))],
    });
    expect(host.querySelector("li .board-nested")).not.toBe(null);
  });
});

// The class only matters if the stylesheet acts on it. The indent goes
// through the real cascade; the hairline is read off the rule instead,
// because jsdom drops a `border-left` shorthand whose colour contains a
// var() — it does the same to the .block-shell rule that has shipped for
// months, so a computed-style assertion here would test the harness.
describe("prose.css marks a nested board unless a list item already indents it", () => {
  let sheet;
  beforeAll(() => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../../../styles/prose.css"),
      "utf8",
    );
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    sheet = style.sheet;
  });

  const ruleFor = (selector) =>
    [...sheet.cssRules].find((r) => r.selectorText === selector);

  it("declares a left region mark for a board nested inside an outline", () => {
    const rule = ruleFor(".prose blockquote.board-content > .board-nested");
    expect(rule, "the JS marker alone paints nothing").toBeTruthy();
    expect(rule.style.getPropertyValue("border-left")).toMatch(/solid/);
  });

  it("indents an outline nested in an outline", () => {
    const host = mount({ type: "doc", content: [quote(para("outer"), quote(para("inner")))] });
    const inner = host.querySelector(".board-content .board-nested");
    expect(parseFloat(getComputedStyle(inner).paddingLeft)).toBeGreaterThan(0);
  });

  // A list item's grid already indents its children and a decision/recipe/
  // q&a slot already labels them, so the mark is scoped away from both. The
  // VR fixture pageWithDecisionContent nests a list inside a decisionBlock;
  // marking that would have moved a baseline for a block that was never
  // invisible.
  it("does not indent a board nested in a list item", () => {
    const host = mount({
      type: "doc",
      content: [list(item(para("a"), list(item(para("a.1")))))],
    });
    const inner = host.querySelector("li .board-nested");
    expect(parseFloat(getComputedStyle(inner).paddingLeft) || 0).toBe(0);
  });

  it("does not indent a list inside a decision block — the slot labels it", () => {
    const host = mount({
      type: "doc",
      content: [
        {
          type: "decisionBlock",
          content: [
            list(item(para("keep the discrete trail"))),
            para("switch to continuous"),
            para("because it reads as one document"),
          ],
        },
      ],
    });
    const inner = host.querySelector(".decision-block .board-nested");
    expect(inner, "shape check: the fixture must actually produce a nested board").not.toBe(null);
    expect(parseFloat(getComputedStyle(inner).paddingLeft) || 0).toBe(0);
  });
});
