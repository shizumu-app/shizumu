// The shell tree's TipTapEditor is a wrapper over EditorCore, and a merge of
// main resolves TipTapEditor.svelte to that side (`git checkout --ours`).
// That is how main's flushPendingSave was dropped once: main's Page calls it
// as `flowModeRef?.flushPendingSave?.()`, so its absence was silent, and a
// pin edit could have its stored-page write overwritten by the editor's
// pending save. This goes red if the wrapper stops forwarding it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

vi.mock("../../lib/api.js", async (importOriginal) => {
  const real = await importOriginal();
  const out = {};
  for (const [k, v] of Object.entries(real)) {
    out[k] = typeof v === "function" ? vi.fn(() => Promise.resolve(null)) : v;
  }
  out.getPins = vi.fn(() => Promise.resolve([]));
  out.getLineages = vi.fn(() => Promise.resolve([]));
  return out;
});
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { savePageContent } from "../../lib/api.js";
import TipTapEditor from "../TipTapEditor.svelte";

afterEach(() => { cleanupAll(); });

async function until(predicate, what) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
    await tick();
  }
  throw new Error(`timed out waiting for: ${what}`);
}

describe("TipTapEditor (shell wrapper)", () => {
  it("forwards flushPendingSave to the core, which lands the pending save now", async () => {
    const initial = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] });
    const { instance } = render(TipTapEditor, { pageId: "p1", initialContent: initial });
    await until(() => instance.getEditor(), "the editor");
    // Let the save scheduled by the load land, so only the edit is pending.
    await new Promise((r) => setTimeout(r, 1200));
    savePageContent.mockClear();

    expect(typeof instance.flushPendingSave).toBe("function");
    instance.getEditor().commands.insertContentAt(2, "b");
    await instance.flushPendingSave();

    // Well inside the one-second debounce: only the flush could have saved.
    expect(savePageContent).toHaveBeenCalledTimes(1);
    expect(savePageContent.mock.calls[0][1]).toContain("ab");
  });
});
