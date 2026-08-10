import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "./test-helper.js";
import SegmentedControl from "./SegmentedControl.svelte";

afterEach(cleanupAll);

const OPTIONS = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];

describe("SegmentedControl", () => {
  it("renders one role=radio button per option", () => {
    const { target } = render(SegmentedControl, { options: OPTIONS, value: "a" });
    const radios = target.querySelectorAll("[role=radio]");
    expect(radios.length).toBe(3);
  });

  it("active option has aria-checked true and tabindex 0; others false/-1", () => {
    const { target } = render(SegmentedControl, { options: OPTIONS, value: "b" });
    const radios = [...target.querySelectorAll("[role=radio]")];
    const active = radios.find((r) => r.textContent === "B");
    const others = radios.filter((r) => r.textContent !== "B");

    expect(active.getAttribute("aria-checked")).toBe("true");
    expect(active.getAttribute("tabindex")).toBe("0");
    for (const r of others) {
      expect(r.getAttribute("aria-checked")).toBe("false");
      expect(r.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("clicking a segment selects it and calls onChange", async () => {
    const onChange = vi.fn();
    const { target } = render(SegmentedControl, {
      options: OPTIONS,
      value: "a",
      onChange,
    });
    const radios = [...target.querySelectorAll("[role=radio]")];
    const bBtn = radios.find((r) => r.textContent === "B");
    bBtn.click();
    await tick();

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("b");
    expect(bBtn.getAttribute("aria-checked")).toBe("true");
  });

  it("ArrowRight wraps from the last option to the first", async () => {
    const onChange = vi.fn();
    const { target } = render(SegmentedControl, {
      options: OPTIONS,
      value: "c",
      onChange,
    });
    const group = target.querySelector("[role=radiogroup]");
    group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await tick();

    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("ArrowLeft wraps from the first option to the last", async () => {
    const onChange = vi.fn();
    const { target } = render(SegmentedControl, {
      options: OPTIONS,
      value: "a",
      onChange,
    });
    const group = target.querySelector("[role=radiogroup]");
    group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await tick();

    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("falls back to tabindex 0 on the first option when no option matches value", () => {
    // DatePopover hits this: its preset SegmentedControl's `value` can be
    // "specific" or "range", neither of which is a preset option — without
    // a fallback every button gets tabindex -1 and the group becomes
    // unreachable by keyboard.
    const { target } = render(SegmentedControl, { options: OPTIONS, value: "specific" });
    const radios = [...target.querySelectorAll("[role=radio]")];
    expect(radios[0].getAttribute("tabindex")).toBe("0");
    for (const r of radios.slice(1)) {
      expect(r.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("empty options array does not throw on render or on keydown", () => {
    expect(() => {
      const { target } = render(SegmentedControl, { options: [], value: "" });
      const group = target.querySelector("[role=radiogroup]");
      expect(group).not.toBeNull();
      expect(() => {
        group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      }).not.toThrow();
    }).not.toThrow();
  });
});
