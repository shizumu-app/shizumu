// LineageSelector (1000+ lines: trail picker + rename/move/fold gestures).
// Focused coverage of the picker contract: the trigger opens a dropdown,
// selecting a trail and detaching both fire onLineageChange, and read-only
// shows a static badge with no trigger.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

vi.mock("../../lib/api.js", () => ({
  getLineages: vi.fn(() => Promise.resolve([{ id: "L1", name: "book", parent_id: null, mode: "discrete" }])),
  createLineage: vi.fn(() => Promise.resolve(null)),
  deleteLineage: vi.fn(() => Promise.resolve(null)),
  renameLineage: vi.fn(() => Promise.resolve(null)),
  setLineageParent: vi.fn(() => Promise.resolve(null)),
  foldLineage: vi.fn(() => Promise.resolve(null)),
}));

// Controls isCoarsePointer() for the tap-to-type focus-gating tests below —
// everything else in responsive.js stays real (importOriginal), so
// isPhoneViewport/watchPhoneViewport behave exactly as they do in jsdom
// (no matchMedia stub -> desktop dropdown, not the phone BottomSheet),
// keeping this test independent from that unrelated branch.
const responsiveState = vi.hoisted(() => ({ coarse: false }));
vi.mock("../../lib/responsive.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isCoarsePointer: () => responsiveState.coarse };
});

// jsdom has no Tauri to deliver the worker's events; the handler is
// captured and called by hand, as the worker would.
const events = vi.hoisted(() => ({ handlers: {} }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name, handler) => { events.handlers[name] = handler; return Promise.resolve(() => { delete events.handlers[name]; }); }),
}));

import LineageSelector from "../LineageSelector.svelte";
import * as api from "../../lib/api.js";

afterEach(cleanupAll);
// clearAllMocks keeps a mockResolvedValue a test set, so a later test would
// start on that test's trails; every test starts on the default list.
beforeEach(() => {
  vi.clearAllMocks();
  api.getLineages.mockResolvedValue([{ id: "L1", name: "book", parent_id: null, mode: "discrete" }]);
});

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

const base = { pageId: "p1", lineageId: null };

describe("LineageSelector", () => {
  it("shows the optional-trail trigger when untrailed", async () => {
    const { target } = render(LineageSelector, { ...base, onLineageChange: vi.fn() });
    await settle();
    const trigger = target.querySelector(".trigger-chip");
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain("trail (optional)");
  });

  it("opens a dropdown listing the trails on click", async () => {
    const { target } = render(LineageSelector, { ...base, onLineageChange: vi.fn() });
    await settle();
    target.querySelector(".trigger-chip").click();
    await settle();
    expect(target.querySelector(".lineage-dropdown")).toBeTruthy();
    expect(target.querySelector(".lineage-search")).toBeTruthy();
    // The trail rows are listed; the "no trail" detach option is gated on
    // already being trailed, so it's absent here (covered below).
    const opts = [...target.querySelectorAll(".lineage-option")];
    expect(opts.some((o) => o.textContent.includes("book"))).toBe(true);
  });

  it("offers detach only when trailed, and reports it", async () => {
    const onLineageChange = vi.fn();
    // Start trailed so currentLineage is set → the "no trail" detach
    // affordance renders.
    const { target } = render(LineageSelector, {
      pageId: "p1",
      lineageId: "L1",
      onLineageChange,
    });
    await settle();
    target.querySelector(".trigger-chip").click();
    await settle();
    const noTrail = target.querySelector(".lineage-option.no-trail");
    expect(noTrail).toBeTruthy();
    noTrail.click();
    await settle();
    expect(onLineageChange).toHaveBeenCalledWith(null);
  });

  // Deleting a trail re-parents its children in the backend (to the deleted
  // trail's parent, or to none). The picker used to drop only the deleted
  // row from its own copy, so a child kept a parent that no longer existed,
  // fell out of the tree, and searching for it offered to create it again
  // (scripts/desktop/scenarios/trail-manage.mjs, 2026-10-24).
  it("keeps a deleted trail's child in the list, where the backend put it", async () => {
    const parent = { id: "P", name: "the novel", parent_id: null, mode: "discrete" };
    const child = { id: "C", name: "chapter three", parent_id: "P", mode: "discrete" };
    api.getLineages.mockResolvedValue([parent, child]);
    const { target } = render(LineageSelector, { ...base, onLineageChange: vi.fn() });
    await settle();
    target.querySelector(".trigger-chip").click();
    await settle();

    api.getLineages.mockResolvedValue([{ ...child, parent_id: null }]);
    target.querySelector(".trail-actions").click();
    await settle();
    target.querySelector(".row-action.danger").click();
    await settle();
    target.querySelector(".delete-confirm").click();
    await settle();

    expect(api.deleteLineage).toHaveBeenCalledWith("P", null);
    const names = [...target.querySelectorAll(".lineage-option-name")].map((n) => n.textContent.trim());
    expect(names).toEqual(["chapter three"]);
  });

  // A page whose trail is not in the list (another device deleted it, and
  // the page has not been re-saved yet) made the chip refetch, store the
  // list, re-run its own check, miss again and refetch, without end: a hot
  // loop against the backend, and a hang in this suite. One refetch per id.
  it("asks for the list once, not forever, when the page's trail no longer exists", async () => {
    render(LineageSelector, { pageId: "p1", lineageId: "GONE", onLineageChange: vi.fn() });
    for (let i = 0; i < 5; i++) await settle();
    expect(api.getLineages.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("selects a trail and reports the choice", async () => {
    const onLineageChange = vi.fn();
    const { target } = render(LineageSelector, { ...base, onLineageChange });
    await settle();
    target.querySelector(".trigger-chip").click();
    await settle();
    const bookOption = [...target.querySelectorAll(".lineage-option")].find(
      (el) => !el.classList.contains("no-trail") && el.textContent.includes("book")
    );
    expect(bookOption).toBeTruthy();
    bookOption.click();
    await settle();
    expect(onLineageChange).toHaveBeenCalledWith("L1");
  });

  it("renders a static badge and no trigger when read-only", async () => {
    const { target } = render(LineageSelector, {
      pageId: "p1",
      lineageId: "L1",
      readonly: true,
      onLineageChange: vi.fn(),
    });
    await settle();
    expect(target.querySelector(".lineage-badge")?.textContent).toContain("book");
    expect(target.querySelector(".trigger-chip")).toBeNull();
  });

  // Programmatic focus on a mobile webview cannot be relied on to raise the
  // IME (see focus-field.js) — a direct user tap always does. On a coarse
  // (touch) pointer the sheet must open with the search field NOT
  // auto-focused, so the user taps it and types; a fine pointer (desktop)
  // keeps the old autofocus-on-open behavior.
  describe("tap-to-type focus gating (touch)", () => {
    afterEach(() => { responsiveState.coarse = false; });

    // Spy on the SPECIFIC input this render produced, not
    // HTMLElement.prototype globally: focusField's real .focus() call is
    // deferred one rAF tick behind its scheduling effect, so a prototype-
    // wide spy can catch a still-pending call from an EARLIER test's own
    // (already unmounted) input leaking into this test's rAF-flush wait —
    // a false failure with nothing wrong in the gating itself. Scoping to
    // this render's own element makes that cross-test leakage impossible.
    it("does not programmatically focus the search field on a coarse pointer", async () => {
      responsiveState.coarse = true;
      const { target } = render(LineageSelector, { ...base, onLineageChange: vi.fn() });
      await settle();
      target.querySelector(".trigger-chip").click();
      await settle();
      const input = target.querySelector(".lineage-search");
      const focusSpy = vi.spyOn(input, "focus");
      // Give any (wrongly) scheduled rAF focus a chance to fire.
      await new Promise((r) => requestAnimationFrame(() => r()));
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("still programmatically focuses the search field on a fine pointer (desktop)", async () => {
      responsiveState.coarse = false;
      const { target } = render(LineageSelector, { ...base, onLineageChange: vi.fn() });
      await settle();
      target.querySelector(".trigger-chip").click();
      await settle();
      const input = target.querySelector(".lineage-search");
      const focusSpy = vi.spyOn(input, "focus");
      await new Promise((r) => requestAnimationFrame(() => r()));
      expect(focusSpy).toHaveBeenCalled();
      focusSpy.mockRestore();
    });
  });

  it("shows the trail's new name after a pull, when the other device renamed it", async () => {
    // Sync journey 18: the phone renamed the trail of the page open on the
    // laptop. The chip had read the trails once, on mount, and kept the
    // old name until the page was reopened.
    const { target } = render(LineageSelector, { pageId: "p1", lineageId: "L1", onLineageChange: vi.fn() });
    await settle();
    expect(target.querySelector(".trigger-chip").textContent).toContain("book");

    api.getLineages.mockResolvedValue([{ id: "L1", name: "the novel", parent_id: null, mode: "discrete" }]);
    expect(events.handlers["sync-pulled"]).toBeTypeOf("function");
    events.handlers["sync-pulled"]();
    await settle();
    await settle();

    expect(target.querySelector(".trigger-chip").textContent).toContain("the novel");
  });
});
