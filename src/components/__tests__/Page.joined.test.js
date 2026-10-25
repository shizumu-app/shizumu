// Task 9f, fix round 2: joining an account can delete the blank page the
// app made at launch (snapshot.rs `clear_placeholder_pages`), so the first
// pull starts from the account's newest snapshot. The page the writer has
// open is then gone and every save to it fails. The sync-pulled listener
// already re-adopts today's page when the open one vanished; a join must
// ask for the same at once, not wait for a pull that may be minutes away.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const stored = vi.hoisted(() => ({ page: null, today: null }));

vi.mock("../../lib/api.js", async (importOriginal) => {
  const real = await importOriginal();
  const out = {};
  for (const [k, v] of Object.entries(real)) {
    out[k] = typeof v === "function" ? vi.fn(() => Promise.resolve(null)) : v;
  }
  out.getOrCreateToday = vi.fn(() => Promise.resolve({ page: stored.today, lines: [], session_markers: [] }));
  out.getPage = vi.fn(() => Promise.resolve(stored.page ? { page: stored.page, lines: [], session_markers: [] } : null));
  out.getPins = vi.fn(() => Promise.resolve([]));
  out.getLineages = vi.fn(() => Promise.resolve([]));
  out.getFocusesForDate = vi.fn(() => Promise.resolve([]));
  out.getBacklinksForPage = vi.fn(() => Promise.resolve([]));
  out.getPageCountForDate = vi.fn(() => Promise.resolve(1));
  return out;
});
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import Page from "../Page.svelte";
import { announceJoined } from "../../lib/sync-joined.js";
import * as api from "../../lib/api.js";

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

const doc = (t) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

describe("a join re-adopts today's page at once", () => {
  it("leaves the deleted launch page for today's page when a join lands", async () => {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const launch = { id: "launch", date, page_number: 1, lineage_id: null, lineage_mode: null, is_open: true,
      what_matters_now: null, content_json: doc("the launch page") };
    stored.today = launch;
    stored.page = launch;
    const { target } = render(Page, {});
    await until(() => (target.querySelector(".ProseMirror")?.textContent || "").includes("the launch page"), "the launch page to open");

    // The join deleted the launch page; the account's today came with it.
    stored.page = null;
    stored.today = { ...launch, id: "theirs", content_json: doc("today from the account") };
    const calls = api.getOrCreateToday.mock.calls.length;
    announceJoined();
    await until(() => (target.querySelector(".ProseMirror")?.textContent || "").includes("today from the account"),
      "today's page after the join");
    expect(api.getOrCreateToday.mock.calls.length).toBeGreaterThan(calls);
  });
});
