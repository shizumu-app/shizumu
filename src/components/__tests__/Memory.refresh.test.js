// Memory's 0.8.2 refresh (spec 2026-11-01 §2), on screen: the month window
// memory opens on is a visible, removable pill with a count line that says
// what it hides; the trails list has find-a-trail, pages · pins counts, and
// marks only continuous trails; the pins tab renders the panel's row.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const store = vi.hoisted(() => ({ pins: [], lineages: [] }));

vi.mock("../../lib/api.js", () => ({
  getThread: vi.fn(() => Promise.resolve([])),
  searchPages: vi.fn(() => Promise.resolve([])),
  getGroundData: vi.fn(() => Promise.resolve(null)),
  getLineages: vi.fn(() => Promise.resolve(store.lineages)),
  getTrailPageCounts: vi.fn(() => Promise.resolve([["s", 6], ["v", 2]])),
  getTrailPinCounts: vi.fn(() => Promise.resolve([["v", 3], [null, 4]])),
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve(null)),
  getPins: vi.fn((lid) => Promise.resolve(lid == null ? store.pins : [])),
  getPageForMention: vi.fn(() => Promise.resolve(null)),
  updatePinContent: vi.fn(() => Promise.resolve(null)),
  updatePinAutoInsert: vi.fn(() => Promise.resolve(null)),
  updatePinScope: vi.fn(() => Promise.resolve(null)),
  deletePin: vi.fn(() => Promise.resolve(null)),
  loadPageContentForModal: vi.fn(() => Promise.resolve(null)),
  savePageContentWithPinRefresh: vi.fn(() => Promise.resolve(null)),
  getBacklinksForPin: vi.fn(() => Promise.resolve([])),
  attachmentList: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import Memory from "../Memory.svelte";
import { getLocalDateStr } from "../../lib/utils.js";

vi.setConfig({ testTimeout: 30000 });
afterEach(cleanupAll);

const pin = (id, created_at) => ({
  id, lineage_id: null, source_page_id: "q", object_type: "note", title: `pin ${id}`,
  content: `text of ${id}`, status: "open", position: 0, auto_insert: 0, created_at, updated_at: created_at,
});

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no layout; the trail map scrolls today into view on mount.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  const today = getLocalDateStr();
  store.pins = [pin("a", `${today}T09:00:00Z`), pin("b", "2025-01-02T09:00:00Z"), pin("c", "2025-01-03T09:00:00Z"), pin("d", "2025-01-04T09:00:00Z")];
  store.lineages = [
    { id: "s", name: "shizumu", mode: "discrete", parent_id: null },
    { id: "v", name: "v0.8", mode: "discrete", parent_id: "s" },
    { id: "b", name: "the book", mode: "continuous", parent_id: null },
  ];
});

async function until(predicate, what) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
    await tick();
  }
  throw new Error(`timed out waiting for: ${what}`);
}
const button = (root, text) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const countLine = (root) => root.querySelector(".count-line")?.textContent.trim();

async function openPinsTab(target) {
  await until(() => button(target, "pins"), "the pins tab");
  button(target, "pins").click();
  await until(() => target.querySelectorAll(".panel-row").length > 0, "a pin row");
}

describe("memory: the month window is on screen", () => {
  it("names what it hides on the pins tab, and removing it shows everything", async () => {
    const { target } = render(Memory, { onNavigatePage: vi.fn() });
    await openPinsTab(target);
    await until(() => countLine(target)?.includes("of 4"), "the count line");

    expect(countLine(target)).toBe('1 of 4 pins · 3 hidden by "this month"');
    expect(target.querySelectorAll(".panel-row")).toHaveLength(1);
    const remove = target.querySelector('[aria-label="remove this month"]');
    expect(remove).not.toBeNull();

    remove.click();
    await until(() => countLine(target) === "4 pins", "every pin");
    expect(target.querySelectorAll(".panel-row")).toHaveLength(4);
    expect(target.querySelector(".active-filters")).toBeNull();
  });

  it("the pins tab counts pins, not pages", async () => {
    const { target } = render(Memory, { onNavigatePage: vi.fn() });
    await openPinsTab(target);
    await until(() => countLine(target), "the count line");
    expect(countLine(target)).not.toMatch(/page/);
  });

  it("a pin row in memory opens, and offers no `put on page` (memory hosts no page)", async () => {
    const { target } = render(Memory, { onNavigatePage: vi.fn() });
    await openPinsTab(target);
    const row = target.querySelector(".panel-row");
    expect(row.tagName).toBe("ARTICLE");
    expect(button(row, "open")).toBeTruthy();
    expect(button(row, "put on page")).toBeUndefined();
    expect(row.querySelector(".p-from").textContent).toMatch(/^everywhere · /);
  });
});

describe("memory: the trails list", () => {
  it("marks only continuous trails and shows pages · pins", async () => {
    const { target } = render(Memory, { onNavigatePage: vi.fn() });
    await until(() => target.textContent.includes("the book"), "the trails");
    await until(() => target.querySelector('[aria-label^="v0.8, 2 pages, 3 pins"]'), "the counts");
    const text = target.querySelector(".shell-sidebar").textContent;
    expect(text).not.toMatch(/discrete|continuous/);
    expect(target.querySelectorAll(".one-doc")).toHaveLength(1);
    expect(target.querySelector('[aria-label^="the book, one doc"]')).not.toBeNull();
    // "untrailed" once: the row, no heading above it.
    expect(text.match(/untrailed/g)).toHaveLength(1);
  });

  it("find a trail keeps a match's parent", async () => {
    const { target } = render(Memory, { onNavigatePage: vi.fn() });
    await until(() => target.textContent.includes("the book"), "the trails");
    const input = target.querySelector('input[aria-label="find a trail"]');
    input.value = "v0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => !target.querySelector(".shell-sidebar").textContent.includes("the book"), "the filter");
    const text = target.querySelector(".shell-sidebar").textContent;
    expect(text).toContain("shizumu");
    expect(text).toContain("v0.8");
  });
});
