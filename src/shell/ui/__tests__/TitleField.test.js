import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import TitleField from "../TitleField.svelte";

afterEach(cleanupAll);

describe("TitleField", () => {
  it("renders an input carrying its label and placeholder", () => {
    const { target } = render(TitleField, { label: "what matters now", placeholder: "what matters now" });
    const input = target.querySelector("input");
    expect(input.getAttribute("aria-label")).toBe("what matters now");
    expect(input.getAttribute("placeholder")).toBe("what matters now");
  });

  it("commits what it holds on blur", () => {
    const onCommit = vi.fn();
    const { target } = render(TitleField, { label: "t", value: "the book", onCommit });
    const input = target.querySelector("input");
    input.value = "the book, again";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("blur"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("the book, again");
  });

  it("commits once on Enter, then hands on", () => {
    // Enter blurs and the blur commits (the desktop's order — see the
    // header). If the keydown handler ALSO committed, one Enter would
    // write twice, and the second write would be the one a device shows
    // as a title flickering.
    const onCommit = vi.fn();
    const onEnter = vi.fn();
    const { target } = render(TitleField, { label: "t", onCommit, onEnter });
    const input = target.querySelector("input");
    input.focus();
    input.value = "finish the chapter";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("finish the chapter");
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });

  it("leaves every other key to the input", () => {
    const onEnter = vi.fn();
    const { target } = render(TitleField, { label: "t", onEnter });
    const input = target.querySelector("input");
    const key = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    input.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("declares the 16px floor and the prose face in its own file", () => {
    // jsdom resolves no scoped <style>; the source is the proof. Field's
    // rule (shell-rules.test.js, "declares the 16px input floor"): under
    // 16px mobile Safari zooms on focus. The face is Title's, because this
    // is a title.
    const src = readFileSync("src/shell/ui/TitleField.svelte", "utf8");
    expect(src.includes("var(--text-input)")).toBe(true);
    expect(src.includes("font-family: var(--font-prose)")).toBe(true);
  });

  it("draws a written focus line in the accent, and a pin's name in ink", () => {
    // The desktop draws the same split: `.filled .what-matters-input` is
    // warm accent, the pin modal's title input is ink. jsdom resolves no
    // scoped style, so the claim held here is the seam the CSS keys on.
    const { target } = render(TitleField, { label: "what matters now", tone: "accent" });
    expect(target.querySelector("input").dataset.tone).toBe("accent");
    expect(render(TitleField, { label: "pin title" }).target.querySelector("input").dataset.tone)
      .toBe("ink");
    const src = readFileSync("src/shell/ui/TitleField.svelte", "utf8");
    expect(src).toMatch(/\[data-tone="accent"\]:not\(:placeholder-shown\)/);
    expect(src).toMatch(/font-style: italic/);
  });
});
