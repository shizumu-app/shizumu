import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { render, cleanupAll } from "./test-helper.js";
import Chip from "./Chip.svelte";

afterEach(cleanupAll);

describe("Chip", () => {
  it("renders label and applies variant class", () => {
    const { el } = render(Chip, { label: "trail", variant: "accent" });
    expect(el.classList.contains("accent")).toBe(true);
    expect(el.textContent).toContain("trail");
  });

  it("fires onClick and reflects active via aria-pressed", () => {
    const spy = vi.fn();
    const { el } = render(Chip, { label: "x", onClick: spy, active: true });
    flushSync();
    expect(el.getAttribute("aria-pressed")).toBe("true");
    el.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("removable chip exposes × with proper aria-label and fires onRemove", () => {
    const onRemove = vi.fn();
    const { el } = render(Chip, { label: "pinned", removable: true, onRemove });
    const removeBtn = el.querySelector(".remove");
    expect(removeBtn).not.toBeNull();
    expect(removeBtn.getAttribute("aria-label")).toBe("remove pinned");
    removeBtn.click();
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
