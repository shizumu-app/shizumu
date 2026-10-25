import { describe, it, expect } from "vitest";
import { monthGrid, monthLabel, monthOf, shiftMonth, WEEKDAYS } from "../calendar-month.js";

const flat = (weeks) => weeks.flat();
const dates = (weeks) => flat(weeks).map((c) => c.date);

describe("monthGrid", () => {
  it("lays the month out in whole weeks, Sunday first", () => {
    // September 2026 starts on a Tuesday, so the first row carries two
    // days of August before it.
    const weeks = monthGrid({ month: "2026-09" });
    expect(WEEKDAYS.length).toBe(7);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0].date).toBe("2026-08-30");
    expect(weeks[0][2].date).toBe("2026-09-01");
    expect(dates(weeks)).toContain("2026-09-30");
  });

  it("gives the padding days real dates, not blanks", () => {
    // A writer who can SEE the 30th of August expects to reach it. A
    // blank there is a hole in the one control whose subject is which
    // day — and they are marked so the screen can draw them back.
    const first = monthGrid({ month: "2026-09" })[0][0];
    expect(first.inMonth).toBe(false);
    expect(first.day).toBe(30);
    expect(first.date).toBe("2026-08-30");
  });

  it("starts flush when the month starts on a Sunday", () => {
    // February 2026 starts on a Sunday: no padding at all in the first row.
    const weeks = monthGrid({ month: "2026-02" });
    expect(weeks[0][0].date).toBe("2026-02-01");
    expect(weeks[0][0].inMonth).toBe(true);
  });

  it("counts a leap February", () => {
    expect(dates(monthGrid({ month: "2024-02" }))).toContain("2024-02-29");
    expect(dates(monthGrid({ month: "2026-02" }))).not.toContain("2026-02-29");
    // 1900 was not a leap year; 2000 was — the rule, not the shortcut.
    expect(dates(monthGrid({ month: "1900-02" }))).not.toContain("1900-02-29");
    expect(dates(monthGrid({ month: "2000-02" }))).toContain("2000-02-29");
  });

  it("marks the days the caller says have writing", () => {
    const weeks = monthGrid({ month: "2026-09", marked: ["2026-09-11", "2026-09-12"] });
    const marked = flat(weeks).filter((c) => c.marked).map((c) => c.date);
    expect(marked).toEqual(["2026-09-11", "2026-09-12"]);
  });

  it("takes the marked days as a Set too, so neither caller converts", () => {
    const weeks = monthGrid({ month: "2026-09", marked: new Set(["2026-09-11"]) });
    expect(flat(weeks).filter((c) => c.marked).map((c) => c.date)).toEqual(["2026-09-11"]);
  });

  it("names today and the selected day, and neither by accident", () => {
    const weeks = monthGrid({ month: "2026-09", today: "2026-09-20", selected: "2026-09-11" });
    expect(flat(weeks).filter((c) => c.today).map((c) => c.date)).toEqual(["2026-09-20"]);
    expect(flat(weeks).filter((c) => c.selected).map((c) => c.date)).toEqual(["2026-09-11"]);
    // No selection is no selected cell — not "the first one".
    const none = monthGrid({ month: "2026-09" });
    expect(flat(none).some((c) => c.selected)).toBe(false);
    expect(flat(none).some((c) => c.today)).toBe(false);
  });

  it("accepts a full date as the month to draw", () => {
    expect(monthGrid({ month: "2026-09-11" })[0][2].date).toBe("2026-09-01");
  });

  it("draws nothing for a month it cannot read", () => {
    // Empty rather than a guess: the screen renders no grid, which is
    // visibly wrong, where a fallback month would be invisibly wrong.
    expect(monthGrid({ month: "" })).toEqual([]);
    expect(monthGrid({ month: "2026-13" })).toEqual([]);
    expect(monthGrid({})).toEqual([]);
  });
});

describe("shiftMonth", () => {
  it("steps a month either way", () => {
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
    expect(shiftMonth("2026-09", -1)).toBe("2026-08");
  });

  it("wraps the year, which is the whole reason it is a function", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-01", -13)).toBe("2024-12");
  });

  it("refuses what it cannot read", () => {
    expect(shiftMonth("", 1)).toBeNull();
    expect(shiftMonth("2026-09", 1.5)).toBeNull();
  });
});

describe("monthLabel and monthOf", () => {
  it("names the month with its year, lowercase", () => {
    expect(monthLabel("2026-09")).toBe("september 2026");
    expect(monthLabel("2026-01-05")).toBe("january 2026");
  });

  it("says nothing for a month it cannot read", () => {
    expect(monthLabel("nonsense")).toBe("");
  });

  it("reads the month a date is in", () => {
    expect(monthOf("2026-09-11")).toBe("2026-09");
    expect(monthOf(null)).toBeNull();
  });
});
