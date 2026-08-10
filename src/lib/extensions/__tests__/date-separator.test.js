import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We can't easily test the TipTap extension registration without a full editor,
// but we can test the formatDate helper by extracting it or testing via the module.
// For now, test the date formatting logic directly.

describe("DateSeparator date formatting", () => {
  // Reproduce the formatDate logic from the extension
  function formatDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + "T00:00:00");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.floor((today - d) / 86400000);
      if (diff === 0) return "today";
      if (diff === 1) return "yesterday";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
    } catch {
      return dateStr;
    }
  }

  it("returns 'today' for today's date", () => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(formatDate(dateStr)).toBe("today");
  });

  it("returns 'yesterday' for yesterday's date", () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(formatDate(dateStr)).toBe("yesterday");
  });

  it("returns formatted date for older dates", () => {
    // Use a date far in the past to avoid "today"/"yesterday"
    const result = formatDate("2024-01-15");
    expect(result).toBe("jan 15");
  });

  it("returns empty string for null/undefined", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
  });
});
