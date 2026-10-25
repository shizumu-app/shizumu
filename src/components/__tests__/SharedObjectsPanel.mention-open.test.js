// Clicking an @-mention of a pin opens that pin. The panel loads only this
// page's trail chain and the global pins, and the open effect looked only
// there: a mention of a pin on ANOTHER trail (the @ menu offers every trail's
// pins on an untrailed page) opened an empty "nothing matches" panel
// (scripts/desktop/scenarios/mentions-backlinks.mjs, 2026-10-24).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const elsewhere = {
  id: "p9", lineage_id: "LB", source_page_id: "other", object_type: "board", title: "grout and tile order",
  content: JSON.stringify({ type: "bulletList", attrs: { pinId: "p9" }, content: [] }),
  status: "open", position: 0, auto_insert: 0,
  created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z",
};

vi.mock("../../lib/api.js", () => ({
  getPins: vi.fn((lineageId) => Promise.resolve(lineageId === "LB" ? [elsewhere] : [])),
  getPinForReference: vi.fn(() => Promise.resolve({ id: "p9", lineage_id: "LB", title: "grout and tile order" })),
  updatePinContent: vi.fn(() => Promise.resolve(null)),
  updatePinScope: vi.fn(() => Promise.resolve(null)),
  deletePin: vi.fn(() => Promise.resolve(null)),
  getLineages: vi.fn(() => Promise.resolve([{ id: "LB", name: "kitchen", parent_id: null, mode: "discrete" }])),
  updatePinAutoInsert: vi.fn(() => Promise.resolve(null)),
  reorderPins: vi.fn(() => Promise.resolve(null)),
  loadPageContentForModal: vi.fn(() => Promise.resolve('{"type":"doc","content":[]}')),
  savePageContentWithPinRefresh: vi.fn(() => Promise.resolve(null)),
  getBacklinksForPin: vi.fn(() => Promise.resolve([])),
  attachmentList: vi.fn(() => Promise.resolve([])),
}));

import SharedObjectsPanel from "../SharedObjectsPanel.svelte";

vi.setConfig({ testTimeout: 30000 });
afterEach(cleanupAll);
beforeEach(() => vi.clearAllMocks());

async function until(predicate, what) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
    await tick();
  }
  throw new Error(`timed out waiting for: ${what}`);
}

describe("SharedObjectsPanel — a mention of a pin on another trail", () => {
  it("opens that pin", async () => {
    const onPinOpened = vi.fn();
    render(SharedObjectsPanel, {
      pageId: "here", lineageId: null, editorDoc: { type: "doc", content: [] },
      openPinId: "p9", onPinOpened, onClose: () => {},
    });
    await until(() => onPinOpened.mock.calls.length > 0, "the pin to open");
    // The pin's own modal, scoped to the trail it lives on.
    expect(document.body.textContent).toContain("kitchen");
    expect(document.body.textContent).toContain("inject here");
  });
});
