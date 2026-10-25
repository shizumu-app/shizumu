import { describe, it, expect } from "vitest";
import { blockElementFor, focusEscapesProse } from "../block-focus.js";

/** A ProseMirror-shaped tree: a root with top-level blocks, one of which is
 *  a table whose title is an input several levels down. */
function tree() {
  const root = document.createElement("div");
  root.className = "ProseMirror";
  const para = document.createElement("p");
  const table = document.createElement("div");
  table.dataset.kind = "table";
  const header = document.createElement("div");
  const title = document.createElement("input");
  header.appendChild(title);
  table.appendChild(header);
  root.append(para, table);
  return { root, para, table, title };
}

describe("blockElementFor", () => {
  it("walks a title input up to the block it belongs to", () => {
    // The report: tapping a table's own name left the handle absent, because
    // the input is not prose and the selection never moved.
    const { root, table, title } = tree();
    expect(blockElementFor(title, root)).toBe(table);
  });

  it("answers a top-level block with itself", () => {
    const { root, para } = tree();
    expect(blockElementFor(para, root)).toBe(para);
  });

  it("refuses the editor root, which is not a block", () => {
    // Focus lands on the root when the doc is empty. Answering it would
    // point the handle at a node that does not exist.
    const { root } = tree();
    expect(blockElementFor(root, root)).toBeNull();
  });

  it("refuses an element outside the editor", () => {
    // A toolbar button, a sheet's field. These take focus constantly and
    // none of them is a block — answering one would park the handle beside
    // whichever block was nearest the last caret.
    const { root } = tree();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    expect(blockElementFor(outside, root)).toBeNull();
  });

  it("answers nothing when there is no editor to walk inside", () => {
    expect(blockElementFor(document.createElement("input"), null)).toBeNull();
    expect(blockElementFor(null, document.createElement("div"))).toBeNull();
  });
});

describe("focusEscapesProse", () => {
  it("is true for the fields a NodeView owns", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(focusEscapesProse(document.createElement(tag)), tag).toBe(true);
    }
  });

  it("is true for a region ProseMirror explicitly does not manage", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "false");
    expect(focusEscapesProse(el)).toBe(true);
  });

  it("is false for prose", () => {
    // NOT "nothing happens": when the caret is in prose the selection
    // already answers and computeSnapshot is right. A second opinion from
    // the DOM could only disagree with it.
    expect(focusEscapesProse(document.createElement("p"))).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(focusEscapesProse(null)).toBe(false);
  });
});
