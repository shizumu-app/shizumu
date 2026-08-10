// WhatShifted: a collapsible "what settled" strip. Expands to an input on
// click, persists via updateWhatShifted on Enter (null when blanked),
// resets on Escape, and stays collapsed when read-only.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

vi.mock("../../lib/api.js", () => ({
  updateWhatShifted: vi.fn(() => Promise.resolve()),
}));

import { updateWhatShifted } from "../../lib/api.js";
import WhatShifted from "../WhatShifted.svelte";

afterEach(cleanupAll);
beforeEach(() => vi.clearAllMocks());

describe("WhatShifted", () => {
  it("shows the prompt label when empty", () => {
    const { target } = render(WhatShifted, { pageId: "p1", value: null });
    expect(target.querySelector(".strip-label")?.textContent).toContain("what settled");
  });

  it("shows the saved text when present", async () => {
    const { target } = render(WhatShifted, { pageId: "p1", value: "the frame clicked" });
    await tick();
    expect(target.querySelector(".shifted-text")?.textContent).toBe("the frame clicked");
  });

  it("expands on click and saves the text on Enter", async () => {
    const onClose = vi.fn();
    const { target } = render(WhatShifted, { pageId: "p9", value: null, onClose });
    target.querySelector(".strip-toggle").click();
    await tick();
    const input = target.querySelector("input.strip-input");
    expect(input).toBeTruthy();
    input.value = "a thread closed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();

    expect(updateWhatShifted).toHaveBeenCalledWith("p9", "a thread closed");
    expect(onClose).toHaveBeenCalled();
  });

  it("persists null when the field is blanked", async () => {
    const { target } = render(WhatShifted, { pageId: "p9", value: null });
    target.querySelector(".strip-toggle").click();
    await tick();
    const input = target.querySelector("input.strip-input");
    input.value = "   ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();

    expect(updateWhatShifted).toHaveBeenCalledWith("p9", null);
  });

  // A phone has no Escape key and no reason to press Enter on a field it
  // decided not to fill in. Without a blur path the strip stayed an open
  // input for the rest of the session, leaving a stray caret above the
  // tab bar after the user tapped back into the editor.
  it("collapses on blur when nothing was typed, without writing", async () => {
    const { target } = render(WhatShifted, { pageId: "p1", value: null });
    target.querySelector(".strip-toggle").click();
    await tick();
    const input = target.querySelector("input.strip-input");
    expect(input).toBeTruthy();

    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    await tick();

    expect(target.querySelector("input.strip-input")).toBeNull();
    expect(target.querySelector(".strip-toggle")).toBeTruthy();
    expect(updateWhatShifted).not.toHaveBeenCalled();
  });

  it("saves on blur when the text actually changed", async () => {
    const onClose = vi.fn();
    const { target } = render(WhatShifted, { pageId: "p2", value: null, onClose });
    target.querySelector(".strip-toggle").click();
    await tick();
    const input = target.querySelector("input.strip-input");
    input.value = "the frame clicked";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    // submit() awaits the write before collapsing — pump past the promise.
    await new Promise((r) => setTimeout(r, 0));
    await tick();

    expect(updateWhatShifted).toHaveBeenCalledWith("p2", "the frame clicked");
    expect(target.querySelector("input.strip-input")).toBeNull();
  });

  it("collapses on blur without rewriting an unchanged value", async () => {
    const { target } = render(WhatShifted, { pageId: "p3", value: "already here" });
    await tick();
    target.querySelector(".strip-toggle").click();
    await tick();
    target.querySelector("input.strip-input")
      .dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    await tick();

    expect(updateWhatShifted).not.toHaveBeenCalled();
    expect(target.querySelector(".shifted-text")?.textContent).toBe("already here");
  });

  it("does not expand when read-only", async () => {
    const { target } = render(WhatShifted, { pageId: "p1", value: null, readonly: true });
    target.querySelector(".strip-toggle").click();
    await tick();
    expect(target.querySelector("input.strip-input")).toBeNull();
  });
});
