import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Eyebrow from "../Eyebrow.svelte";

afterEach(cleanupAll);

describe("Eyebrow", () => {
  it("renders its label as a heading", () => {
    // An h3, not a div: a reader moving by headings lands on each group's
    // name, which is the one thing an eyebrow is for.
    const { target } = render(Eyebrow, { label: "appearance" });
    const el = target.querySelector(".shell-eyebrow");
    expect(el.tagName).toBe("H3");
    expect(el.textContent.trim()).toBe("appearance");
  });

  it("is mono, small, tracked, and not bold", () => {
    // READ FROM SOURCE: jsdom applies no scoped stylesheet, so nothing
    // rendered can tell a mono eyebrow from a Lora one. This holds the
    // four declarations that make it an eyebrow rather than a title, and
    // the weight reset that keeps an h3 from arriving bold — every
    // heading the shell draws in this role today is a plain div at 400,
    // and promoting them to a heading must not embolden them.
    const src = readFileSync("src/shell/ui/Eyebrow.svelte", "utf8");
    const match = /\.shell-eyebrow\s*\{([^}]*)\}/.exec(src);
    expect(match, "no .shell-eyebrow rule in Eyebrow.svelte").toBeTruthy();
    const decls = match[1];
    expect(decls).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(decls).toMatch(/font-size:\s*var\(--text-xs\)/);
    expect(decls).toMatch(/text-transform:\s*uppercase/);
    expect(decls).toMatch(/letter-spacing:\s*0\.06em/);
    expect(decls).toMatch(/font-weight:\s*400/);
  });
});
