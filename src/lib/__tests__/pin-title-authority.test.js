// Issue #1. A pin's title has exactly one home, and which home depends on
// the node it was pinned from. Getting this wrong is not cosmetic: writing
// a title to the node when the node cannot hold it drops it on the floor
// (the schema discards an attr it never declared), which is how renaming a
// note pin "worked" in the UI and was gone on the next save.
import { describe, it, expect } from "vitest";
import { pinTitleAuthority, pinNodeType } from "../pin-title-authority.js";

const doc = (node) => JSON.stringify({ type: "doc", content: [node] });

describe("pinNodeType", () => {
  it("reads the node type out of a doc-wrapped cache", () => {
    expect(pinNodeType({ content: doc({ type: "list" }) })).toBe("list");
  });

  it("reads it out of a bare node cache (what refresh_pin_caches writes)", () => {
    expect(pinNodeType({ content: JSON.stringify({ type: "blockquote" }) })).toBe("blockquote");
  });

  it("prefers the live node when the page holds one", () => {
    expect(pinNodeType({ content: doc({ type: "paragraph" }) }, { type: "list" })).toBe("list");
  });

  it("is null for a plain-text note cache — older note pins store prose", () => {
    expect(pinNodeType({ content: "just some words i kept" })).toBe(null);
  });

  it("is null rather than throwing on junk", () => {
    expect(pinNodeType({ content: "{ not json" })).toBe(null);
    expect(pinNodeType({})).toBe(null);
    expect(pinNodeType(null)).toBe(null);
  });
});

describe("pinTitleAuthority", () => {
  it("gives boards to the node — the slot is on the page, the user sees it", () => {
    for (const t of ["list", "blockquote", "qaBlock", "recipeBlock", "decisionBlock", "table", "chart", "codeBlock"]) {
      expect(pinTitleAuthority({ content: doc({ type: t }) })).toBe("node");
    }
  });

  it("gives a pinned paragraph or heading to the row", () => {
    expect(pinTitleAuthority({ content: doc({ type: "paragraph" }) })).toBe("row");
    expect(pinTitleAuthority({ content: doc({ type: "heading" }) })).toBe("row");
  });

  it("gives a file pin to the row — the attachment is inline, the pinned node is its paragraph", () => {
    // object_type "file" is grouped with boards in the panel's isBoard(),
    // which is why routing a rename on isBoard() and not on the NODE was
    // wrong: a file pin's title has nowhere to live in the doc.
    expect(
      pinTitleAuthority({
        object_type: "file",
        content: doc({ type: "paragraph", content: [{ type: "attachment" }] }),
      }),
    ).toBe("row");
  });

  it("gives a plain-text note to the row", () => {
    expect(pinTitleAuthority({ content: "a thought" })).toBe("row");
  });
});
