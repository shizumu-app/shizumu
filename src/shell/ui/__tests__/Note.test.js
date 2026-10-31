import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { flushSync, createRawSnippet } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Note from "../Note.svelte";

afterEach(cleanupAll);

function text(s) {
  return createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));
}

function mountNote(props = {}) {
  const mounted = render(Note, {
    children: text("this page is done. today is on the page."),
    ...props,
  });
  flushSync();
  return mounted;
}

describe("Note", () => {
  it("renders its sentence as a paragraph", () => {
    // A <p>, because it IS a sentence — words addressed to the writer —
    // and never a heading or a control. A reader moving by headings must
    // not land on a caveat.
    const { target } = mountNote();
    const note = target.querySelector(".shell-note");
    expect(note.tagName).toBe("P");
    expect(note.textContent.trim()).toBe("this page is done. today is on the page.");
    expect(target.querySelector("[role]")).toBeNull();
  });

  it("is small and ink by default, and says so as data", () => {
    const note = mountNote().target.querySelector(".shell-note");
    expect(note.dataset.size).toBe("sm");
    expect(note.dataset.tone).toBe("ink");
  });

  it("takes the base size for a sheet's greeting and the warm tone for an error", () => {
    const greeting = mountNote({ size: "base" }).target.querySelector(".shell-note");
    expect(greeting.dataset.size).toBe("base");
    const error = mountNote({ tone: "warm" }).target.querySelector(".shell-note");
    expect(error.dataset.tone).toBe("warm");
  });

  it("is prose, small, soft and inset, with base and warm as data-driven overrides", () => {
    // READ FROM SOURCE: jsdom applies no scoped stylesheet, so nothing
    // rendered can tell a Lora note from a mono one. The face is the
    // claim this primitive exists for — a note is READ, not operated —
    // and the five ad-hoc rules it replaces (Note.svelte's header) each
    // set the interface face. The two overrides are keyed on the data
    // attributes the render tests above hold, so a size or tone that
    // renders as data but styles nothing is caught here rather than on a
    // device.
    const src = readFileSync("src/shell/ui/Note.svelte", "utf8");
    const base = /\.shell-note\s*\{([^}]*)\}/.exec(src);
    expect(base, "no .shell-note rule in Note.svelte").toBeTruthy();
    expect(base[1]).toMatch(/font-family:\s*var\(--font-prose\)/);
    expect(base[1]).toMatch(/font-size:\s*var\(--text-sm\)/);
    expect(base[1]).toMatch(/line-height:\s*var\(--leading-base\)/);
    expect(base[1]).toMatch(/color:\s*var\(--ink-soft\)/);
    expect(base[1]).toMatch(/padding:\s*var\(--space-2\)\s+var\(--space-4\)\s+var\(--space-3\)/);

    const size = /\.shell-note\[data-size="base"\]\s*\{([^}]*)\}/.exec(src);
    expect(size, "no base-size rule in Note.svelte").toBeTruthy();
    expect(size[1]).toMatch(/font-size:\s*var\(--text-base\)/);

    const tone = /\.shell-note\[data-tone="warm"\]\s*\{([^}]*)\}/.exec(src);
    expect(tone, "no warm-tone rule in Note.svelte").toBeTruthy();
    expect(tone[1]).toMatch(/color:\s*var\(--accent-text\)/);
  });
});
