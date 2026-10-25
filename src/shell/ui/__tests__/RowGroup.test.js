import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { flushSync, createRawSnippet } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import RowGroup from "../RowGroup.svelte";

afterEach(cleanupAll);

/** Two inert rows, so the body has children to separate. */
function rows() {
  return createRawSnippet(() => ({
    render: () => `<div><div class="shell-row">tone</div><div class="shell-row">font</div></div>`,
  }));
}

function mountGroup(props = {}) {
  const mounted = render(RowGroup, { children: rows(), ...props });
  flushSync();
  return mounted;
}

describe("RowGroup", () => {
  it("renders its rows inside a body on the group's surface", () => {
    const { target } = mountGroup();
    const body = target.querySelector(".shell-row-group > .shell-row-group-body");
    expect(body).not.toBeNull();
    expect(body.querySelectorAll(".shell-row").length).toBe(2);
  });

  it("draws an eyebrow only when given one", () => {
    // Not an empty assertion for its own sake: an eyebrow with no text
    // would still take its margin and sit as a blank line above the
    // surface, and a sheet's flush group — which names nothing — would
    // open with a gap at the top nobody asked for.
    expect(mountGroup().target.querySelector(".shell-eyebrow")).toBeNull();
    const { target } = mountGroup({ eyebrow: "appearance" });
    const eyebrow = target.querySelector(".shell-row-group > .shell-eyebrow");
    expect(eyebrow).not.toBeNull();
    expect(eyebrow.textContent.trim()).toBe("appearance");
  });

  it("puts the eyebrow above the body, not inside it", () => {
    // The body's separator rule reads every direct child after the first;
    // an eyebrow inside the body would be the first child and the first
    // row would get a line above it — at the group's top edge, the one
    // place the group promises no line.
    const { target } = mountGroup({ eyebrow: "sync" });
    expect(target.querySelector(".shell-row-group-body .shell-eyebrow")).toBeNull();
  });

  it("carries the flush class only when asked", () => {
    expect(mountGroup().target.querySelector(".shell-row-group").classList.contains("flush")).toBe(false);
    expect(mountGroup({ flush: true }).target.querySelector(".shell-row-group").classList.contains("flush")).toBe(true);
  });

  it("separates direct children after the first, on the soft hairline", () => {
    // READ FROM SOURCE: jsdom applies no scoped stylesheet and renders no
    // pseudo-elements, so no rendered assertion can see the line. What
    // this holds is the two facts that make it the right line: it targets
    // `> * + *` — every direct child after the first, whatever element
    // that is, because PinsScreen and MemoryScreen wrap
    // each Row in a div and a selector naming the row would draw nothing
    // between them — and it is drawn in --hairline-soft, the token Task 1
    // appended for exactly this line. That it LOOKS right is the VR
    // gate's to say.
    const src = readFileSync("src/shell/ui/RowGroup.svelte", "utf8");
    const match = /\.shell-row-group-body\s*>\s*:global\(\*\s*\+\s*\*\)::before\s*\{([^}]*)\}/.exec(src);
    expect(match, "no `> :global(* + *)::before` rule in RowGroup.svelte").toBeTruthy();
    expect(match[1]).toMatch(/background:\s*var\(--hairline-soft\)/);
    // Inset to the label's edge, so it divides labels rather than boxing
    // the surface.
    expect(match[1]).toMatch(/left:\s*var\(--space-4\)/);
  });

  it("drops the surface, inset and radius when flush, and keeps the separators", () => {
    // A sheet is already a surface; a group inside one drawing its own
    // would be a card on a card. The separator rule above is not scoped
    // to the non-flush case, so the lines between a sheet's rows stay.
    const src = readFileSync("src/shell/ui/RowGroup.svelte", "utf8");
    const match = /\.flush\s+\.shell-row-group-body\s*\{([^}]*)\}/.exec(src);
    expect(match, "no .flush .shell-row-group-body rule in RowGroup.svelte").toBeTruthy();
    expect(match[1]).toMatch(/margin:\s*0/);
    expect(match[1]).toMatch(/background:\s*none/);
    expect(match[1]).toMatch(/border-radius:\s*0/);
  });
});
