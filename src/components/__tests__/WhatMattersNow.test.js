// Covers INV-NAV-4: the "what matters now" field renders its value and
// persists edits via the api on blur / Enter. Demonstrates the per-test
// $lib/api mock pattern that api-backed component tests use (the
// invoke-mock equivalent of src/lib/__tests__/api.test.js).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

// Mock the api module the component imports. Only the function under
// test needs a real implementation; the factory replaces the whole module.
vi.mock("../../lib/api.js", () => ({
  updateWhatMattersNow: vi.fn(() => Promise.resolve()),
}));

import { updateWhatMattersNow } from "../../lib/api.js";
import WhatMattersNow from "../WhatMattersNow.svelte";

afterEach(cleanupAll);
beforeEach(() => vi.clearAllMocks());

describe("WhatMattersNow", () => {
  it("renders the current value in the input", async () => {
    const { target } = render(WhatMattersNow, { pageId: "p1", value: "ship the merge" });
    await tick();
    const input = target.querySelector("input.what-matters-input");
    expect(input).toBeTruthy();
    expect(input.value).toBe("ship the merge");
  });

  it("renders read-only as text, with no input", async () => {
    const { target } = render(WhatMattersNow, {
      pageId: "p1",
      value: "frozen focus",
      readonly: true,
    });
    await tick();
    expect(target.querySelector("input")).toBeNull();
    expect(target.querySelector(".what-matters-text")?.textContent).toBe("frozen focus");
  });

  it("persists the edited value on blur and notifies the parent", async () => {
    const onValueChange = vi.fn();
    const { target } = render(WhatMattersNow, { pageId: "p42", value: "", onValueChange });
    await tick();
    const input = target.querySelector("input.what-matters-input");

    input.value = "new focus";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    await tick();

    expect(updateWhatMattersNow).toHaveBeenCalledWith("p42", "new focus");
    expect(onValueChange).toHaveBeenCalledWith("new focus");
  });

  it("saves then hands off focus on Enter", async () => {
    const onEnter = vi.fn();
    const { target } = render(WhatMattersNow, { pageId: "p7", value: "", onEnter });
    await tick();
    const input = target.querySelector("input.what-matters-input");

    input.value = "done";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();
    await tick();

    expect(updateWhatMattersNow).toHaveBeenCalledWith("p7", "done");
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
