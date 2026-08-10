import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "./test-helper.js";
import PagesChip from "./PagesChip.svelte";

afterEach(cleanupAll);

const focuses = [
  { id: "a", page_number: 1, date: "2026-07-27", what_matters_now: "first" },
  { id: "b", page_number: 2, date: "2026-07-27", what_matters_now: null },
];

describe("PagesChip", () => {
  it("labels the trigger with current/total", () => {
    const { target } = render(PagesChip, { focuses, currentPageNumber: 2, onSelect: vi.fn() });
    const chip = target.querySelector(".trigger-chip");
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("page 2/2");
  });

  it("sheet is closed until the chip is tapped", () => {
    const { target } = render(PagesChip, { focuses, currentPageNumber: 1, onSelect: vi.fn() });
    expect(target.querySelector(".sheet")).toBeNull();
  });

  it("tapping the chip opens a sheet listing one row per page", async () => {
    const { target } = render(PagesChip, { focuses, currentPageNumber: 1, onSelect: vi.fn() });
    target.querySelector(".trigger-chip").click();
    await tick();

    const rows = target.querySelectorAll(".pages-sheet-row");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("first");
    expect(rows[1].textContent).toContain("untitled");
    expect(rows[1].classList.contains("current")).toBe(false);
    expect(rows[0].classList.contains("current")).toBe(true);
  });

  it("tapping a row calls onSelect with that focus and closes the sheet", async () => {
    const onSelect = vi.fn();
    const { target } = render(PagesChip, { focuses, currentPageNumber: 1, onSelect });
    target.querySelector(".trigger-chip").click();
    await tick();

    const rows = target.querySelectorAll(".pages-sheet-row");
    rows[1].click();
    await tick();

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(focuses[1]);
    expect(target.querySelector(".sheet")).toBeNull();
  });

  it("does not render a new-page row when canNew is false", async () => {
    const { target } = render(PagesChip, { focuses, currentPageNumber: 1, onSelect: vi.fn(), canNew: false });
    target.querySelector(".trigger-chip").click();
    await tick();

    expect(target.querySelector(".pages-sheet-new")).toBeNull();
  });

  it("renders a new-page row and calls onNew when tapped", async () => {
    const onNew = vi.fn();
    const { target } = render(PagesChip, {
      focuses,
      currentPageNumber: 1,
      onSelect: vi.fn(),
      canNew: true,
      onNew,
    });
    target.querySelector(".trigger-chip").click();
    await tick();

    const newRow = target.querySelector(".pages-sheet-new");
    expect(newRow).not.toBeNull();
    expect(newRow.textContent).toContain("new page");
    newRow.click();
    await tick();

    expect(onNew).toHaveBeenCalledOnce();
    expect(target.querySelector(".sheet")).toBeNull();
  });
});
