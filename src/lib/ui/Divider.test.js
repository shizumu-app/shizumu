import { describe, it, expect, afterEach } from "vitest";
import { render, cleanupAll } from "./test-helper.js";
import Divider from "./Divider.svelte";

afterEach(cleanupAll);

describe("Divider", () => {
  it("renders with role=separator and horizontal aria-orientation by default", () => {
    const { el } = render(Divider);
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("vertical prop flips orientation and adds class", () => {
    const { el } = render(Divider, { vertical: true });
    expect(el.classList.contains("vertical")).toBe(true);
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("inset propagates as --inset CSS variable", () => {
    const { el } = render(Divider, { inset: 1.5 });
    expect(el.style.getPropertyValue("--inset")).toBe("1.5rem");
  });
});
