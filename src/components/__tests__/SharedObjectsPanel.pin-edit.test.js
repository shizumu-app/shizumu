// Sync journey J2: two ways an edit made in the pins panel was lost.
//
// J2.14 — a paragraph pin whose node was in the open editor opened the NOTE
// modal (effectivePin hands the row's live text to the panel), and the note
// modal writes only the pin row. The page kept the old node, and its next
// save ran refresh_pin_caches, which rewrote the row from that node: the
// edit was gone. The node is the pin while a page holds it.
//
// J2.8 — the open editor did not hold the pin's stamp, the artifact modal's
// same-page save spliced into it, the splice found nothing and returned
// false, and nothing checked: the edit was lost without a word.
//
// Each test drives the real row click and modal close and asserts where the
// edit landed (pin-edit-route.js names the order).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const store = vi.hoisted(() => ({ rows: [], page: '{"type":"doc","content":[]}' }));

vi.mock("../../lib/api.js", () => ({
  getPins: vi.fn(() => Promise.resolve(store.rows)),
  updatePinContent: vi.fn(() => Promise.resolve(null)),
  updatePinScope: vi.fn(() => Promise.resolve(null)),
  deletePin: vi.fn(() => Promise.resolve(null)),
  getLineages: vi.fn(() => Promise.resolve([])),
  updatePinAutoInsert: vi.fn(() => Promise.resolve(null)),
  reorderPins: vi.fn(() => Promise.resolve(null)),
  loadPageContentForModal: vi.fn(() => Promise.resolve(store.page)),
  savePageContentWithPinRefresh: vi.fn(() => Promise.resolve(null)),
  getBacklinksForPin: vi.fn(() => Promise.resolve([])),
  attachmentList: vi.fn(() => Promise.resolve([])),
}));

import * as api from "../../lib/api.js";
import SharedObjectsPanel from "../SharedObjectsPanel.svelte";

vi.setConfig({ testTimeout: 30000 });

afterEach(cleanupAll);
beforeEach(() => {
  vi.clearAllMocks();
  store.rows = [];
  store.page = '{"type":"doc","content":[]}';
});

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

function pinRow(node) {
  return {
    id: "p1", lineage_id: null, source_page_id: "q", object_type: "note", title: "renamed on the phone",
    content: JSON.stringify(docOf(node)), status: "open", position: 0, auto_insert: 0,
    created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z",
  };
}

// Click the row, type at the end of whichever editor the panel opened, close.
async function editPin(target, word) {
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

const landed = (onSamePagePinSave) => () =>
  api.updatePinContent.mock.calls.length > 0 ||
  api.savePageContentWithPinRefresh.mock.calls.length > 0 ||
  onSamePagePinSave.mock.calls.length > 0 ||
  !!document.querySelector(".edit-notice");

describe("an edit to a pin reaches the node that is the pin", () => {
  it("a paragraph pin whose node is in the editor is edited in that node, not only in the row", async () => {
    const node = para("ibis on the mudflat");
    store.rows = [pinRow(node)];
    const onSamePagePinSave = vi.fn(() => true);
    const { target } = render(SharedObjectsPanel, {
      pageId: "q", editorDoc: docOf(node), onClose: () => {}, onSamePagePinSave,
    });
    await editPin(target, "merlin");
    await until(landed(onSamePagePinSave), "the edit to land somewhere");

    expect(document.querySelector(".note-modal-text"), "the note modal can only write the row").toBeNull();
    expect(onSamePagePinSave).toHaveBeenCalledTimes(1);
    const [pinId, spliced] = onSamePagePinSave.mock.calls[0];
    expect(pinId).toBe("p1");
    expect(JSON.stringify(spliced)).toContain("merlin");
    // The node keeps its stamp, or the splice would unpin the line.
    expect(spliced.attrs.pinId).toBe("p1");
    // A row-only write is what the page's next save overwrote.
    expect(api.updatePinContent).not.toHaveBeenCalled();
  });

  it("a pin over several blocks opens on all of them and saves all of them", async () => {
    // The panel kept one node per pin id (the last one walked), so the
    // modal opened on that block alone and its save handed back one block
    // to replace the whole run, deleting the others from the page (found
    // reviewing the J12 journey, 2026-10-28).
    const blocks = [para("the ferry leaves at six"), para("the harbour master is gruff"), para("ask about the night boat")];
    store.rows = [{ ...pinRow(blocks[0]), object_type: "board", content: JSON.stringify(docOf(...blocks)) }];
    const onSamePagePinSave = vi.fn(() => true);
    const { target } = render(SharedObjectsPanel, {
      pageId: "q", editorDoc: docOf({ type: "paragraph", content: [{ type: "text", text: "chapter three" }] }, ...blocks), onClose: () => {}, onSamePagePinSave,
    });
    await editPin(target, "merlin");
    await until(landed(onSamePagePinSave), "the edit to land somewhere");

    expect(onSamePagePinSave).toHaveBeenCalledTimes(1);
    const [, spliced] = onSamePagePinSave.mock.calls[0];
    expect(spliced.type).toBe("doc");
    expect(spliced.content.map((n) => n.content[0].text)).toEqual([
      "the ferry leaves at six",
      "the harbour master is gruff",
      "ask about the night boat merlin",
    ]);
  });

  it("when the editor does not hold the stamp, the edit goes to the stored page and the editor re-reads it", async () => {
    const node = para("ibis on the mudflat");
    store.rows = [pinRow(node)];
    store.page = JSON.stringify(docOf({ type: "paragraph", content: [{ type: "text", text: "first line" }] }, node));
    const onSamePagePinSave = vi.fn(() => false);
    const onPageWritten = vi.fn();
    const onBeforePageWrite = vi.fn(async () => {});
    const { target } = render(SharedObjectsPanel, {
      pageId: "q", editorDoc: docOf({ type: "paragraph", content: [{ type: "text", text: "first line" }] }),
      onClose: () => {}, onSamePagePinSave, onPageWritten, onBeforePageWrite,
    });
    await editPin(target, "merlin");
    await until(() => api.savePageContentWithPinRefresh.mock.calls.length > 0 || !!document.querySelector(".edit-notice"), "the stored page to be written");

    const [pageId, json] = api.savePageContentWithPinRefresh.mock.calls[0];
    expect(pageId).toBe("q");
    expect(json).toContain("merlin");
    expect(json).toContain("first line");
    expect(onPageWritten).toHaveBeenCalledWith("q");
    // The open editor's pending save lands first, then the stored page is
    // read: otherwise that save, a moment later, writes its copy without
    // the edited node over this one.
    expect(onBeforePageWrite).toHaveBeenCalledWith("q");
    expect(onBeforePageWrite.mock.invocationCallOrder[0])
      .toBeLessThan(api.loadPageContentForModal.mock.invocationCallOrder[0]);
  });

  it("an editor that was expected to hold the node and did not hands the edit on", async () => {
    // livePinNodes comes from the editorDoc prop, the splice from the editor
    // itself; the two can disagree for a moment. A false splice must not
    // end the write.
    const node = para("ibis on the mudflat");
    store.rows = [pinRow(node)];
    store.page = JSON.stringify(docOf(node));
    const onSamePagePinSave = vi.fn(() => false);
    const { target } = render(SharedObjectsPanel, {
      pageId: "q", editorDoc: docOf(node), onClose: () => {}, onSamePagePinSave,
    });
    await editPin(target, "merlin");
    await until(() => api.savePageContentWithPinRefresh.mock.calls.length > 0 || !!document.querySelector(".edit-notice"), "the stored page to be written");

    expect(onSamePagePinSave).toHaveBeenCalledTimes(1);
    expect(api.savePageContentWithPinRefresh.mock.calls[0][1]).toContain("merlin");
  });

  it("an edit nothing takes is said on screen", async () => {
    const node = para("ibis on the mudflat");
    store.rows = [pinRow(node)];
    api.loadPageContentForModal.mockRejectedValueOnce(new Error("disk"));
    api.updatePinContent.mockRejectedValueOnce(new Error("disk"));
    const onSamePagePinSave = vi.fn(() => false);
    const { target } = render(SharedObjectsPanel, {
      pageId: "q", editorDoc: null, onClose: () => {}, onSamePagePinSave,
    });
    await editPin(target, "merlin");
    await until(() => !!target.querySelector(".edit-notice"), "the notice");
    expect(target.querySelector(".edit-notice").textContent).toContain("did not save");
  });

  it("a rename that lands nowhere is said, and the old name comes back", async () => {
    // The inline rename's failures went to console.error only.
    store.rows = [pinRow(para("ibis on the mudflat"))];
    api.updatePinContent.mockRejectedValueOnce(new Error("disk"));
    const { target } = render(SharedObjectsPanel, {
      pageId: "q", editorDoc: null, onClose: () => {}, onSamePagePinSave: vi.fn(() => false),
    });
    await until(() => target.querySelector(".row-title"), "the pin row");
    target.querySelector(".row-title").click();
    await until(() => document.getElementById("pin-rename-p1"), "the rename input");
    const input = document.getElementById("pin-rename-p1");
    input.value = "shorebirds";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await until(() => !!target.querySelector(".edit-notice"), "the notice");
    expect(target.querySelector(".edit-notice").textContent).toContain("rename did not save");
    await until(() => (target.querySelector(".row-title")?.textContent || "").includes("renamed on the phone"), "the old name back");
  });

  it("a plain-text note whose block is on another page edits that block, not only the row", async () => {
    // The note modal opens only for a pin whose node is not in this editor.
    // Its row-only write was overwritten by the other page's next save.
    store.rows = [{ ...pinRow(para("x")), content: "ibis on the mudflat" }];
    store.page = JSON.stringify(docOf(para("ibis on the mudflat")));
    const onSamePagePinSave = vi.fn(() => false);
    const { target } = render(SharedObjectsPanel, {
      pageId: "today", editorDoc: null, onClose: () => {}, onSamePagePinSave,
    });
    await editPin(target, "merlin");
    await until(landed(onSamePagePinSave), "the edit to land somewhere");
    expect(api.savePageContentWithPinRefresh).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(api.savePageContentWithPinRefresh.mock.calls[0][1]);
    expect(saved.content[0].attrs.pinId).toBe("p1");
    expect(JSON.stringify(saved.content[0])).toContain("merlin");
    expect(api.updatePinContent).not.toHaveBeenCalled();
  });
});
