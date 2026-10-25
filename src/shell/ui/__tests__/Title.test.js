import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { flushSync, createRawSnippet } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Title from "../Title.svelte";

afterEach(cleanupAll);

function text(s) {
  return createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));
}

describe("Title", () => {
  it("renders its content as the first-level heading", () => {
    // An h1, not a div: the subject of the screen is the first thing a
    // reader moving by headings should land on, above any group eyebrow.
    const { target } = render(Title, { children: text("the second reader") });
    flushSync();
    const el = target.querySelector(".shell-title");
    expect(el.tagName).toBe("H1");
    expect(el.textContent.trim()).toBe("the second reader");
  });

  it("is prose, a size above the body, and not bold", () => {
    // READ FROM SOURCE: jsdom applies no scoped stylesheet, so nothing
    // rendered can tell a Lora title from a mono one. This holds the face
    // and the size that make it the subject's title rather than a row's
    // label, and the weight reset that keeps an h1 from arriving bold —
    // Eyebrow's argument, one level up.
    const src = readFileSync("src/shell/ui/Title.svelte", "utf8");
    const match = /\.shell-title\s*\{([^}]*)\}/.exec(src);
    expect(match, "no .shell-title rule in Title.svelte").toBeTruthy();
    const decls = match[1];
    expect(decls).toMatch(/font-family:\s*var\(--font-prose\)/);
    expect(decls).toMatch(/font-size:\s*var\(--text-xl\)/);
    expect(decls).toMatch(/font-weight:\s*400/);
  });

  it("wraps a long line rather than leaving the band", () => {
    // A pin's title is the writer's own sentence; a focus line can be
    // sixty characters. The title wraps and a single long word breaks —
    // the one declaration that stops the screen scrolling sideways under
    // a title that would not.
    const src = readFileSync("src/shell/ui/Title.svelte", "utf8");
    const match = /\.shell-title\s*\{([^}]*)\}/.exec(src);
    expect(match[1]).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
