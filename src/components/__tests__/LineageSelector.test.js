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

import LineageSelector from "../LineageSelector.svelte";

afterEach(cleanupAll);
beforeEach(() => vi.clearAllMocks());

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
});
