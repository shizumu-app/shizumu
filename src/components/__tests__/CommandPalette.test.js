// The command palette (mod+K): page search, and the page's trail's rename
// and delete, which the owner looked for here and did not find (2026-10-28).
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

vi.mock("../../lib/api.js", () => ({
  getLineages: vi.fn(() => Promise.resolve([{ id: "L1", name: "the book", parent_id: null }])),
  searchPagesForMention: vi.fn(() =>
    Promise.resolve([{ page_id: "p9", date: "2026-10-27", page_number: 1, title: "ferry notes", lineage_id: "L1" }]),
  ),
}));

import CommandPalette from "../CommandPalette.svelte";

afterEach(cleanupAll);

async function settle() {
  await new Promise((r) => setTimeout(r, 80));
  await tick();
}

const labels = (target) => [...target.querySelectorAll(".palette-label")].map((n) => n.textContent.trim());

function type(target, text) {
  const input = target.querySelector(".palette-input");
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CommandPalette", () => {
  const trail = { id: "L1", name: "the book" };

  it("keeps the first row a page on an empty query, so Enter still opens it", async () => {
    // An action in the first row would turn the habit of mod+K, Enter
    // into a rename.
    const { target } = render(CommandPalette, { open: true, currentTrail: trail });
    await settle();
    expect(labels(target).some((l) => l.includes("trail “the book”"))).toBe(false);
  });

  it("finds delete for the page's trail by typing it, and sends it on Enter", async () => {
    const onManageTrail = vi.fn();
    const { target } = render(CommandPalette, { open: true, currentTrail: trail, onManageTrail });
    await settle();
    type(target, "del");
    await settle();
    expect(labels(target)[0]).toBe("delete trail “the book”…");
    target.querySelector(".palette-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(onManageTrail).toHaveBeenCalledWith("delete");
  });

  it("offers both actions for 'trail', and none on a page with no trail", async () => {
    const first = render(CommandPalette, { open: true, currentTrail: trail });
    await settle();
    type(first.target, "trail");
    await settle();
    expect(labels(first.target).slice(0, 2)).toEqual(["rename trail “the book”…", "delete trail “the book”…"]);
    cleanupAll();

    const second = render(CommandPalette, { open: true, currentTrail: null });
    await settle();
    type(second.target, "trail");
    await settle();
    expect(labels(second.target).some((l) => l.includes("trail “"))).toBe(false);
  });
});
