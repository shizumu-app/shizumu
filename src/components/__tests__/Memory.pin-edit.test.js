// Review of task 9c: memory's pin modals wrote the pin ROW only. For a pin
// whose block is still on a page, the page's next save rewrote the row from
// the unedited block — and, since a save now sends the pins it rewrites to
// the other devices, sent the old text as the newest. A memory edit has to
// reach the block in the stored page, the way the pins panel's does.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const store = vi.hoisted(() => ({ rows: [], page: '{"type":"doc","content":[]}' }));

vi.mock("../../lib/api.js", () => ({
  getThread: vi.fn(() => Promise.resolve([])),
  searchPages: vi.fn(() => Promise.resolve([])),
  getGroundData: vi.fn(() => Promise.resolve(null)),
  getLineages: vi.fn(() => Promise.resolve([])),
  getTrailPageCounts: vi.fn(() => Promise.resolve([])),
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve(null)),
  getPins: vi.fn(() => Promise.resolve(store.rows)),
  getPageForMention: vi.fn(() => Promise.resolve(null)),
  updatePinContent: vi.fn(() => Promise.resolve(null)),
  deletePin: vi.fn(() => Promise.resolve(null)),
  loadPageContentForModal: vi.fn(() => Promise.resolve(store.page)),
  savePageContentWithPinRefresh: vi.fn(() => Promise.resolve(null)),
  getBacklinksForPin: vi.fn(() => Promise.resolve([])),
  attachmentList: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import * as api from "../../lib/api.js";
import Memory from "../Memory.svelte";

vi.setConfig({ testTimeout: 30000 });
afterEach(cleanupAll);
beforeEach(() => { vi.clearAllMocks(); store.rows = []; store.page = '{"type":"doc","content":[]}'; });

async function until(predicate, what) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
    await tick();
  }
  throw new Error(`timed out waiting for: ${what}`);
}

const para = (text) => ({ type: "paragraph", attrs: { pinId: "p1" }, content: [{ type: "text", text }] });
const docOf = (...nodes) => ({ type: "doc", content: nodes });
const row = (content) => ({
  id: "p1", lineage_id: null, source_page_id: "q", object_type: "note", title: "renamed on the phone",
  content, status: "open", position: 0, auto_insert: 0,
  created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z",
});

async function openPinsAndEdit(target, word) {
  await until(() => [...target.querySelectorAll("button")].some((b) => b.textContent.trim() === "pins"), "the pins tab");
  [...target.querySelectorAll("button")].find((b) => b.textContent.trim() === "pins").click();
  await until(() => target.querySelector(".kind-chip"), "the pin row");
  target.querySelector(".kind-chip").click();
  await until(() => document.querySelector(".note-modal-text") || document.querySelector(".modal-editor .ProseMirror")?.editor, "a pin editor");
  const note = document.querySelector(".note-modal-text");
  if (note) {
    note.value = `${note.value} ${word}`;
    note.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    const ed = document.querySelector(".modal-editor .ProseMirror").editor;
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, ` ${word}`);
  }
  await tick();
  document.querySelector(".modal-x").click();
}

const landed = () => api.updatePinContent.mock.calls.length > 0 || api.savePageContentWithPinRefresh.mock.calls.length > 0;

describe("a pin edited in memory", () => {
  it("is written into its block on the stored page while a page holds it", async () => {
    const node = para("ibis on the mudflat");
    store.rows = [row(JSON.stringify(node))];
    store.page = JSON.stringify(docOf({ type: "paragraph", content: [{ type: "text", text: "first line" }] }, node));
    const { target } = render(Memory, { onNavigatePage: vi.fn() });
    await openPinsAndEdit(target, "merlin");
    await until(landed, "the edit to land");

    expect(api.savePageContentWithPinRefresh).toHaveBeenCalledTimes(1);
    const [pageId, json] = api.savePageContentWithPinRefresh.mock.calls[0];
    expect(pageId).toBe("q");
    const saved = JSON.parse(json);
    // The block holds the edit and keeps its stamp; the page keeps its other line.
    expect(saved.content[1].attrs.pinId).toBe("p1");
    expect(JSON.stringify(saved.content[1])).toContain("merlin");
    expect(json).toContain("first line");
    // A row-only write is what the page's next save overwrote.
    expect(api.updatePinContent).not.toHaveBeenCalled();
  });

  it("a plain-text note whose block is on a page edits that block's text", async () => {
    store.rows = [row("ibis on the mudflat")];
    store.page = JSON.stringify(docOf(para("ibis on the mudflat")));
    const { target } = render(Memory, { onNavigatePage: vi.fn() });
    await openPinsAndEdit(target, "merlin");
    await until(landed, "the edit to land");

    expect(api.savePageContentWithPinRefresh).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(api.savePageContentWithPinRefresh.mock.calls[0][1]);
    expect(saved.content[0]).toEqual({ type: "paragraph", attrs: { pinId: "p1" }, content: [{ type: "text", text: "ibis on the mudflat merlin" }] });
    expect(api.updatePinContent).not.toHaveBeenCalled();
  });

  it("a pin whose block no page holds any more is edited in its row", async () => {
    // Orphaned: the frozen snapshot is all the pin is, so the row is right.
    store.rows = [row(JSON.stringify(para("ibis on the mudflat")))];
    store.page = JSON.stringify(docOf({ type: "paragraph", content: [{ type: "text", text: "the line was deleted" }] }));
    const { target } = render(Memory, { onNavigatePage: vi.fn() });
    await openPinsAndEdit(target, "merlin");
    await until(landed, "the edit to land");

    expect(api.savePageContentWithPinRefresh).not.toHaveBeenCalled();
    expect(api.updatePinContent).toHaveBeenCalledTimes(1);
    expect(api.updatePinContent.mock.calls[0][1]).toContain("merlin");
  });
});
