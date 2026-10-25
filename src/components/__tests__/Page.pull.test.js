// Sync journey J2.8: a page opened from memory ("open in editor") did not
// follow sync pulls. The phone added two lines to it; the laptop's stored
// copy held them after five pulls, and its open editor held neither.
//
// Opening from memory remounts Page with `continueFocus`, and onMount
// returned early on that path to keep loadToday from racing the focus load
// — before it reached the `sync-pulled` listener. Every other path reaches
// it, so only pages opened from memory went stale.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const stored = vi.hoisted(() => ({ page: null }));

vi.mock("../../lib/api.js", async (importOriginal) => {
  const real = await importOriginal();
  const out = {};
  for (const [k, v] of Object.entries(real)) {
    out[k] = typeof v === "function" ? vi.fn(() => Promise.resolve(null)) : v;
  }
  out.getPage = vi.fn(() => Promise.resolve(stored.page ? { page: stored.page, lines: [], session_markers: [] } : null));
  out.getPins = vi.fn(() => Promise.resolve([]));
  out.getLineages = vi.fn(() => Promise.resolve([]));
  out.getFocusesForDate = vi.fn(() => Promise.resolve([]));
  out.getBacklinksForPage = vi.fn(() => Promise.resolve([]));
  out.getPageCountForDate = vi.fn(() => Promise.resolve(1));
  return out;
});

// jsdom has no Tauri to deliver the worker's events: every listener is
// captured and called by hand, as the worker would. Several components on
// the page (the trail picker, the sync pill) listen for pulls too, so all
// of them are kept and all are called; the assertion is on the editor.
const events = vi.hoisted(() => ({ listeners: [] }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name, handler) => {
    const entry = { name, handler };
    events.listeners.push(entry);
    return Promise.resolve(() => { events.listeners = events.listeners.filter((e) => e !== entry); });
  }),
}));
async function pull() {
  for (const e of events.listeners.filter((x) => x.name === "sync-pulled")) await e.handler();
}

import Page from "../Page.svelte";

vi.setConfig({ testTimeout: 30000 });
afterEach(() => { cleanupAll(); events.listeners = []; });

async function until(predicate, what) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
    await tick();
  }
  throw new Error(`timed out waiting for: ${what}`);
}

const doc = (...texts) => JSON.stringify({ type: "doc", content: texts.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })) });

describe("a page opened from memory follows sync pulls", () => {
  it("shows what a pull brought to it", async () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    stored.page = { id: "q", date, page_number: 3, lineage_id: null, lineage_mode: null, is_open: true,
      what_matters_now: "the phone's page", content_json: doc("written on the phone") };
    const { target } = render(Page, { continueFocus: { page_id: "q", date, page_number: 3 } });
    await until(() => (target.querySelector(".ProseMirror")?.textContent || "").includes("written on the phone"), "the page to open");

    // Loading a doc changes it a little (the editor adds attributes), so the
    // editor schedules a save on its one-second debounce, and a pull inside
    // that second is refused on purpose (pull-reload.js). In the journey the
    // pull came twenty seconds later; wait the second out.
    await new Promise((r) => setTimeout(r, 1300));

    // The phone adds a line; a pull lands.
    stored.page = { ...stored.page, content_json: doc("written on the phone", "added on the phone") };
    await pull();
    await until(() => (target.querySelector(".ProseMirror")?.textContent || "").includes("added on the phone"), "the pulled line in the editor");
  });
});
