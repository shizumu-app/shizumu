// src/components/editor/__tests__/EditorCore.test.js
// The core's wiring contract: it builds the editor, hands it to chrome,
// saves after the debounce, publishes a snapshot, stamps pins, moves
// blocks. Extensions are stubbed to a minimal set so this tests the core's
// plumbing, not TipTap.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { get } from "svelte/store";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";

vi.mock("../../../lib/api.js", () => ({
  savePageContent: vi.fn(() => Promise.resolve()),
  saveTrailContent: vi.fn(() => Promise.resolve()),
  createPin: vi.fn(() => Promise.resolve({ id: "pin-1" })),
  getPins: vi.fn(() => Promise.resolve([{ content: "already" }])),
  attachmentAddBytes: vi.fn(() => Promise.resolve({})),
  updatePinContent: vi.fn(() => Promise.resolve()),
  updatePinStatus: vi.fn(() => Promise.resolve()),
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../../lib/yjs/feature-flag.js", () => ({ isYjsEnabled: vi.fn(() => Promise.resolve(false)) }));
vi.mock("../../../lib/render/shared-extensions.js", async () => {
  const { Document } = await import("@tiptap/extension-document");
  const { Paragraph } = await import("@tiptap/extension-paragraph");
  const { Text } = await import("@tiptap/extension-text");
  const { Blockquote } = await import("@tiptap/extension-blockquote");
  const { UndoRedo } = await import("@tiptap/extensions");
  const { BlockTitle } = await import("../../../lib/extensions/block-title.js");
  const { PinId } = await import("../../../lib/extensions/pin-id.js");
  const { BlockMovement } = await import("../../../lib/extensions/block-movement.js");
  // A divider: the one block kind here that carries no pinId.
  const { HorizontalRule } = await import("@tiptap/extension-horizontal-rule");
  return {
    READONLY_EXTENSIONS: [],
    buildEditingExtensions: () => [Document, Paragraph, Text, Blockquote, HorizontalRule, UndoRedo, BlockTitle, PinId, BlockMovement],
  };
});

import { savePageContent, createPin, updatePinContent } from "../../../lib/api.js";
import EditorCore from "../EditorCore.svelte";

afterEach(() => { cleanupAll(); vi.useRealTimers(); });
beforeEach(() => vi.clearAllMocks());

const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const doc = (...nodes) => ({ type: "doc", content: nodes });

// onMount awaits a tick before constructing the editor; give it three
// microtask/tick rounds so onEditor has fired before we assert.
async function settle() {
  for (let i = 0; i < 3; i++) { await Promise.resolve(); await tick(); }
}

async function mountCore(props = {}) {
  const onEditor = vi.fn();
  const r = render(EditorCore, { pageId: "p1", initialContent: doc(para("a")), onEditor, ...props });
  await settle();
  return { ...r, onEditor, editor: onEditor.mock.calls.at(-1)?.[0] };
}

describe("EditorCore", () => {
  it("renders only the editor mount and hands the editor to chrome", async () => {
    const { target, editor, onEditor } = await mountCore();
    expect(target.children.length).toBe(1);
    expect(target.firstElementChild.classList.contains("tiptap-editor")).toBe(true);
    expect(target.firstElementChild.classList.contains("prose")).toBe(true);
    expect(onEditor).toHaveBeenCalledTimes(1);
    expect(editor.state.doc.textContent).toBe("a");
  });

  // flushPendingSave is main's TipTapEditor.flushPendingSave carried across
  // the split. A pin edit that writes this page's stored copy calls it first
  // so the debounced save cannot land a moment later over that write. Its
  // callers reach it with optional chaining, so losing it is silent: these
  // are what say so.
  it("flushPendingSave runs the pending save once, and resolves only after it lands", async () => {
    vi.useFakeTimers();
    const { instance, editor } = await mountCore();
    await vi.advanceTimersByTimeAsync(2000); // the page as opened is saved and settled
    savePageContent.mockClear();
    let land;
    savePageContent.mockImplementationOnce(() => new Promise((r) => { land = r; }));
    editor.commands.insertContentAt(2, "b");

    let done = false;
    const flushed = instance.flushPendingSave().then(() => { done = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(savePageContent).toHaveBeenCalledTimes(1);
    expect(savePageContent.mock.calls[0][1]).toContain("ab");
    expect(done).toBe(false);
    land();
    await flushed;
    expect(done).toBe(true);
    // The debounce it replaced does not fire a second save.
    await vi.advanceTimersByTimeAsync(2000);
    expect(savePageContent).toHaveBeenCalledTimes(1);
  });

  it("flushPendingSave saves nothing when no save is pending", async () => {
    // Nothing typed since the last save: there is nothing to land, and a
    // save here would rewrite the page for no edit.
    vi.useFakeTimers();
    const { instance } = await mountCore();
    await vi.advanceTimersByTimeAsync(2000);
    savePageContent.mockClear();
    await instance.flushPendingSave();
    expect(savePageContent).not.toHaveBeenCalled();
  });

  it("does not save what a sync pull put in the editor", async () => {
    // The other device's copy, written without the pinId attrs this editor
    // adds to every paragraph. Saving it back would stamp the other device's
    // words with a new time here, and that newer write beats whatever the
    // other device typed in the same seconds: measured on an A16 and a
    // laptop with one page open on both, the laptop's sentence was erased by
    // the phone re-saving the laptop's previous copy (2026-10-16).
    vi.useFakeTimers();
    const { instance } = await mountCore();
    await vi.advanceTimersByTimeAsync(2000); // the page as opened is saved and settled
    savePageContent.mockClear();
    instance.reloadFromContent(JSON.stringify(doc(para("from the laptop"))));
    expect(instance.getEditor().state.doc.textContent).toBe("from the laptop");
    await vi.advanceTimersByTimeAsync(5000);
    expect(savePageContent).not.toHaveBeenCalled();
  });

  it("still saves typing that follows a pull", async () => {
    vi.useFakeTimers();
    const { instance, editor } = await mountCore();
    await vi.advanceTimersByTimeAsync(2000);
    savePageContent.mockClear();
    instance.reloadFromContent(JSON.stringify(doc(para("from the laptop"))));
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " and the phone");
    await vi.advanceTimersByTimeAsync(1000);
    expect(savePageContent).toHaveBeenCalledTimes(1);
    expect(savePageContent.mock.calls[0][1]).toContain("and the phone");
  });

  it("says when a save fails, tries again on its own, and stops saying so once one lands", async () => {
    // Until 2026-10-15 a failed save was console.error and nothing else:
    // the writer typed on into a page nothing was keeping.
    const { saveHealth, _resetSaveHealth } = await import("../../../lib/save-health.js");
    const { get } = await import("svelte/store");
    _resetSaveHealth();
    const { editor } = await mountCore();
    vi.useFakeTimers();
    savePageContent.mockRejectedValueOnce("disk I/O error");
    editor.commands.insertContentAt(2, "b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(get(saveHealth).failing).toBe(true);

    // Nobody types again; the retry alone writes the words.
    await vi.advanceTimersByTimeAsync(2000);
    expect(savePageContent).toHaveBeenCalledTimes(2);
    expect(JSON.parse(savePageContent.mock.calls[1][1]).content[0].content[0].text).toBe("ab");
    expect(get(saveHealth).failing).toBe(false);
  });

  it("saves the page one second after an edit", async () => {
    const { editor } = await mountCore();
    vi.useFakeTimers();
    editor.commands.insertContentAt(2, "b");
    expect(savePageContent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(savePageContent).toHaveBeenCalledTimes(1);
    const [pageId, json] = savePageContent.mock.calls[0];
    expect(pageId).toBe("p1");
    expect(JSON.parse(json).content[0].content[0].text).toBe("ab");
  });

  it("publishes a snapshot that follows the selection", async () => {
    const { instance, editor } = await mountCore({ initialContent: doc(para("hello")) });
    expect(get(instance.snapshot).selectionEmpty).toBe(true);
    editor.commands.setTextSelection({ from: 2, to: 4 });
    expect(get(instance.snapshot)).toMatchObject({ selectionEmpty: false, from: 2, to: 4 });
  });

  it("calls the chrome hooks in the order the chrome relies on", async () => {
    const calls = [];
    const { editor } = await mountCore({
      onUpdate: () => calls.push("update"),
      onSelectionUpdate: () => calls.push("selection"),
      onTransaction: () => calls.push("transaction"),
      onWordCount: () => calls.push("wordCount"),
    });
    calls.length = 0;
    editor.commands.insertContentAt(2, "b");
    // TipTap 3.29's dispatchTransaction fires, in order: transaction,
    // then selectionUpdate, then focus/blur, then update. Chrome relies on
    // selectionUpdate's handler landing before update's repeat of the same
    // calls, so assert the seam by position, not just presence.
    expect(calls.indexOf("transaction")).toBeLessThan(calls.indexOf("selection"));
    expect(calls.indexOf("selection")).toBeLessThan(calls.indexOf("update"));
    expect(calls.indexOf("update")).toBeLessThan(calls.indexOf("wordCount"));
  });

  it("knows which content is already pinned on this lineage", async () => {
    const { instance } = await mountCore({ lineageId: "l1" });
    expect(instance.hasPinnedContent("already")).toBe(true);
    expect(instance.hasPinnedContent("not yet")).toBe(false);
    instance.invalidatePinContent("already");
    expect(instance.hasPinnedContent("already")).toBe(false);
  });

  it("confirmPin stamps the board, re-serialises, flushes and reports", async () => {
    const onPinCreated = vi.fn();
    const content = doc({ type: "blockquote", content: [para("keep")] });
    const { instance, editor } = await mountCore({ initialContent: content, onPinCreated });
    const pinContent = JSON.stringify(doc(editor.state.doc.firstChild.toJSON()));
    const pin = await instance.confirmPin({ title: "plan", category: "board", content: pinContent, nodePositions: [0] });
    expect(pin).toEqual({ id: "pin-1" });
    expect(createPin).toHaveBeenCalledWith(null, "p1", "board", pinContent, "plan");
    const board = editor.state.doc.firstChild;
    expect(board.attrs.pinId).toBe("pin-1");
    expect(board.attrs.blockTitle).toBe("plan");
    expect(updatePinContent).toHaveBeenCalledTimes(1);
    expect(JSON.parse(updatePinContent.mock.calls[0][1]).content[0].attrs.pinId).toBe("pin-1");
    expect(savePageContent).toHaveBeenCalled();
    expect(onPinCreated).toHaveBeenCalledTimes(1);
    expect(instance.hasPinnedContent(updatePinContent.mock.calls[0][1])).toBe(true);
  });

  it("stores only the blocks it could stamp, so the pin and the page agree", async () => {
    // A range over two paragraphs and a divider between them. A divider
    // carries no pinId, so the save right after would leave it out of the
    // pin; storing it at creation made the pin change shape a second
    // after it was made.
    const content = doc(para("the ferry leaves at six"), { type: "horizontalRule" }, para("ask about the night boat"));
    const { instance, editor } = await mountCore({ initialContent: content });
    const positions = [];
    editor.state.doc.forEach((_n, offset) => positions.push(offset));
    const pinContent = JSON.stringify(editor.getJSON());
    await instance.confirmPin({ title: "ferry", category: "board", content: pinContent, nodePositions: positions });
    const stored = JSON.parse(updatePinContent.mock.calls[0][1]).content;
    expect(stored.map((n) => n.type)).toEqual(["paragraph", "paragraph"]);
    expect(stored.every((n) => n.attrs.pinId === "pin-1")).toBe(true);
  });

  it("calls onStamped after the stamp but before the durable save", async () => {
    // Chrome's block flash rides on onStamped. Pre-split it ran at exactly
    // this point — pin row created, pinId in the doc, save not yet issued —
    // so the user sees the confirmation immediately. If onStamped moved
    // behind flushSave the flash would land one save IPC late, which the P0
    // "zero visible change on desktop" gate forbids.
    //
    // The observations are recorded, not asserted inline: onStamped runs
    // inside the core's try block, so a throwing expect() would be swallowed
    // by its catch and the test would pass on the bug.
    const seen = [];
    const content = doc({ type: "blockquote", content: [para("keep")] });
    const { instance, editor } = await mountCore({ initialContent: content });
    const pinContent = JSON.stringify(doc(editor.state.doc.firstChild.toJSON()));
    await instance.confirmPin({
      title: "plan",
      category: "board",
      content: pinContent,
      nodePositions: [0],
      onStamped: () => seen.push({
        pinId: editor.state.doc.firstChild.attrs.pinId,
        savesSoFar: savePageContent.mock.calls.length,
      }),
    });
    expect(seen).toEqual([{ pinId: "pin-1", savesSoFar: 0 }]);
    expect(savePageContent).toHaveBeenCalled();
  });

  it("confirmPin with no content is a no-op", async () => {
    // null, and nothing called: the popup can confirm with an empty
    // payload when a duplicate check cleared it — that must not create
    // an empty pin row.
    const { instance } = await mountCore();
    expect(await instance.confirmPin({ title: "x", category: "note", content: "", nodePositions: [] })).toBeNull();
    expect(createPin).not.toHaveBeenCalled();
  });

  it("moveBlock reorders through the shared command", async () => {
    const { instance, editor } = await mountCore({ initialContent: doc(para("a"), para("b")) });
    expect(instance.moveBlock(0, 1)).toBe(true);
    expect(editor.state.doc.content.content.map((n) => n.textContent)).toEqual(["b", "a"]);
  });

  it("hands chrome a null editor before destroying it", async () => {
    const { cleanup, onEditor, editor } = await mountCore();
    cleanup();
    expect(onEditor).toHaveBeenLastCalledWith(null);
    expect(editor.isDestroyed).toBe(true);
  });
});

// setLiftedBlock. The shell's drag needs one block to LOOK picked up, and
// the block is the editor's DOM, so the mark has to come from the editor.
//
// This suite exists because the obvious way to do it is wrong in a way no
// test could see. P2e marked the block with
// `view.nodeDOM(pos).classList.add("ps-lifted")` from PageScreen, nine
// phases of assertions agreed it worked, and on a device the block never
// lifted: ProseMirror's DOMObserver treats a foreign attribute change on a
// node it owns as a DOM change to reconcile, marks the node dirty and
// redraws it from the doc, and the class goes with the element it replaces.
// The unit tests missed it only because they asserted in the same
// synchronous turn the class was added — the observer delivers on a
// microtask, and no test awaited one.
describe("EditorCore — the lifted block", () => {
  // Let the DOMObserver's MutationObserver callback run. jsdom delivers
  // mutation records on a microtask, so awaiting is the whole of it; the
  // count is three for the same reason `settle` uses three.
  const flushObserver = async () => { for (let i = 0; i < 3; i++) await Promise.resolve(); };

  it("marks the block ProseMirror rendered, and clears it again", async () => {
    const { instance, editor } = await mountCore({ initialContent: doc(para("a"), para("b")) });
    // Position 0 starts the first top-level node — the same address the
    // shell's drag carries, and the same one moveBlock takes.
    expect(instance.setLiftedBlock(0)).toBe(true);
    expect(editor.view.nodeDOM(0).classList.contains("ps-lifted")).toBe(true);
    // The second block is not lifted: a decoration over the whole doc, or
    // one keyed to the wrong node, would light both.
    expect(editor.view.nodeDOM(3).classList.contains("ps-lifted")).toBe(false);

    expect(instance.setLiftedBlock(null)).toBe(true);
    expect(editor.view.nodeDOM(0).classList.contains("ps-lifted")).toBe(false);
  });

  it("keeps the mark when ProseMirror redraws the node", async () => {
    // THE TEST THIS SUITE EXISTS FOR, and the one that reddens on the
    // implementation it replaced: with `classList.add` on the node's DOM,
    // the class is gone by the first assertion below.
    //
    // The redraw is provoked the way the app provoked it by accident —
    // a foreign attribute written onto a node the editor owns — and it is
    // PROVEN to have happened rather than assumed: `data-foreign` is gone
    // afterwards, and the element the paragraph is rendered into is not the
    // one it was rendered into before. Without those two assertions this
    // test would pass just as happily against an observer that never fired,
    // which is the shape that let the original defect through.
    const { instance, editor } = await mountCore({ initialContent: doc(para("a"), para("b")) });
    expect(instance.setLiftedBlock(0)).toBe(true);
    const before = editor.view.nodeDOM(0);

    before.setAttribute("data-foreign", "1");
    await flushObserver();

    const after = editor.view.nodeDOM(0);
    expect(after).not.toBe(before);
    expect(after.hasAttribute("data-foreign")).toBe(false);
    expect(after.classList.contains("ps-lifted")).toBe(true);
  });

  it("refuses a position that starts no node", async () => {
    // Not "nothing happens": a host holding a stale position — the doc
    // changed under a live drag — must get an answer it can read, and the
    // decoration must not be built over a range the doc does not have,
    // which is where Decoration.node throws.
    const { instance, editor } = await mountCore({ initialContent: doc(para("a")) });
    expect(instance.setLiftedBlock(99)).toBe(false);
    expect(editor.view.dom.querySelector(".ps-lifted")).toBeNull();
  });

  it("keeps the lift out of the undo stack", async () => {
    // A writer who drags a block and presses undo means the MOVE. If the
    // lift were undoable, the first undo would spend itself putting a
    // highlight back on a block that no longer looks lifted, and the move
    // would take a second press.
    const { instance, editor } = await mountCore({ initialContent: doc(para("a"), para("b")) });
    instance.setLiftedBlock(0);
    instance.moveBlock(0, 1);
    instance.setLiftedBlock(null);
    expect(editor.state.doc.content.content.map((n) => n.textContent)).toEqual(["b", "a"]);
    editor.commands.undo();
    expect(editor.state.doc.content.content.map((n) => n.textContent)).toEqual(["a", "b"]);
  });
});

// hasBlockTitleSlot / focusBlockTitle. A board's title is an <input> the
// NodeView draws at no document position, so there is no command that
// reaches it and no decoration that could: the element is the only handle,
// and these two are the seam that hands one over rather than letting a
// host walk into ProseMirror's DOM. The blockquote in this file's stubbed
// extension set carries BlockTitle, so its NodeView renders a real slot.
describe("EditorCore — the title slot", () => {
  const quote = (t, attrs = {}) => ({ type: "blockquote", attrs, content: [para(t)] });

  it("says a board has a slot and a paragraph does not", async () => {
    // The `hasTitleSlot` gate, and the reason it is asked of the DOM: it is
    // whether the block CAN be titled, which is not the same question as
    // `snapshot.activeBlock.isTitled` — whether one has been typed. Both
    // were called `hasTitle` until 2026-08-31, and the shell offering the
    // row on the wrong half of the boards is what that cost.
    const { instance } = await mountCore({ initialContent: doc(para("a"), quote("b")) });
    expect(instance.hasBlockTitleSlot(0)).toBe(false);
    // pos 3: past the paragraph ("a" plus its two boundaries).
    expect(instance.hasBlockTitleSlot(3)).toBe(true);
  });

  it("answers false for a position the doc does not have, rather than throwing", async () => {
    // Same requirement as setLiftedBlock's stale-position case, and the
    // same trap: view.nodeDOM THROWS on a position past the end rather than
    // answering null, so a host holding a position from a document that has
    // since shrunk would take the exception out through the derived that
    // computes the sheet's rows.
    const { instance } = await mountCore({ initialContent: doc(para("a")) });
    expect(instance.hasBlockTitleSlot(99)).toBe(false);
    expect(instance.focusBlockTitle(99)).toBe(false);
    expect(instance.hasBlockTitleSlot(undefined)).toBe(false);
  });

  it("puts focus in the slot, one frame after it is asked", async () => {
    // The frame is bindTitleSlot's, not this seam's: __enterEdit() sets the
    // slot's `editing` flag synchronously — which is what stops the next
    // transaction's refresh from rewriting the value under the caret — and
    // queues the focus itself in a rAF. So the synchronous check is part of
    // the assertion, not a bug in it: it records that a caller asserting
    // activeElement straight after the call sees the old one.
    const { instance, editor } = await mountCore({ initialContent: doc(para("a"), quote("b")) });
    const slot = editor.view.dom.querySelector(".board-title-slot");
    expect(slot).toBeTruthy();

    expect(instance.focusBlockTitle(3)).toBe(true);
    expect(document.activeElement).not.toBe(slot);

    await new Promise((r) => requestAnimationFrame(() => r()));
    expect(document.activeElement).toBe(slot);
  });
});

describe("setBlockTitleAtPinId", () => {
  // The shell's pin sheet renames a BOARD through this (ShellApp.savePin →
  // renameOnNode): the title is the node's `blockTitle` slot, page content
  // the doc is authoritative for, so it is written here and the editor's
  // own save carries it to the row. A blockquote is a board type
  // (block-title.js registers the slot on it); a paragraph is not.
  const quote = (attrs, t) => ({ type: "blockquote", attrs, content: [para(t)] });

  it("writes the title onto the node carrying the pinId and nothing else", async () => {
    const { instance, editor } = await mountCore({
      initialContent: doc(para("a"), quote({ pinId: "pin-a", blockTitle: "old" }, "q")),
    });
    expect(editor.state.doc.child(1).attrs.blockTitle).toBe("old");
    expect(instance.setBlockTitleAtPinId("pin-a", "new")).toBe(true);
    expect(editor.state.doc.child(1).attrs.blockTitle).toBe("new");
    expect(editor.state.doc.child(1).attrs.pinId).toBe("pin-a");
    expect(editor.state.doc.child(1).textContent).toBe("q");
    expect(editor.state.doc.child(0).textContent).toBe("a");
  });

  it("clears the slot when handed null — the sheet's emptied field", async () => {
    const { instance, editor } = await mountCore({
      initialContent: doc(quote({ pinId: "pin-a", blockTitle: "old" }, "q")),
    });
    expect(instance.setBlockTitleAtPinId("pin-a", null)).toBe(true);
    // Null, not "", and the key present: extract_block_title (commands.rs)
    // reads a present-and-empty key as "clear the row".
    expect(editor.state.doc.firstChild.attrs.blockTitle).toBeNull();
  });

  it("refuses a node with no slot, so the caller goes to the row instead", async () => {
    // A pinned paragraph carries a pinId but its schema has no blockTitle
    // attr — setNodeMarkup would silently drop the attr, and the rename
    // would vanish. False is what sends ShellApp to the source page (or
    // the row) rather than letting that happen.
    const { instance, editor } = await mountCore({
      initialContent: doc({ ...para("kept"), attrs: { pinId: "pin-p" } }),
    });
    expect(editor.state.doc.firstChild.attrs.pinId).toBe("pin-p");
    expect(instance.setBlockTitleAtPinId("pin-p", "new")).toBe(false);
    expect(editor.state.doc.firstChild.attrs.blockTitle).toBeUndefined();
  });

  it("is false for a pinId that is not in this doc", async () => {
    const { instance } = await mountCore({
      initialContent: doc(quote({ pinId: "pin-a" }, "q")),
    });
    // The pin lives on another page; the caller's next step is that page.
    expect(instance.setBlockTitleAtPinId("pin-elsewhere", "new")).toBe(false);
  });
});
