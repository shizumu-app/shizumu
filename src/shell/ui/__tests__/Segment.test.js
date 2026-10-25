import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Segment from "../Segment.svelte";

afterEach(cleanupAll);

const MODES = [
  { value: "pages", label: "pages" },
  { value: "pins", label: "pins" },
  { value: "trailmap", label: "trail map" },
];

describe("Segment", () => {
  it("passes options, value and the label through to the leaf", () => {
    // The wrapper renames nothing: a caller moving from the leaf to this
    // file changes one import. So the rendered radiogroup carries the
    // caller's aria-label, one radio per option in order, and the checked
    // one is the caller's value.
    const { target } = render(Segment, { options: MODES, value: "pins", ariaLabel: "memory mode" });
    const group = target.querySelector('.shell-segment [role="radiogroup"]');
    expect(group).not.toBeNull();
    expect(group.getAttribute("aria-label")).toBe("memory mode");
    const radios = [...target.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.textContent.trim())).toEqual(["pages", "pins", "trail map"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("reports a change through onChange with the chosen value", () => {
    const onChange = vi.fn();
    const { target } = render(Segment, { options: MODES, value: "pages", onChange });
    [...target.querySelectorAll('[role="radio"]')][2].click();
    expect(onChange).toHaveBeenCalledWith("trailmap");
  });

  it("raises the leaf's segments to the shell's floor", () => {
    // THE P3 DEBT: "the memory mode segment is 40px, four under the
    // shell's --tap, inherited from src/lib/ui/SegmentedControl.svelte".
    // The leaf is not the shell's to edit, so the floor is declared from
    // outside, on the leaf's own segment class through :global. READ FROM
    // SOURCE, because jsdom applies no scoped stylesheet and would show a
    // 0px button either way. Reverting the declaration below — or
    // spelling it as the leaf does, with the unfloored token — goes red
    // here (and the second form in shell-rules.test.js as well).
    const src = readFileSync("src/shell/ui/Segment.svelte", "utf8");
    const btn = /\.shell-segment\s+:global\(\.seg-btn\)\s*\{([^}]*)\}/.exec(src);
    expect(btn, "no `.shell-segment :global(.seg-btn)` rule in Segment.svelte").toBeTruthy();
    expect(btn[1]).toMatch(/min-height:\s*var\(--tap\)/);
    // And the shell's own face and size, so three modes read as controls
    // of this tree rather than the leaf's hard-coded Inter.
    expect(btn[1]).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(btn[1]).toMatch(/font-size:\s*var\(--text-sm\)/);
    const seg = /\.shell-segment\s+:global\(\.seg\)\s*\{([^}]*)\}/.exec(src);
    expect(seg, "no `.shell-segment :global(.seg)` rule in Segment.svelte").toBeTruthy();
    expect(seg[1]).toMatch(/width:\s*100%/);
  });

  it("reaches for the class names the leaf actually renders", () => {
    // A :global override is a promise about someone else's markup. The
    // two names above are read off SegmentedControl.svelte, and this
    // holds them there: rename `.seg-btn` in the leaf and the floor
    // silently stops applying with every other test in this file green,
    // because the wrapper's rule would then match nothing. Held against
    // the leaf's SOURCE rather than the rendered class list so that it
    // fails on the rename itself, not on whichever screen first shows a
    // 40px segment again.
    const leaf = readFileSync("src/lib/ui/SegmentedControl.svelte", "utf8");
    expect(leaf).toMatch(/<div\s+class="seg"/);
    expect(leaf).toMatch(/class="seg-btn"/);
    // The rendered markup agrees, so the two sources cannot drift apart
    // without one of these three lines noticing.
    const { target } = render(Segment, { options: MODES, value: "pages" });
    expect(target.querySelector(".shell-segment > .seg")).not.toBeNull();
    expect(target.querySelectorAll(".shell-segment .seg-btn").length).toBe(3);
  });
});
