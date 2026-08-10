import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "./test-helper.js";
import Card from "./Card.svelte";

afterEach(cleanupAll);

describe("Card", () => {
  it("focused applies aria-current and focused class", () => {
    const { el } = render(Card, { focused: true });
    expect(el.classList.contains("focused")).toBe(true);
    expect(el.getAttribute("aria-current")).toBe("true");
  });

  it("clickable card has role=button and fires onClick", () => {
    const spy = vi.fn();
    const { el } = render(Card, { onClick: spy });
    expect(el.getAttribute("role")).toBe("button");
    expect(el.getAttribute("tabindex")).toBe("0");
    el.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("focused overrides accent strip (mutually exclusive class)", () => {
    const { el } = render(Card, { focused: true, accent: true });
    expect(el.classList.contains("focused")).toBe(true);
    expect(el.classList.contains("accent")).toBe(false);
  });
});
