import { describe, it, expect } from "vitest";
import { handedOutAsToday } from "../today-page.js";

// The measured case: the WebView's day behind the backend's by one.
const BACKEND_TODAY = "2026-10-09";
const WEBVIEW_TODAY = "2026-10-08";
const row = { id: "today-row", date: BACKEND_TODAY };

describe("handedOutAsToday", () => {
  it("is true for the row the backend handed out, whatever a lagging clock says", () => {
    expect(handedOutAsToday({ page: row, todayPageId: "today-row", todayDateStr: WEBVIEW_TODAY })).toBe(true);
    expect(handedOutAsToday({ page: row, todayPageId: "today-row", todayDateStr: BACKEND_TODAY })).toBe(true);
  });

  it("expires once the day moves past the page's own date", () => {
    // A real midnight: the page that was today's is yesterday's now, and
    // both trees' midnight flows depend on it turning read-only.
    expect(handedOutAsToday({ page: row, todayPageId: "today-row", todayDateStr: "2026-10-10" })).toBe(false);
  });

  it("is false for any other row, so the caller's date rule still decides it", () => {
    // False here does not mean read-only — it means "not by identity", and
    // the date arm answers next. A past page from the date sheet is one.
    expect(handedOutAsToday({ page: { id: "other", date: "2026-10-07" }, todayPageId: "today-row", todayDateStr: WEBVIEW_TODAY })).toBe(false);
  });

  it("is false before the backend has handed out anything", () => {
    // Same reason as above: the date arm still answers for that frame.
    expect(handedOutAsToday({ page: row, todayPageId: null, todayDateStr: WEBVIEW_TODAY })).toBe(false);
    expect(handedOutAsToday({ page: null, todayPageId: "today-row", todayDateStr: WEBVIEW_TODAY })).toBe(false);
  });
});
