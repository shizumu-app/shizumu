// Block ids meet the save path. The anti-goal of the block-id design: a page
// opened is never saved just because it was opened (d0604141 — an editor
// that saved a page it had only loaded emptied the other device's writing).
// A page stored before 0.8.2 has no ids, the editor gives it derived ones,
// and none of that may reach savePageContent: not on the debounce, not on
// leaving the page, not on a sync pull of the same copy, not on an undo
// pressed straight after opening. The first real edit saves, with the ids.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick, flushSync } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import { reactiveProps } from "./reactive-props.svelte.js";

vi.mock("../../../lib/api.js", () => ({
  savePageContent: vi.fn(() => Promise.resolve()),
  saveTrailContent: vi.fn(() => Promise.resolve()),
  createPin: vi.fn(() => Promise.resolve({ id: "pin-1" })),
  getPins: vi.fn(() => Promise.resolve([])),
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
  const { BlockId } = await import("../../../lib/extensions/block-id.js");
  return {
    READONLY_EXTENSIONS: [],
    buildEditingExtensions: ({ getPageId } = {}) => [
      Document, Paragraph, Text, Blockquote, UndoRedo, BlockTitle, PinId, BlockId.configure({ getPageId }),
    ],
  };
});

import { savePageContent } from "../../../lib/api.js";
import { derivedBlockId } from "../../../lib/block-id.js";
import EditorCore from "../EditorCore.svelte";

afterEach(() => { cleanupAll(); vi.useRealTimers(); });
beforeEach(() => vi.clearAllMocks());

const para = (t, attrs) => ({ type: "paragraph", ...(attrs ? { attrs } : {}), content: [{ type: "text", text: t }] });
const doc = (...nodes) => ({ type: "doc", content: nodes });

// As 0.8.1 stored it: no blockId anywhere.
const STORED = doc(para("the plan"), { type: "blockquote", content: [para("pack the books last")] }, para("then the rest"));
const DERIVED_P1 = [derivedBlockId("p1", [0]), derivedBlockId("p1", [1]), derivedBlockId("p1", [1, 0]), derivedBlockId("p1", [2])];

async function settle() {
  for (let i = 0; i < 3; i++) { await Promise.resolve(); await tick(); }
}

async function mountCore(extra = {}) {
  const onEditor = vi.fn();
  const props = reactiveProps({ pageId: "p1", initialContent: STORED, onEditor, ...extra });
  const r = render(EditorCore, props);
  await settle();
  return { ...r, props, editor: () => onEditor.mock.calls.at(-1)?.[0] };
}

function ids(editor) {
  const out = [];
  editor.state.doc.descendants((node) => { if ("blockId" in node.attrs) out.push(node.attrs.blockId); });
  return out;
}

describe("EditorCore — block ids on a page stored before 0.8.2", () => {
  it("gives the blocks their derived ids and saves nothing for it", async () => {
    vi.useFakeTimers();
    const { editor } = await mountCore();
    await vi.advanceTimersByTimeAsync(5000);
    // Nothing was typed: the ids are a load's, and a load does not write.
    expect(savePageContent).not.toHaveBeenCalled();
    expect(ids(editor())).toEqual(DERIVED_P1);
  });

  it("saves nothing when the page is left for another", async () => {
    vi.useFakeTimers();
    const { props } = await mountCore();
    await vi.advanceTimersByTimeAsync(2000);
    props.initialContent = doc(para("another day"));
    props.pageId = "p2";
    flushSync();
    await vi.advanceTimersByTimeAsync(5000);
    // The page-switch flush runs for p1 unconditionally; isEchoOfPull is
    // what stops it, and it can only if the ids are in the baseline.
    expect(savePageContent).not.toHaveBeenCalled();
  });

  it("gives the same ids on a second load of the same page", async () => {
    const a = await mountCore();
    const first = ids(a.editor());
    cleanupAll();
    const b = await mountCore();
    expect(ids(b.editor())).toEqual(first);
    expect(first).toEqual(DERIVED_P1);
  });

  it("saves nothing when a sync pull hands back the stored copy", async () => {
    vi.useFakeTimers();
    const { instance, editor } = await mountCore();
    await vi.advanceTimersByTimeAsync(2000);
    // The stored copy has no ids, so it differs from the editor's and is
    // applied; applied, it gets the same derived ids again.
    instance.reloadFromContent(JSON.stringify(STORED));
    await vi.advanceTimersByTimeAsync(5000);
    expect(savePageContent).not.toHaveBeenCalled();
    expect(ids(editor())).toEqual(DERIVED_P1);
  });

  it("leaves an open old page alone when a sync pull hands back the same stored copy", async () => {
    // The stored copy has no ids and the editor's has derived ones; compared
    // raw they differed, so every pull re-applied an untouched pre-0.8.2
    // page: content reset, caret moved, until the page was edited once.
    // Compared like with like (the stored copy given the ids a load would
    // give it), it is the same page, and "same" means nothing is reloaded.
    vi.useFakeTimers();
    const { instance, editor } = await mountCore();
    await vi.advanceTimersByTimeAsync(2000);
    editor().commands.setTextSelection(5);
    const before = editor().state.doc;
    expect(instance.reloadFromContent(JSON.stringify(STORED))).toBe("same");
    expect(editor().state.doc).toBe(before);
    expect(editor().state.selection.from).toBe(5);
  });

  it("still applies a pull that changed the old page's words", async () => {
    vi.useFakeTimers();
    const { instance, editor } = await mountCore();
    await vi.advanceTimersByTimeAsync(2000);
    const changed = doc(para("the plan, revised"), { type: "blockquote", content: [para("pack the books last")] }, para("then the rest"));
    expect(instance.reloadFromContent(JSON.stringify(changed))).toBe("apply");
    expect(editor().state.doc.firstChild.textContent).toBe("the plan, revised");
    expect(ids(editor())).toEqual(DERIVED_P1);
  });

  it("an undo pressed straight after opening changes nothing and saves nothing", async () => {
    vi.useFakeTimers();
    const { editor } = await mountCore();
    await vi.advanceTimersByTimeAsync(2000);
    const opened = JSON.stringify(editor().getJSON());
    editor().commands.undo();
    await vi.advanceTimersByTimeAsync(5000);
    expect(savePageContent).not.toHaveBeenCalled();
    expect(JSON.stringify(editor().getJSON())).toBe(opened);
  });

  it("the first real edit saves, and the save keeps the derived ids", async () => {
    vi.useFakeTimers();
    const { editor } = await mountCore();
    await vi.advanceTimersByTimeAsync(2000);
    editor().commands.insertContentAt(1, "now ");
    await vi.advanceTimersByTimeAsync(2000);
    expect(savePageContent).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(savePageContent.mock.calls[0][1]);
    expect(saved.content[0].attrs.blockId).toBe(DERIVED_P1[0]);
    expect(saved.content[1].content[0].attrs.blockId).toBe(DERIVED_P1[2]);
  });
});

describe("EditorCore — appendNodesToDoc and block ids", () => {
  it("still skips a carried copy of a block already on the page, though the page's copy has an id", async () => {
    // The shape check that stops "the pin appears twice" compared JSON; the
    // page's block now carries a blockId and the carried copy does not.
    // The copy arrives as pinToNodes leaves a cached node: pinId and
    // blockId stripped, an attrs object still there.
    const { instance } = await mountCore();
    const landed = instance.appendNodesToDoc([para("then the rest", {})]);
    expect(landed).toBe(0);
  });

  it("gives a carried-forward block a new id of its own", async () => {
    const { instance, editor } = await mountCore();
    expect(instance.appendNodesToDoc([para("from the pin", { blockId: "src000000001" })])).toBe(1);
    const list = ids(editor());
    expect(list.at(-1)).toMatch(/^[0-9a-z]{12}$/);
    expect(new Set(list).size).toBe(list.length);
  });
});
