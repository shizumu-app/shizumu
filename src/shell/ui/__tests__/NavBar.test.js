import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import NavBar from "../NavBar.svelte";

/** Every `selector { decls }` block of the component's stylesheet whose
 *  selector list names `cls` exactly — `.shell-navbar-action` must not
 *  match `.shell-navbar-actions`, and the action's own rule must be told
 *  apart from the `.shell-navbar-back, .shell-navbar-action` pair it also
 *  appears in. Returns the declarations joined, so a declaration may live
 *  in whichever of those rules the component chooses. */
function declarationsFor(src, cls) {
  const style = src.slice(src.indexOf("<style>"));
  const escaped = cls.replace(/[.-]/g, "\\$&");
  const named = new RegExp(`${escaped}(?![\\w-])`);
  return [...style.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => named.test(m[1].replace(/\/\*[\s\S]*?\*\//g, "")))
    .map((m) => m[2])
    .join("\n");
}

afterEach(cleanupAll);

describe("NavBar", () => {
  it("renders its title", () => {
    const { target } = render(NavBar, { title: "memory" });
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("memory");
  });

  it("shows a back control only when onBack is given", () => {
    // A back affordance with nothing to go back to is the classic dead
    // control; the root screens (page, memory, settings) have no stack.
    expect(render(NavBar, { title: "page" }).target.querySelector(".shell-navbar-back")).toBeNull();
    expect(
      render(NavBar, { title: "a day", onBack: () => {} }).target.querySelector(".shell-navbar-back"),
    ).not.toBeNull();
  });

  it("calls onBack when the back control is used", () => {
    const onBack = vi.fn();
    const { target } = render(NavBar, { title: "a day", onBack });
    target.querySelector(".shell-navbar-back").click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("carries the collapsed class from its prop, never computing it", () => {
    // nav-collapse.js decides this (scroll hysteresis + keyboard); the bar
    // only draws it. A bar that computed its own collapse would be a
    // second owner of a rule that already has one.
    expect(
      render(NavBar, { title: "page", collapsed: true }).target
        .querySelector(".shell-navbar").classList.contains("collapsed"),
    ).toBe(true);
    expect(
      render(NavBar, { title: "page", collapsed: false }).target
        .querySelector(".shell-navbar").classList.contains("collapsed"),
    ).toBe(false);
  });

  it("renders at most two actions", () => {
    // §4 caps the bar at two actions. A third is a design error, and
    // silently rendering it would let a screen smuggle a toolbar in here.
    const { target } = render(NavBar, {
      title: "pins",
      actions: [
        { id: "a", label: "one", onSelect: () => {} },
        { id: "b", label: "two", onSelect: () => {} },
        { id: "c", label: "three", onSelect: () => {} },
      ],
    });
    expect(target.querySelectorAll(".shell-navbar-action").length).toBe(2);
  });

  it("keeps two actions apart, so two labels never read as one word", () => {
    // Found on a real phone: memory's bar rendered "filterstrails". Each
    // action floors itself at 44px wide, which happens to space the page
    // header's short labels ("find", "pins") by centring them, and did
    // nothing for two labels wider than the floor — the actions box had no
    // gap and the buttons no side padding, so the two words sat flush.
    //
    // READ FROM SOURCE, Row.test.js's way and for Row.test.js's reason:
    // jsdom applies no scoped stylesheet and computes no layout, so the
    // rendered box below can only prove the two actions are siblings in
    // the box the rule addresses; that they sit APART is the declarations'
    // to say, and this holds them in place. The values are the page
    // header's own rhythm (`.ph-line1` gaps by space-2) rather than a
    // number chosen here.
    const { target } = render(NavBar, {
      title: "memory",
      actions: [
        { id: "filters", label: "filters", onSelect: () => {} },
        { id: "trails", label: "trails", onSelect: () => {} },
      ],
    });
    const box = target.querySelector(".shell-navbar-actions");
    expect([...box.children].map((n) => n.classList.contains("shell-navbar-action"))).toEqual([
      true,
      true,
    ]);

    const src = readFileSync("src/shell/ui/NavBar.svelte", "utf8");
    // The air between the two.
    expect(declarationsFor(src, ".shell-navbar-actions")).toMatch(/gap:\s*var\(--space-2\)/);
    // The margin a long label does not get from centring.
    expect(declarationsFor(src, ".shell-navbar-action")).toMatch(
      /padding:\s*0\s+var\(--space-2\)/,
    );
  });

  it("calls an action's onSelect when used", () => {
    const onSelect = vi.fn();
    const { target } = render(NavBar, {
      title: "pins",
      actions: [{ id: "a", label: "filter", onSelect }],
    });
    target.querySelector(".shell-navbar-action").click();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("sets the titles in prose and the controls in the interface face", () => {
    // The shell's type roles (NavBar.svelte's header): the title and
    // subtitle NAME the thing on screen in the writer's words, so they
    // are --font-prose; back and the actions are labels on controls, so
    // they stay --font-ui. Before the visual pass the titles declared no
    // face at all and inherited the interface's from ShellRoot — so the
    // assertion is a positive one on each line, not the absence of a
    // declaration, and reverting either title rule to inherit goes red.
    // READ FROM SOURCE, for the reason the test above gives.
    const src = readFileSync("src/shell/ui/NavBar.svelte", "utf8");
    expect(declarationsFor(src, ".shell-navbar-title")).toMatch(
      /font-family:\s*var\(--font-prose\)/,
    );
    expect(declarationsFor(src, ".shell-navbar-subtitle")).toMatch(
      /font-family:\s*var\(--font-prose\)/,
    );
    expect(declarationsFor(src, ".shell-navbar-back")).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(declarationsFor(src, ".shell-navbar-action")).toMatch(
      /font-family:\s*var\(--font-ui\)/,
    );
  });
});
