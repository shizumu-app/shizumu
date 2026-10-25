// A page opened from memory, read-only, while the other device writes in it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

vi.mock("../../lib/api.js", () => ({
  getPage: vi.fn(),
  createLineage: vi.fn(),
  setFocusLineage: vi.fn(),
}));
const events = vi.hoisted(() => ({ handlers: {} }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name, handler) => { events.handlers[name] = handler; return Promise.resolve(() => { delete events.handlers[name]; }); }),
}));

import ThreadPageView from "../ThreadPageView.svelte";
import * as api from "../../lib/api.js";

afterEach(cleanupAll);

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}
const doc = (text) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const row = (text) => ({ page: { id: "p1", date: "2026-10-01", page_number: 1, lineage_id: null, content_json: doc(text) }, lines: [] });

describe("ThreadPageView", () => {
  it("shows the other device's edit on the page it holds open", async () => {
    // Sync journey 21: the phone ticks a task and edits a table on a page
    // the laptop has open from memory. The view mounted its editor from
    // the first read and never read the page again.
    api.getPage.mockResolvedValue(row("the copy it opened with"));
    const { target } = render(ThreadPageView, { date: "2026-10-01", pageNumber: 1, pageId: "p1", onClose: vi.fn() });
    await settle();
    await settle();
    expect(target.textContent).toContain("the copy it opened with");

    api.getPage.mockResolvedValue(row("the phone ticked the flights"));
    expect(events.handlers["sync-pulled"]).toBeTypeOf("function");
    events.handlers["sync-pulled"]();
    await settle();
    await settle();

    expect(target.textContent).toContain("the phone ticked the flights");
    expect(target.textContent).not.toContain("the copy it opened with");
  });
});
