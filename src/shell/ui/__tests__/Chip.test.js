import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { flushSync, createRawSnippet } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Chip from "../Chip.svelte";

afterEach(cleanupAll);

function text(s) {
  return createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));
}

function mountChip(props = {}) {
  const mounted = render(Chip, { children: text("book"), ...props });
  flushSync();
  return mounted;
}

describe("Chip", () => {
  it("renders its content in an inert span", () => {
    const { target } = mountChip();
    const chip = target.querySelector(".shell-chip");
    expect(chip.tagName).toBe("SPAN");
    expect(chip.textContent.trim()).toBe("book");
  });

  it("is never a control", () => {
    // The whole design of the primitive (see Chip.svelte's header): the
    // desktop has a chip that opens a popover and a chip that is a label,
    // and a phone chip that is sometimes a tap and sometimes not is a tap
    // the writer cannot predict. So no button, no role, no tabindex —
    // asserted on the rendered markup, because a Chip that gained an
    // `onSelect` would show up here as one of these three attributes
    // before it showed up anywhere else. A thing that acts is a Row.
    const { target } = mountChip();
    expect(target.querySelector("button")).toBeNull();
    expect(target.querySelector("[role]")).toBeNull();
    expect(target.querySelector("[tabindex]")).toBeNull();
  });

  it("carries its tone as data, ink by default", () => {
    expect(mountChip().target.querySelector(".shell-chip").dataset.tone).toBe("ink");
    expect(mountChip({ tone: "accent" }).target.querySelector(".shell-chip").dataset.tone).toBe(
      "accent",
    );
  });

  it("is mono, small, hairlined and rounded, and the accent tone is the desktop's pins chip", () => {
    // READ FROM SOURCE: jsdom applies no scoped stylesheet, so nothing
    // rendered can tell a mono chip from a Lora one or a pill from a box.
    // The four base declarations are what make it a tag rather than a
    // word; the accent rule is TrailMap's `.pins-chip` — --accent-text on
    // --warm-accent-soft — which is why a count of pins on the phone reads
    // as the same thing it is on the desktop.
    const src = readFileSync("src/shell/ui/Chip.svelte", "utf8");
    const base = /\.shell-chip\s*\{([^}]*)\}/.exec(src);
    expect(base, "no .shell-chip rule in Chip.svelte").toBeTruthy();
    expect(base[1]).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(base[1]).toMatch(/font-size:\s*var\(--text-xs\)/);
    expect(base[1]).toMatch(/border:\s*1px solid var\(--hairline\)/);
    expect(base[1]).toMatch(/border-radius:\s*var\(--radius-lg\)/);
    expect(base[1]).toMatch(/color:\s*var\(--ink-soft\)/);

    const accent = /\.shell-chip\[data-tone="accent"\]\s*\{([^}]*)\}/.exec(src);
    expect(accent, "no accent rule in Chip.svelte").toBeTruthy();
    expect(accent[1]).toMatch(/color:\s*var\(--accent-text\)/);
    expect(accent[1]).toMatch(/background:\s*var\(--warm-accent-soft\)/);
  });
});
