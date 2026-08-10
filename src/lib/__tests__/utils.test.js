import { describe, it, expect } from "vitest";
import { formatLocalDate, getLocalDateStr, getYesterdayStr } from "../utils.js";

describe("formatLocalDate", () => {
  it("formats a date as YYYY-MM-DD", () => {
    const date = new Date(2024, 3, 6); // April 6, 2024
    expect(formatLocalDate(date)).toBe("2024-04-06");
  });

  it("pads single-digit month and day", () => {
    const date = new Date(2024, 0, 5); // January 5
    expect(formatLocalDate(date)).toBe("2024-01-05");
  });

  it("handles December 31", () => {
    const date = new Date(2024, 11, 31);
    expect(formatLocalDate(date)).toBe("2024-12-31");
  });
});

describe("getLocalDateStr", () => {
  it("returns today as YYYY-MM-DD", () => {
    const result = getLocalDateStr();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Should match today
    const today = formatLocalDate(new Date());
    expect(result).toBe(today);
  });
});

describe("getYesterdayStr", () => {
  it("returns yesterday as YYYY-MM-DD", () => {
    const result = getYesterdayStr();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(result).toBe(formatLocalDate(yesterday));
  });
});
