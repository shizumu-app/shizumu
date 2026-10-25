// FocusRail (INV-NAV-2): renders a dot per focus in the current scope,
// marks the current one, selects on click, exposes "+" only on today's
// rail, and gates delete behind a two-tap confirm. Pure props, no api.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import FocusRail from "../FocusRail.svelte";

afterEach(cleanupAll);

const focus = (id, extra = {}) => ({
  id,
  what_matters_now: id,
  is_open: true,
  lineage_id: null,
  date: "2026-05-29",
  ...extra,
});

const addButton = (target) =>
  [...target.querySelectorAll("button")].find((b) => b.textContent.trim() === "+");

describe("FocusRail", () => {
  it("renders one dot per focus and marks the current one", () => {
    const { target } = render(FocusRail, {
      focuses: [focus("f1"), focus("f2")],
      currentId: "f2",
      onSelect: vi.fn(),
      onNew: vi.fn(),
    });
    const dots = target.querySelectorAll(".rail-dot-hit");
    expect(dots.length).toBe(2);
    const current = target.querySelectorAll(".rail-dot")[1];
    expect(current.classList.contains("current")).toBe(true);
  });

  it("selects a focus on click", () => {
    const onSelect = vi.fn();
    const { target } = render(FocusRail, {
      focuses: [focus("f1"), focus("f2")],
      currentId: "f1",
      onSelect,
      onNew: vi.fn(),
    });
    target.querySelectorAll(".rail-dot-hit")[1].click();
    expect(onSelect).toHaveBeenCalledWith("f2");
  });

  it("shows + on today's rail and calls onNew", () => {
    const onNew = vi.fn();
    const { target } = render(FocusRail, {
      focuses: [focus("f1")],
      currentId: "f1",
      onSelect: vi.fn(),
      onNew,
      isToday: true,
    });
    const add = addButton(target);
    expect(add).toBeTruthy();
    add.click();
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("hides + when the rail is not today's", () => {
    const { target } = render(FocusRail, {
      focuses: [focus("f1")],
      currentId: "f1",
      onSelect: vi.fn(),
      onNew: vi.fn(),
      isToday: false,
    });
    expect(addButton(target)).toBeUndefined();
  });

  it("requires two taps to delete a focus", async () => {
    const onDelete = vi.fn();
    const { target } = render(FocusRail, {
      focuses: [focus("f1"), focus("f2")],
      currentId: "f1",
      onSelect: vi.fn(),
      onNew: vi.fn(),
      onDelete,
      trailMode: "discrete",
    });
    // Hover the first dot to expose its delete affordance.
    const wrap = target.querySelector(".rail-dot-wrap");
    wrap.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await tick();
    const del = target.querySelector(".rail-delete");
    expect(del).toBeTruthy();

    del.click(); // first tap → arm confirm, no delete yet
    await tick();
    expect(onDelete).not.toHaveBeenCalled();

    target.querySelector(".rail-delete").click(); // second tap → delete
    expect(onDelete).toHaveBeenCalledWith("f1");
  });
});

describe("FocusRail — a busy day", () => {
  // MEASURED ON A DESKTOP: twenty-odd pages drew twenty-odd dots that ran into
  // the header's chips. Past eight the dots give way to a count, as on the
  // phone (lib/rail-dots.js) — and the count keeps the dots' other job,
  // taking you to another page, as a step either side.
  const many = Array.from({ length: 12 }, (_, i) => focus(`f${i + 1}`));

  it("draws a count instead of twelve dots, and keeps the +", () => {
    const { target } = render(FocusRail, { focuses: many, currentId: "f5", onSelect: vi.fn(), onNew: vi.fn() });
    expect(target.querySelectorAll(".rail-dot").length).toBe(0);
    expect(target.querySelector(".rail-count").textContent.trim()).toBe("5 / 12");
    expect(addButton(target)).toBeTruthy();
  });

  it("steps to the page either side, and offers no step past the end", () => {
    const onSelect = vi.fn();
    const { target } = render(FocusRail, { focuses: many, currentId: "f12", onSelect, onNew: vi.fn() });
    const [prev, next] = target.querySelectorAll(".rail-step");
    prev.click();
    expect(onSelect).toHaveBeenCalledWith("f11");
    expect(next.disabled).toBe(true);
  });

  // The ×  on a dot was the desktop's only page delete, so on a day past
  // eight pages no page could be deleted at all (sync journey J6.2,
  // 2026-10-24). The count keeps that job too, for the page on screen.
  it("still deletes the page on screen, behind the same two-tap confirm", async () => {
    const onDelete = vi.fn();
    const { target } = render(FocusRail, { focuses: many, currentId: "f5", onSelect: vi.fn(), onNew: vi.fn(), onDelete });
    const del = target.querySelector(".rail-count-delete");
    expect(del).toBeTruthy();
    del.click();
    await tick();
    expect(onDelete).not.toHaveBeenCalled();
    del.click();
    expect(onDelete).toHaveBeenCalledWith("f5");
  });

  it("keeps the dots at eight", () => {
    const { target } = render(FocusRail, { focuses: many.slice(0, 8), currentId: "f1", onSelect: vi.fn(), onNew: vi.fn() });
    expect(target.querySelectorAll(".rail-dot").length).toBe(8);
    expect(target.querySelector(".rail-count")).toBeNull();
  });
});
