// Backlinks loads referencing pages via the api, dedupes by page_id, and
// navigates on click. Asserts row count + navigation rather than exact
// label text (label assembly is covered by mention-label tests).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

vi.mock("../../lib/api.js", () => ({
  getBacklinksForPage: vi.fn(() => Promise.resolve([])),
  getLineages: vi.fn(() => Promise.resolve([])),
}));

import { getBacklinksForPage } from "../../lib/api.js";
import Backlinks from "../Backlinks.svelte";

afterEach(cleanupAll);
beforeEach(() => vi.clearAllMocks());

// Flush microtasks + the macrotask queue so the async load() settles.
async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

const row = (page_id) => ({ page_id, date: "2026-05-20", page_number: 1, lineage_id: null });

describe("Backlinks", () => {
  it("renders one row per distinct referencing page", async () => {
    getBacklinksForPage.mockResolvedValue([row("pA"), row("pB")]);
    const { target } = render(Backlinks, { pageId: "target", onNavigate: vi.fn() });
    await settle();
    expect(target.querySelectorAll("button.backlink").length).toBe(2);
  });

  it("dedupes repeated page_ids", async () => {
    getBacklinksForPage.mockResolvedValue([row("pA"), row("pA"), row("pB")]);
    const { target } = render(Backlinks, { pageId: "target", onNavigate: vi.fn() });
    await settle();
    expect(target.querySelectorAll("button.backlink").length).toBe(2);
  });

  it("navigates to the page on click", async () => {
    const onNavigate = vi.fn();
    getBacklinksForPage.mockResolvedValue([row("pA"), row("pB")]);
    const { target } = render(Backlinks, { pageId: "target", onNavigate });
    await settle();
    target.querySelectorAll("button.backlink")[1].click();
    expect(onNavigate).toHaveBeenCalledWith("pB");
  });

  it("renders nothing when there are no backlinks", async () => {
    getBacklinksForPage.mockResolvedValue([]);
    const { target } = render(Backlinks, { pageId: "target", onNavigate: vi.fn() });
    await settle();
    expect(target.querySelector(".backlinks")).toBeNull();
  });
});
