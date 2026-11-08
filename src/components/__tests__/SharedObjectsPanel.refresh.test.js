// The 0.8.2 pins panel (spec 2026-11-01 §1), driven through the real
// component: the filters a writer could not reach are on screen with their
// counts, the row is not a button and every button has a name, unpin asks
// first, an untrailed page says what is true, and a docked panel leaves the
// page undimmed.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const store = vi.hoisted(() => ({ byTrail: {}, lineages: [] }));

vi.mock("../../lib/api.js", () => ({
  getPins: vi.fn((id) => Promise.resolve(store.byTrail[id ?? "null"] || [])),
  getPinForReference: vi.fn(() => Promise.resolve(null)),
  updatePinContent: vi.fn(() => Promise.resolve(null)),
  updatePinScope: vi.fn(() => Promise.resolve(null)),
  deletePin: vi.fn(() => Promise.resolve(null)),
  getLineages: vi.fn(() => Promise.resolve(store.lineages)),
  updatePinAutoInsert: vi.fn(() => Promise.resolve(null)),
  reorderPins: vi.fn(() => Promise.resolve(null)),
  loadPageContentForModal: vi.fn(() => Promise.resolve('{"type":"doc","content":[]}')),
  savePageContentWithPinRefresh: vi.fn(() => Promise.resolve(null)),
  getBacklinksForPin: vi.fn(() => Promise.resolve([])),
  attachmentList: vi.fn(() => Promise.resolve([])),
}));

import * as api from "../../lib/api.js";
import SharedObjectsPanel from "../SharedObjectsPanel.svelte";

vi.setConfig({ testTimeout: 30000 });
afterEach(cleanupAll);

async function until(predicate, what) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
    await tick();
  }
  throw new Error(`timed out waiting for: ${what}`);
}

const doc = (text) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
function pin(id, over = {}) {
  return {
    id, lineage_id: "v08", source_page_id: "elsewhere", object_type: "note", title: id,
    content: doc(`${id} body`), status: "open", position: 0, auto_insert: 0,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.lineages = [
    { id: "root", name: "shizumu", parent_id: null },
    { id: "v08", name: "v0.8", parent_id: "root" },
    { id: "garden", name: "garden", parent_id: null },
  ];
  const own = [pin("the tag", { auto_insert: 1 }), pin("the listing", { source_page_id: "p1" })];
  const parent = pin("the chip", { lineage_id: "root" });
  store.byTrail = {
    v08: [...own, parent],
    root: [parent],
    garden: [pin("roses", { lineage_id: "garden" })],
    null: [pin("anywhere", { lineage_id: null })],
  };
});

const chip = (target, label) => [...target.querySelectorAll(".f-chip")].find((b) => b.textContent.startsWith(label));
const titles = (target) => [...target.querySelectorAll(".p-title")].map((b) => b.textContent);

describe("the pins panel, 0.8.2", () => {
  it("shows every filter as a chip with its count — not only a search box", async () => {
    const { target } = render(SharedObjectsPanel, { lineageId: "v08", pageId: "p1", onClose: () => {} });
    await until(() => titles(target).length === 4, "the trail's pins");
    const labels = [...target.querySelectorAll(".f-chip")].map((b) => b.textContent);
    expect(labels).toEqual(["this trail4", "all trails5", "carries forward1", "on this page1", "kind ▾"]);
    expect(target.querySelector(".panel-title").textContent).toBe("pins · shizumu › v0.8");
  });

  it("chips narrow the list, and all trails reaches other trails' pins", async () => {
    const { target } = render(SharedObjectsPanel, { lineageId: "v08", pageId: "p1", onClose: () => {} });
    await until(() => titles(target).length === 4, "the trail's pins");
    chip(target, "carries forward").click();
    await until(() => titles(target).length === 1, "the carried pin alone");
    expect(titles(target)).toEqual(["the tag"]);
    chip(target, "carries forward").click();
    chip(target, "all trails").click();
    await until(() => titles(target).includes("roses"), "another trail's pin");
    expect(titles(target)).toHaveLength(5);
  });

  it("the source line shows only on pins from off this trail", async () => {
    const { target } = render(SharedObjectsPanel, { lineageId: "v08", pageId: "p1", onClose: () => {} });
    await until(() => titles(target).length === 4, "the trail's pins");
    const from = [...target.querySelectorAll(".p-from")].map((s) => s.textContent);
    expect(from).toEqual(["from shizumu (parent trail)", "from everywhere"]);
  });

  it("the row is not a button, and every button in it has a name", async () => {
    const { target } = render(SharedObjectsPanel, { lineageId: "v08", pageId: "p1", onClose: () => {} });
    await until(() => titles(target).length === 4, "the trail's pins");
    const row = target.querySelector(".panel-row");
    expect(row.tagName).toBe("ARTICLE");
    expect(row.getAttribute("role")).toBeNull();
    for (const b of target.querySelectorAll("button")) {
      const name = (b.getAttribute("aria-label") || b.textContent || "").trim();
      expect(name, b.outerHTML).not.toBe("");
    }
    const acts = [...row.querySelectorAll(".p-act")].map((b) => b.textContent);
    expect(acts).toEqual(["open", "put on page", "⋯"]);
  });

  it("unpin asks first; keep leaves the pin, unpin removes it", async () => {
    const { target } = render(SharedObjectsPanel, { lineageId: "v08", pageId: "p1", onClose: () => {} });
    await until(() => titles(target).length === 4, "the trail's pins");
    const more = () => target.querySelector(".panel-row .p-more");
    const item = (label) => [...target.querySelectorAll(".p-item")].find((b) => b.textContent === label);

    more().click();
    await until(() => item("unpin…"), "the unpin item");
    item("unpin…").click();
    await until(() => target.querySelector(".p-confirm"), "the question");
    expect(api.deletePin).not.toHaveBeenCalled();
    target.querySelector(".confirm-no").click();
    await tick();
    expect(api.deletePin).not.toHaveBeenCalled();
    expect(titles(target)).toHaveLength(4);

    more().click();
    await until(() => item("unpin…"), "the unpin item");
    item("unpin…").click();
    await until(() => target.querySelector(".confirm-yes"), "the confirm button");
    target.querySelector(".confirm-yes").click();
    await until(() => titles(target).length === 3, "the pin gone");
    expect(api.deletePin).toHaveBeenCalledTimes(1);
  });

  it("an untrailed page with nothing pinned says it has no trail, and offers one", async () => {
    store.byTrail = {};
    const onChooseTrail = vi.fn();
    const { target } = render(SharedObjectsPanel, { lineageId: null, pageId: "p1", onClose: () => {}, onChooseTrail });
    await until(() => target.querySelector(".empty"), "the empty state");
    expect(target.querySelector(".empty-title").textContent).toBe("this page has no trail yet.");
    expect(target.querySelector(".empty").textContent).not.toContain("nothing matches");
    const btn = [...target.querySelectorAll(".empty button")].find((b) => b.textContent.includes("choose a trail"));
    btn.click();
    expect(onChooseTrail).toHaveBeenCalledTimes(1);
  });

  it("a search with no result says nothing matches and clears", async () => {
    const { target } = render(SharedObjectsPanel, { lineageId: "v08", pageId: "p1", onClose: () => {} });
    await until(() => titles(target).length === 4, "the trail's pins");
    const input = target.querySelector(".panel-search input");
    input.value = "zzz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => target.querySelector(".empty"), "the empty state");
    expect(target.querySelector(".empty-title").textContent).toBe("nothing matches");
    [...target.querySelectorAll(".empty button")].find((b) => b.textContent.includes("clear filters")).click();
    await until(() => titles(target).length === 4, "the pins back");
  });

  it("docked, the page is not dimmed and Escape hands the caret back without closing", async () => {
    const onClose = vi.fn();
    const onReturnToEditor = vi.fn();
    const { target } = render(SharedObjectsPanel, { lineageId: "v08", pageId: "p1", docked: true, onClose, onReturnToEditor });
    await until(() => titles(target).length === 4, "the trail's pins");
    expect(target.querySelector(".overlay")).toBeNull();
    target.querySelector(".p-title").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onReturnToEditor).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("as an overlay, the page is dimmed and Escape closes the panel", async () => {
    const onClose = vi.fn();
    const { target } = render(SharedObjectsPanel, { lineageId: "v08", pageId: "p1", docked: false, onClose });
    await until(() => titles(target).length === 4, "the trail's pins");
    expect(target.querySelector(".overlay")).not.toBeNull();
    target.querySelector(".p-title").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
