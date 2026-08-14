import { describe, it, expect, vi } from "vitest";
import { focusField } from "../focus-field.js";

describe("focusField", () => {
  it("focuses on the next frame and only once per open-cycle", async () => {
    const el = { focus: vi.fn(), select: vi.fn() };
    focusField(el);
    focusField(el); // second call same cycle: no double focus
    await new Promise((r) => requestAnimationFrame(() => r()));
    expect(el.focus).toHaveBeenCalledTimes(1);
    focusField.reset(el);
    focusField(el);
    await new Promise((r) => requestAnimationFrame(() => r()));
    expect(el.focus).toHaveBeenCalledTimes(2);
  });
});
