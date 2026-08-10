import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "./test-helper.js";
import Toggle from "./Toggle.svelte";

afterEach(cleanupAll);

describe("Toggle", () => {
  it("renders unchecked by default", () => {
    const { target } = render(Toggle, {});
    const toggle = target.querySelector(".toggle");
    const input = target.querySelector("input[type=checkbox]");
    expect(toggle).not.toBeNull();
    expect(input.checked).toBe(false);
    expect(toggle.classList.contains("checked")).toBe(false);
  });

  it("renders the checked class when checked=true", () => {
    const { target } = render(Toggle, { checked: true });
    const toggle = target.querySelector(".toggle");
    expect(toggle.classList.contains("checked")).toBe(true);
  });

  it("clicking the input fires onChange with the new value", () => {
    const spy = vi.fn();
    const { target } = render(Toggle, { checked: false, onChange: spy });
    const input = target.querySelector("input[type=checkbox]");
    input.click();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(true);
  });

  it("does not fire onChange when disabled", () => {
    const spy = vi.fn();
    const { target } = render(Toggle, {
      checked: false,
      disabled: true,
      onChange: spy,
    });
    const input = target.querySelector("input[type=checkbox]");
    input.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("applies the label prop as aria-label on the inner input", () => {
    const { target } = render(Toggle, { label: "dark mode" });
    const input = target.querySelector("input[type=checkbox]");
    expect(input.getAttribute("aria-label")).toBe("dark mode");
  });
});
