import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "./test-helper.js";
import Button from "./Button.svelte";

afterEach(cleanupAll);

describe("Button", () => {
  it("renders variant class and text from children", () => {
    const { el } = render(Button, { variant: "accent", children: snippetText("ok") });
    expect(el.classList.contains("accent")).toBe(true);
    expect(el.textContent.trim()).toBe("ok");
  });

  it("fires onClick when clicked", () => {
    const spy = vi.fn();
    const { el } = render(Button, { onClick: spy, children: snippetText("go") });
    el.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("disabled + loading apply correct ARIA + disabled state", () => {
    const { el } = render(Button, { disabled: true, loading: true, children: snippetText("x") });
    expect(el.hasAttribute("disabled")).toBe(true);
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("aria-busy")).toBe("true");
  });
});

// Minimal Svelte 5 snippet stand-in for text content in tests.
function snippetText(text) {
  return ($$anchor) => {
    const t = document.createTextNode(text);
    $$anchor.before(t);
    return () => t.remove();
  };
}
