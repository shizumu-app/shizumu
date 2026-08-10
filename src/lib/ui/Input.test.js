import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "./test-helper.js";
import Input from "./Input.svelte";

afterEach(cleanupAll);

describe("Input", () => {
  it("renders search variant with italic class", () => {
    const { el } = render(Input, { value: "", placeholder: "search…", variant: "search" });
    expect(el.classList.contains("search")).toBe(true);
    expect(el.getAttribute("placeholder")).toBe("search…");
  });

  it("fires onInput on input event", () => {
    const onInput = vi.fn();
    const { el } = render(Input, { value: "", onInput });
    el.value = "hi";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onInput).toHaveBeenCalledWith("hi");
  });

  it("Esc on search variant clears value and fires onClear", () => {
    const onClear = vi.fn();
    const onInput = vi.fn();
    const { el } = render(Input, { value: "query", variant: "search", onClear, onInput });
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onInput).toHaveBeenCalledWith("");
  });
});
