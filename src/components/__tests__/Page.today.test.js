// Two clocks decided one fact on the desktop tree too. `get_or_create_today`
// dates the page with the backend's clock (chrono::Local); `isWritable`
// judged it against `todayStr`, the WebView's. Measured on an SM-A065F in
// Africa/Casablanca with stale tz data, the WebView said the 8th while Rust
// said the 9th, so for an hour every night the page the backend had just
// made as today's was a past page here and the editor refused every
// keystroke. The page get_or_create_today hands out is today's by identity
// (src/lib/today-page.js); no frontend clock is asked to agree.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const backend = vi.hoisted(() => ({ page: null }));

vi.mock("../../lib/api.js", async (importOriginal) => {
  const real = await importOriginal();
  const out = {};
  for (const [k, v] of Object.entries(real)) {
    out[k] = typeof v === "function" ? vi.fn(() => Promise.resolve(null)) : v;
  }
  out.getOrCreateToday = vi.fn(() => Promise.resolve({ page: backend.page, lines: [], session_markers: [] }));
  out.getPins = vi.fn(() => Promise.resolve([]));
  out.getLineages = vi.fn(() => Promise.resolve([]));
  out.getFocusesForDate = vi.fn(() => Promise.resolve([]));
  out.getBacklinksForPage = vi.fn(() => Promise.resolve([]));
  out.getPageCountForDate = vi.fn(() => Promise.resolve(1));
  return out;
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import Page from "../Page.svelte";

vi.setConfig({ testTimeout: 30000 });
afterEach(() => { cleanupAll(); });

async function until(predicate, what) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
    await tick();
  }
  throw new Error(`timed out waiting for: ${what}`);
}

function dayStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("the page the backend made as today's", () => {
  it("takes writing when the WebView's clock says it is still yesterday", async () => {
    // The backend's day is ahead of the WebView's: its page is dated
    // tomorrow by this process's clock.
    backend.page = { id: "today-row", date: dayStr(1), page_number: 1, lineage_id: null,
      lineage_mode: null, is_open: true, what_matters_now: null, content_json: null };
    const { target } = render(Page);
    await until(() => target.querySelector(".ProseMirror"), "the editor to mount");
    await new Promise((r) => setTimeout(r, 100));
    await tick();
    expect(target.querySelector(".ProseMirror").getAttribute("contenteditable")).toBe("true");
  });

  it("still keeps a page the backend did not hand out as today read-only", async () => {
    // The control: the same mount, but get_or_create_today hands out a row
    // dated yesterday by both clocks, as a phone left open over midnight
    // whose backend has not been asked again would hold. Identity holds
    // only until the clock moves past the page's own date.
    backend.page = { id: "old-row", date: dayStr(-1), page_number: 1, lineage_id: null,
      lineage_mode: null, is_open: true, what_matters_now: null, content_json: null };
    const { target } = render(Page);
    await until(() => target.querySelector(".ProseMirror"), "the editor to mount");
    await new Promise((r) => setTimeout(r, 100));
    await tick();
    expect(target.querySelector(".ProseMirror").getAttribute("contenteditable")).toBe("false");
  });
});
