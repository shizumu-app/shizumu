import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Toast from "../Toast.svelte";

afterEach(cleanupAll);

describe("Toast", () => {
  it("renders its message", () => {
    const { target } = render(Toast, { message: "joins 11 pins on the book trail" });
    expect(target.querySelector(".shell-toast").textContent.trim()).toBe(
      "joins 11 pins on the book trail",
    );
  });

  it("renders no band without a message", () => {
    // An empty toast still occupies its band and pushes the content down,
    // which reads as a layout glitch rather than a notice.
    expect(render(Toast, { message: "" }).target.querySelector(".shell-toast")).toBeNull();
  });

  it("announces itself politely rather than interrupting", () => {
    const { target } = render(Toast, { message: "pinned" });
    const region = target.querySelector(".shell-toast-live");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent.trim()).toBe("pinned");
  });

  it("has its live region on screen BEFORE there is a message to announce", () => {
    // The defect the toast's first real call found, and the reason the
    // region and the visible band are two elements rather than one. A
    // live region inserted into the DOM already holding its text is
    // announced unreliably — TalkBack, the shell's first target, is among
    // the readers that stay silent — because there was no region present
    // for the change to be a change TO. So the region mounts empty and
    // only its contents change.
    //
    // Not a "nothing happens" assertion: the region IS here, carrying its
    // attributes, with no visible band inside it. Both halves matter, and
    // reverting the component to one `{#if}`-guarded element fails on the
    // first line below while every other test in this file stays green.
    const { target } = render(Toast, { message: "" });
    const region = target.querySelector(".shell-toast-live");
    expect(region).not.toBeNull();
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.querySelector(".shell-toast")).toBeNull();
  });

  it("is set in prose, because its message is a sentence", () => {
    // The shell's type roles (Toast.svelte's header): "joins 11 pins on
    // the book trail" is addressed to the writer and read like a line of
    // the page, not a label on a control — so --font-prose, not the
    // interface face it carried until the visual pass. READ FROM SOURCE:
    // jsdom applies no scoped stylesheet, so no rendered assertion can
    // tell the two faces apart.
    const src = readFileSync("src/shell/ui/Toast.svelte", "utf8");
    const match = /\.shell-toast\s*\{([^}]*)\}/.exec(src);
    expect(match, "no .shell-toast rule in Toast.svelte").toBeTruthy();
    expect(match[1]).toMatch(/font-family:\s*var\(--font-prose\)/);
  });
});
