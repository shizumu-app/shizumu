import { describe, it, expect } from "vitest";
import { pageNavStep } from "../page-nav-keys.js";

// A target whose closest() answers like the DOM would for a node inside
// (or outside) a text field.
const inside = (selector) => ({ closest: (s) => (s.includes(selector) ? {} : null) });
const editor = inside(".ProseMirror");
const input = inside("input");
const body = { closest: () => null };

const key = (k, target, mods = {}) => ({ key: k, target, ctrlKey: true, ...mods });

describe("pageNavStep", () => {
  it("mod+←/→ turns the page when the caret is not in text", () => {
    expect(pageNavStep(key("ArrowLeft", body))).toBe(-1);
    expect(pageNavStep(key("ArrowRight", body))).toBe(1);
    expect(pageNavStep(key("ArrowRight", body, { ctrlKey: false, metaKey: true }))).toBe(1);
  });

  it("mod+←/→ in the writing moves by a word and leaves the page alone (issue #2)", () => {
    // 0 because the editor owns the key: ctrl+arrow is word movement in
    // every text editor, and turning the page took the writer away mid-line.
    expect(pageNavStep(key("ArrowLeft", editor))).toBe(0);
    expect(pageNavStep(key("ArrowRight", editor))).toBe(0);
    expect(pageNavStep(key("ArrowRight", input))).toBe(0);
  });

  it("mod+PageUp/PageDown turns the page from anywhere, the writing included", () => {
    expect(pageNavStep(key("PageUp", editor))).toBe(-1);
    expect(pageNavStep(key("PageDown", editor))).toBe(1);
    expect(pageNavStep(key("PageDown", body))).toBe(1);
  });

  it("shift or alt with the arrows is a selection or a block move, not a page turn", () => {
    // 0: ctrl+shift+arrow selects a word, alt+arrow belongs to block moves.
    expect(pageNavStep(key("ArrowLeft", body, { shiftKey: true }))).toBe(0);
    expect(pageNavStep(key("ArrowRight", body, { altKey: true }))).toBe(0);
  });

  it("needs the mod key", () => {
    // 0: a bare arrow or PageDown scrolls or moves the caret.
    expect(pageNavStep(key("ArrowLeft", body, { ctrlKey: false }))).toBe(0);
    expect(pageNavStep(key("PageDown", editor, { ctrlKey: false }))).toBe(0);
  });
});
