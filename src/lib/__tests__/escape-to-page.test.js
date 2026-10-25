import { describe, it, expect } from "vitest";
import { escapeReturnsToPage } from "../escape-to-page.js";

const inEditor = { closest: (sel) => (sel === ".ProseMirror" ? {} : null) };
const elsewhere = { closest: () => null };

describe("escapeReturnsToPage", () => {
  it("brings the writer back from elsewhere on the screen", () => {
    expect(escapeReturnsToPage({ key: "Escape", target: elsewhere }, { overlayOpen: false })).toBe(true);
  });

  it("leaves an Escape the editor already spent alone", () => {
    // THE regression: Escape walked the caret from a recipe's steps to its
    // result slot, then this handler ran focus("end") and threw it to the
    // bottom of the page. False because the key was already handled.
    expect(escapeReturnsToPage({ key: "Escape", defaultPrevented: true, target: elsewhere }, { overlayOpen: false })).toBe(false);
  });

  it("does not move a caret that is already in the writing", () => {
    // False: the writer is on the page already, and the end of the doc is
    // not where they were.
    expect(escapeReturnsToPage({ key: "Escape", target: inEditor }, { overlayOpen: false })).toBe(false);
  });

  it("leaves an open overlay's Escape to the overlay", () => {
    // False: settings, the trail index and the palette close themselves.
    expect(escapeReturnsToPage({ key: "Escape", target: elsewhere }, { overlayOpen: true })).toBe(false);
  });
});
