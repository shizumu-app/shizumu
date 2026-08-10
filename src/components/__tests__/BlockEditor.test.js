// BlockEditor — structured block (commitments/schema) with toggleable
// items. Covers item rendering, the toggle state transition (closed vs
// resolved by block type), adding an item, and read-only gating.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

vi.mock("../../lib/api.js", () => ({
  addBlockItem: vi.fn((blockId, text) =>
    Promise.resolve({ id: "new-item", text, state: "open" })
  ),
  updateBlockItemState: vi.fn(() => Promise.resolve()),
  updateBlockItemText: vi.fn(() => Promise.resolve()),
}));

import { addBlockItem, updateBlockItemState } from "../../lib/api.js";
import BlockEditor from "../BlockEditor.svelte";

afterEach(cleanupAll);
beforeEach(() => vi.clearAllMocks());

const block = (block_type = "commitment") => ({ id: "b1", block_type, name: "todo" });
const items = () => [
  { id: "i1", text: "alpha", state: "open" },
  { id: "i2", text: "bravo", state: "closed" },
];

// localItems is populated by an $effect that runs after mount, so every
// case awaits a tick before querying rows.
async function settle() {
  await Promise.resolve();
  await tick();
}

describe("BlockEditor", () => {
  it("renders one row per item and marks done items", async () => {
    const { target } = render(BlockEditor, { block: block(), items: items() });
    await settle();
    const rows = target.querySelectorAll(".block-item");
    expect(rows.length).toBe(2);
    expect(rows[0].classList.contains("done")).toBe(false);
    expect(rows[1].classList.contains("done")).toBe(true);
  });

  it("toggles an open commitment item to closed", async () => {
    const { target } = render(BlockEditor, { block: block("commitment"), items: items() });
    await settle();
    target.querySelectorAll(".item-toggle")[0].click();
    await settle();
    expect(updateBlockItemState).toHaveBeenCalledWith("i1", "closed");
    expect(target.querySelectorAll(".block-item")[0].classList.contains("done")).toBe(true);
  });

  it("resolves (not closes) items in a schema block", async () => {
    const { target } = render(BlockEditor, { block: block("schema"), items: items() });
    await settle();
    target.querySelectorAll(".item-toggle")[0].click();
    await settle();
    expect(updateBlockItemState).toHaveBeenCalledWith("i1", "resolved");
  });

  it("adds an item on Enter in the add field", async () => {
    const { target } = render(BlockEditor, { block: block(), items: items() });
    await settle();
    const add = target.querySelector(".add-input");
    add.value = "charlie";
    add.dispatchEvent(new Event("input", { bubbles: true }));
    add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    await settle(); // flush the addBlockItem promise + re-render

    expect(addBlockItem).toHaveBeenCalledWith("b1", "charlie");
    expect(target.querySelectorAll(".block-item").length).toBe(3);
  });

  it("is inert when read-only: no add field, toggle disabled", async () => {
    const { target } = render(BlockEditor, { block: block(), items: items(), readonly: true });
    await settle();
    expect(target.querySelector(".add-input")).toBeNull();
    expect(target.querySelector(".item-toggle").disabled).toBe(true);
  });
});
