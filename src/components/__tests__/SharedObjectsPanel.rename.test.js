// Issue #1 — renaming a pin wrote the new title into the pin's NODE, and a
// node that declares no `blockTitle` attr (a paragraph, a heading, the
// paragraph holding a file chip) silently dropped it. The panel showed the
// new name because of the optimistic patch, then the next save of the page
// re-derived a null out of that node and the name was gone.
//
// These two drive the real inline-rename affordance and assert only where
// the write LANDED — the routing is the whole fix.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const pins = vi.hoisted(() => ({ rows: [] }));

vi.mock("../../lib/api.js", () => ({
  getPins: vi.fn(() => Promise.resolve(pins.rows)),
  updatePinContent: vi.fn(() => Promise.resolve(null)),
  updatePinScope: vi.fn(() => Promise.resolve(null)),
  deletePin: vi.fn(() => Promise.resolve(null)),
  getLineages: vi.fn(() => Promise.resolve([])),
  updatePinAutoInsert: vi.fn(() => Promise.resolve(null)),
  reorderPins: vi.fn(() => Promise.resolve(null)),
  loadPageContentForModal: vi.fn(() => Promise.resolve('{"type":"doc","content":[]}')),
  savePageContentWithPinRefresh: vi.fn(() => Promise.resolve(null)),
  getBacklinksForPin: vi.fn(() => Promise.resolve([])),
  attachmentList: vi.fn(() => Promise.resolve([])),
}));

import * as api from "../../lib/api.js";
import SharedObjectsPanel from "../SharedObjectsPanel.svelte";

// Mounting the whole panel costs seconds under a loaded full-suite run;
// the 5s default is for catching hangs, not setup cost.
vi.setConfig({ testTimeout: 30000 });

afterEach(cleanupAll);
beforeEach(() => { vi.clearAllMocks(); pins.rows = []; });

// Wait on the condition, not on a guessed number of turns: the panel's
// pin load is a promise chain whose length is an implementation detail.
async function until(predicate, what) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
    await tick();
  }
  throw new Error(`timed out waiting for: ${what}`);
}

function pinRow({ id, object_type, node, title = null }) {
  return {
    id,
    lineage_id: null,
    source_page_id: "p1",
    object_type,
    title,
    content: JSON.stringify({ type: "doc", content: [node] }),
    status: "open",
    position: 0,
    auto_insert: 0,
    created_at: "2026-09-03T00:00:00Z",
    updated_at: "2026-09-03T00:00:00Z",
  };
}

async function rename(target, pinId, text, landed) {
  await until(() => target.querySelector(".row-title"), "the pin row to render");
  target.querySelector(".row-title").click();
  await until(() => document.getElementById(`pin-rename-${pinId}`), "the rename input");
  const input = document.getElementById(`pin-rename-${pinId}`);
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  // Wait for the write to land SOMEWHERE before asserting where. Waiting on
  // the specific expected call would make the negative half of each
  // assertion pass by arriving early.
  await until(landed, "the rename to reach a backend");
}

const landedAnywhere = (onSamePagePinSave) => () =>
  api.updatePinContent.mock.calls.length > 0 ||
  api.savePageContentWithPinRefresh.mock.calls.length > 0 ||
  onSamePagePinSave.mock.calls.length > 0;

describe("inline rename routes the title to the home the pin actually has", () => {
  it("a note pin's title goes to the row — its paragraph cannot hold one", async () => {
    pins.rows = [pinRow({
      id: "pin-note",
      object_type: "note",
      node: { type: "paragraph", attrs: { pinId: "pin-note" }, content: [{ type: "text", text: "milk" }] },
    })];
    const onSamePagePinSave = vi.fn();
    const { target } = render(SharedObjectsPanel, {
      pageId: "p1", editorDoc: null, onClose: () => {}, onSamePagePinSave,
    });
    await rename(target, "pin-note", "grocery list", landedAnywhere(onSamePagePinSave));

    expect(api.updatePinContent).toHaveBeenCalledTimes(1);
    expect(api.updatePinContent.mock.calls[0][0]).toBe("pin-note");
    expect(api.updatePinContent.mock.calls[0][2]).toBe("grocery list");
    // No splice: there is no slot in a paragraph to splice a title into,
    // and the save it would trigger is what used to erase the row.
    expect(onSamePagePinSave).not.toHaveBeenCalled();
    expect(api.savePageContentWithPinRefresh).not.toHaveBeenCalled();
  });

  it("a board pin's title still goes to its node — the slot is on the page", async () => {
    pins.rows = [pinRow({
      id: "pin-board",
      object_type: "board",
      node: {
        type: "blockquote",
        attrs: { pinId: "pin-board", blockTitle: null },
        content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }],
      },
    })];
    const onSamePagePinSave = vi.fn();
    const { target } = render(SharedObjectsPanel, {
      pageId: "p1",
      editorDoc: {
        type: "doc",
        content: [{
          type: "blockquote",
          attrs: { pinId: "pin-board", blockTitle: null },
          content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }],
        }],
      },
      onClose: () => {},
      onSamePagePinSave,
    });
    await rename(target, "pin-board", "the argument", landedAnywhere(onSamePagePinSave));

    expect(onSamePagePinSave).toHaveBeenCalledTimes(1);
    expect(onSamePagePinSave.mock.calls[0][1].attrs.blockTitle).toBe("the argument");
    // The row write would race the page save that re-derives the title
    // from the node; exactly one of the two paths must run.
    expect(api.updatePinContent).not.toHaveBeenCalled();
  });

  it("a file pin's title goes to the row too — its node is a paragraph, not a board", async () => {
    // The panel groups object_type "file" WITH the boards for rendering, so
    // routing on that grouping instead of on the node is the trap this test
    // exists to hold shut.
    pins.rows = [pinRow({
      id: "pin-file",
      object_type: "file",
      node: {
        type: "paragraph",
        attrs: { pinId: "pin-file" },
        content: [{ type: "attachment", attrs: { filename: "notes.pdf", kind: "file" } }],
      },
    })];
    const onSamePagePinSave = vi.fn();
    const { target } = render(SharedObjectsPanel, {
      pageId: "p1", editorDoc: null, onClose: () => {}, onSamePagePinSave,
    });
    await rename(target, "pin-file", "the brief", landedAnywhere(onSamePagePinSave));

    expect(api.updatePinContent).toHaveBeenCalledTimes(1);
    expect(api.updatePinContent.mock.calls[0][2]).toBe("the brief");
    expect(onSamePagePinSave).not.toHaveBeenCalled();
  });
});
