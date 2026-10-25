import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { flushSync, createRawSnippet } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Card from "../Card.svelte";

afterEach(cleanupAll);

function prose() {
  return createRawSnippet(() => ({
    render: () => `<div class="prose"><p>the writing</p></div>`,
  }));
}

describe("Card", () => {
  it("frames its content", () => {
    const { target } = render(Card, { children: prose() });
    flushSync();
    const card = target.querySelector(".shell-card");
    expect(card).not.toBeNull();
    expect(card.querySelector(".prose p").textContent).toBe("the writing");
  });

  it("is inert — a frame, not a control or a landmark", () => {
    // The content decides what it is; the card only bounds it. A role
    // here would announce a region around every read page for no reason.
    const { target } = render(Card, { children: prose() });
    flushSync();
    expect(target.querySelector("button")).toBeNull();
    expect(target.querySelector("[role]")).toBeNull();
  });

  it("sits raised on the canvas, soft-hairlined, and scrolls wide content inside itself", () => {
    // READ FROM SOURCE: jsdom applies no scoped stylesheet, so nothing
    // rendered can see a tone or an edge. Six declarations, each with a
    // job (Card.svelte's header): --raised because --surface is too near
    // the canvas to bound a page of prose; --hairline-soft because the
    // edge divides rather than boxes; --radius-lg is the sheet's radius;
    // the margin is the content band's inset; and overflow-x: auto keeps
    // a wide table or a long code line scrolling inside the card rather
    // than pushing the screen sideways — the one element on a reading
    // screen allowed to be wider than the band.
    const src = readFileSync("src/shell/ui/Card.svelte", "utf8");
    const match = /\.shell-card\s*\{([^}]*)\}/.exec(src);
    expect(match, "no .shell-card rule in Card.svelte").toBeTruthy();
    const decls = match[1];
    expect(decls).toMatch(/margin:\s*0\s+var\(--space-4\)/);
    expect(decls).toMatch(/padding:\s*var\(--space-4\)/);
    expect(decls).toMatch(/background:\s*var\(--raised\)/);
    expect(decls).toMatch(/border:\s*1px solid var\(--hairline-soft\)/);
    expect(decls).toMatch(/border-radius:\s*var\(--radius-lg\)/);
    expect(decls).toMatch(/overflow-x:\s*auto/);
  });
});
