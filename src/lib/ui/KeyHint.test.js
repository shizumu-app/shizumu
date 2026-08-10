import { describe, it, expect, afterEach } from "vitest";
import { render, cleanupAll } from "./test-helper.js";
import KeyHint from "./KeyHint.svelte";

afterEach(cleanupAll);

describe("KeyHint", () => {
  it("renders one .key span per provided key", () => {
    const { el } = render(KeyHint, { keys: ["⌘", "k"] });
    const keys = el.querySelectorAll(".key");
    expect(keys.length).toBe(2);
    expect(keys[0].textContent).toBe("⌘");
    expect(keys[1].textContent).toBe("k");
  });

  it("renders label after a separator when label provided", () => {
    const { el } = render(KeyHint, { keys: ["esc"], label: "close" });
    expect(el.textContent).toContain("close");
    expect(el.querySelector(".sep")).not.toBeNull();
  });

  it("aria-label reads 'press <keys> to <label>'", () => {
    const { el } = render(KeyHint, { keys: ["⌘", "k"], label: "open palette" });
    expect(el.getAttribute("aria-label")).toBe("press ⌘ plus k to open palette");
  });
});
