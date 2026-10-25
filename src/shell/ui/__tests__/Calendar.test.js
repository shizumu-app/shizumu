import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Calendar from "../Calendar.svelte";

afterEach(cleanupAll);

const TODAY = "2026-09-20";

const mount = (props) => render(Calendar, { month: "2026-09", today: TODAY, ...props });
const cell = (target, date) => target.querySelector(`[data-date="${date}"]`);
const days = (target) => [...target.querySelectorAll(".shell-calendar-day")];

describe("Calendar", () => {
  it("draws the month, its weekdays and whole weeks of days", () => {
    const { target } = mount({});
    expect(target.querySelector(".shell-calendar-month").textContent.trim()).toBe("september 2026");
    expect(target.querySelectorAll(".shell-calendar-weekday").length).toBe(7);
    expect(days(target).length % 7).toBe(0);
    expect(cell(target, "2026-09-11")).not.toBeNull();
  });

  it("hands the tapped day up", () => {
    const onPick = vi.fn();
    const { target } = mount({ onPick });
    cell(target, "2026-09-11").click();
    expect(onPick).toHaveBeenCalledWith("2026-09-11");
  });

  it("asks the host to change month rather than holding one", () => {
    // The component keeps no state: two sheets open on the month each
    // cares about, and neither inherits where the other was paged to.
    const onMonth = vi.fn();
    const { target } = mount({ onMonth });
    target.querySelector('[aria-label="next month"]').click();
    expect(onMonth).toHaveBeenCalledWith("2026-10");
    target.querySelector('[aria-label="previous month"]').click();
    expect(onMonth).toHaveBeenCalledWith("2026-08");
  });

  it("marks the days with writing, and says which is today and which is chosen", () => {
    const { target } = mount({ marked: ["2026-09-11"], selected: "2026-09-12" });
    expect(cell(target, "2026-09-11").dataset.marked).toBe("true");
    expect(cell(target, "2026-09-12").getAttribute("aria-pressed")).toBe("true");
    expect(cell(target, TODAY).dataset.today).toBe("true");
    // And none of the three by accident.
    expect(cell(target, "2026-09-13").dataset.marked).toBeUndefined();
    expect(cell(target, "2026-09-13").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the neighbouring months' days, drawn back", () => {
    const { target } = mount({});
    const august = cell(target, "2026-08-31");
    expect(august).not.toBeNull();
    expect(august.dataset.outside).toBe("true");
  });

  it("lets every day be picked by default, written on or not", () => {
    // Memory's case: a filter may name a day with nothing on it, and an
    // empty list is an answer.
    const onPick = vi.fn();
    const { target } = mount({ onPick });
    cell(target, "2026-09-13").click();
    expect(onPick).toHaveBeenCalledWith("2026-09-13");
  });

  it("makes a day with no writing inert under markedOnly, but keeps it legible", () => {
    // The day sheet's case: the rows are the days that HAVE pages, so a
    // day with none has nothing to open. Not hidden — a calendar with
    // holes cannot be read — and not a button either.
    const onPick = vi.fn();
    const { target } = mount({ onPick, markedOnly: true, marked: ["2026-09-11"] });
    const empty = cell(target, "2026-09-13");
    expect(empty.tagName).toBe("SPAN");
    expect(empty.textContent.trim()).toBe("13");
    empty.click();
    expect(onPick).not.toHaveBeenCalled();
    expect(cell(target, "2026-09-11").tagName).toBe("BUTTON");
  });

  it("keeps today pressable under markedOnly, even with nothing on it", () => {
    // getOrCreateToday makes the page, so the day sheet's first row is
    // today whether or not one exists. The grid must not refuse it.
    const onPick = vi.fn();
    const { target } = mount({ onPick, markedOnly: true, marked: [] });
    cell(target, TODAY).click();
    expect(onPick).toHaveBeenCalledWith(TODAY);
  });

  it("draws nothing rather than a guess when the month cannot be read", () => {
    const { target } = render(Calendar, { month: "", today: TODAY });
    expect(days(target).length).toBe(0);
    expect(target.querySelector(".shell-calendar-month").textContent.trim()).toBe("");
  });
});
