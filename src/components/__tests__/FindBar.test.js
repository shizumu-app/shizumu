import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import FindBar from "../FindBar.svelte";

function fakeEditor() {
  return {
    state: { selection: { empty: true } },
    commands: { setFindQuery: vi.fn(), focus: vi.fn(), nextFindMatch: vi.fn(), prevFindMatch: vi.fn() },
  };
}

describe("FindBar closing", () => {
  afterEach(cleanupAll);

  it("takes the highlights away and hands the caret back on Escape", async () => {
    // THE regression: the bar stays mounted when closed, so Escape hid it
    // and left every match highlighted, with focus on the body where mod+H
    // could not be heard.
    const editor = fakeEditor();
    const onClose = vi.fn();
    const { target } = render(FindBar, { editor, open: true, mode: "find", onClose });
    await tick();
    const input = target.querySelector(".find-input");
    input.value = "river";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(editor.commands.setFindQuery).toHaveBeenLastCalledWith("river");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(editor.commands.setFindQuery).toHaveBeenLastCalledWith("");
    expect(editor.commands.focus).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does the same from the close button", async () => {
    const editor = fakeEditor();
    const onClose = vi.fn();
    const { target } = render(FindBar, { editor, open: true, mode: "find", onClose });
    await tick();
    target.querySelector(".find-close").click();
    expect(editor.commands.setFindQuery).toHaveBeenLastCalledWith("");
    expect(editor.commands.focus).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
