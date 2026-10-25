import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { flushSync, createRawSnippet } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Provenance from "../Provenance.svelte";

afterEach(cleanupAll);

function text(s) {
  return createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));
}

describe("Provenance", () => {
  it("renders its line in an inert paragraph", () => {
    const { target } = render(Provenance, { children: text("from the book · kept today") });
    flushSync();
    const el = target.querySelector(".shell-provenance");
    expect(el.tagName).toBe("P");
    expect(el.textContent.trim()).toBe("from the book · kept today");
  });

  it("is never a control", () => {
    // The facts on this line used to be inert ROWS on the pin view — 44px
    // tall, in the column where the taps are, a control that did nothing.
    // A line of text carries no handler, no role and no tab stop, and it
    // never grows one: Chip.test.js's assertion, for Chip's reason.
    const { target } = render(Provenance, { children: text("from the book") });
    flushSync();
    const el = target.querySelector(".shell-provenance");
    expect(el.getAttribute("role")).toBeNull();
    expect(el.getAttribute("tabindex")).toBeNull();
    expect(target.querySelector("button")).toBeNull();
  });

  it("is mono, small and soft — a caption, not a second title", () => {
    // READ FROM SOURCE, Eyebrow.test.js's way: jsdom applies no scoped
    // stylesheet. The face is the type role (mono for what the interface
    // names), and the size and ink are what make it read under the title
    // rather than beside it.
    const src = readFileSync("src/shell/ui/Provenance.svelte", "utf8");
    const match = /\.shell-provenance\s*\{([^}]*)\}/.exec(src);
    expect(match, "no .shell-provenance rule in Provenance.svelte").toBeTruthy();
    const decls = match[1];
    expect(decls).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(decls).toMatch(/font-size:\s*var\(--text-xs\)/);
    expect(decls).toMatch(/color:\s*var\(--ink-soft\)/);
  });
});
