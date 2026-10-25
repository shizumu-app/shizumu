// Memory is large (1000+ lines: thread + pins + ground + trail-map view).
// This is a focused mount + key-path test: it renders its shell and search
// against mocked api, and routes back to the page. Catches mount-breaking
// regressions and the back-navigation contract without coupling to the
// many sub-views.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

vi.mock("../../lib/api.js", () => ({
  getThread: vi.fn(() => Promise.resolve([])),
  searchPages: vi.fn(() => Promise.resolve([])),
  getGroundData: vi.fn(() => Promise.resolve(null)),
  getLineages: vi.fn(() => Promise.resolve([])),
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve(null)),
  getPins: vi.fn(() => Promise.resolve([])),
  updatePinContent: vi.fn(() => Promise.resolve(null)),
  deletePin: vi.fn(() => Promise.resolve(null)),
  loadPageContentForModal: vi.fn(() => Promise.resolve(null)),
  savePageContentWithPinRefresh: vi.fn(() => Promise.resolve(null)),
}));

// jsdom has no Tauri to deliver the worker's events, so the listener's
// handler is captured and called by hand, as the worker would.
const events = vi.hoisted(() => ({ handlers: {} }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name, handler) => { events.handlers[name] = handler; return Promise.resolve(() => { delete events.handlers[name]; }); }),
}));

import Memory from "../Memory.svelte";
import * as api from "../../lib/api.js";

afterEach(cleanupAll);

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

const byText = (target, sel, text) =>
  [...target.querySelectorAll(sel)].find((el) => el.textContent.trim() === text);

describe("Memory", () => {
  it("mounts its shell with a search field", async () => {
    const { target } = render(Memory, { onNavigatePage: vi.fn() });
    await settle();
    expect(target.querySelector(".memory")).toBeTruthy();
    const search = [...target.querySelectorAll("input")].find((i) =>
      (i.placeholder || "").includes("search your writing")
    );
    expect(search).toBeTruthy();
  });

  it("routes back to the page", async () => {
    const onNavigatePage = vi.fn();
    const { target } = render(Memory, { onNavigatePage });
    await settle();
    byText(target, "button", "↓ back to the page").click();
    expect(onNavigatePage).toHaveBeenCalledTimes(1);
  });

  it("shows a page the other device wrote while memory is open", async () => {
    // Sync journey 19: the phone wrote a page while the laptop had memory
    // open. Memory read its list once, when it opened, so the page waited
    // for the writer to leave and come back.
    const { target } = render(Memory, { onNavigatePage: vi.fn() });
    await settle();
    expect(target.textContent).not.toContain("written on the phone");

    api.getThread.mockResolvedValue([{ id: "p2", date: "2026-10-14", page_number: 2,
      what_matters_now: "written on the phone", preview_lines: [], content_json: null, lineage_id: null }]);
    expect(events.handlers["sync-pulled"]).toBeTypeOf("function");
    events.handlers["sync-pulled"]();
    await settle();
    await settle();

    expect(target.textContent).toContain("written on the phone");
    expect(target.textContent).not.toContain("loading…");
  });
});
