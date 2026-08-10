// Thread (chronological memory): loads pages via getThread, splits open vs
// closed, runs a debounced full-text search, and routes back to the page.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

vi.mock("../../lib/api.js", () => ({
  getThread: vi.fn(() => Promise.resolve([])),
  searchPages: vi.fn(() => Promise.resolve([])),
}));

import { getThread, searchPages } from "../../lib/api.js";
import Thread from "../Thread.svelte";

afterEach(cleanupAll);
beforeEach(() => vi.clearAllMocks());

const summary = (id, extra = {}) => ({
  id,
  date: "2020-01-15",
  page_number: 1,
  is_open: false,
  what_matters_now: id,
  preview_lines: [],
  backlink_count: 0,
  ...extra,
});

async function settle(ms = 0) {
  await new Promise((r) => setTimeout(r, ms));
  await tick();
}

describe("Thread", () => {
  it("shows the empty state when there is nothing", async () => {
    getThread.mockResolvedValue([]);
    const { target } = render(Thread, { onNavigatePage: vi.fn() });
    await settle();
    expect(target.querySelector(".empty-state")?.textContent).toContain("nothing here yet");
  });

  it("separates open pages from dated closed pages", async () => {
    getThread.mockResolvedValue([
      summary("open-one", { is_open: true, what_matters_now: "open-one" }),
      summary("closed-one", { is_open: false, what_matters_now: "closed-one" }),
    ]);
    const { target } = render(Thread, { onNavigatePage: vi.fn() });
    await settle();
    expect(target.textContent).toContain("open pages");
    expect(target.textContent).toContain("open-one");
    expect(target.textContent).toContain("closed-one");
  });

  it("runs a debounced search and shows the result count", async () => {
    getThread.mockResolvedValue([]);
    searchPages.mockResolvedValue([summary("hit-1"), summary("hit-2")]);
    const { target } = render(Thread, { onNavigatePage: vi.fn() });
    await settle();

    const input = target.querySelector("input.search-input");
    input.value = "needle";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(260); // past the 200ms debounce

    expect(searchPages).toHaveBeenCalledWith("needle");
    expect(target.querySelector(".result-count")?.textContent).toContain("2 pages");
  });

  it("routes back to the page via the back button", async () => {
    const onNavigatePage = vi.fn();
    getThread.mockResolvedValue([]);
    const { target } = render(Thread, { onNavigatePage });
    await settle();
    target.querySelector(".back-btn").click();
    expect(onNavigatePage).toHaveBeenCalledTimes(1);
  });
});
