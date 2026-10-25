import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { saveHealth, saveFailed, saveSucceeded, retryDelayMs, isGonePageError, _resetSaveHealth } from "../save-health.js";

beforeEach(() => _resetSaveHealth());

describe("saveHealth", () => {
  it("starts healthy", () => {
    expect(get(saveHealth)).toEqual({ failing: false, attempts: 0 });
  });

  it("counts failures in a row", () => {
    saveFailed(new Error("disk I/O error"));
    saveFailed(new Error("disk I/O error"));
    expect(get(saveHealth)).toEqual({ failing: true, attempts: 2 });
  });

  it("clears on the first save that lands", () => {
    saveFailed(new Error("database is locked"));
    saveSucceeded();
    expect(get(saveHealth)).toEqual({ failing: false, attempts: 0 });
  });

  it("does not publish a change when a healthy save succeeds again", () => {
    // Every keystroke's save lands here; a store that re-published each time
    // would re-render the page's chrome once a second while typing.
    let calls = 0;
    const off = saveHealth.subscribe(() => { calls += 1; });
    saveSucceeded();
    saveSucceeded();
    off();
    expect(calls).toBe(1);
  });
});

describe("retryDelayMs", () => {
  it("backs off and stops growing at thirty seconds", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([2000, 5000, 10000, 30000, 30000, 30000]);
  });
});

describe("isGonePageError", () => {
  it("knows the backend's answer for a page that is no longer there", () => {
    // Measured on an A16 when the open page is deleted: the switch to the
    // neighbour flushes the page just removed.
    expect(isGonePageError("Query returned no rows")).toBe(true);
    expect(isGonePageError(new Error("Query returned no rows"))).toBe(true);
  });

  it("does not excuse a fault that loses writing", () => {
    expect(isGonePageError("disk I/O error")).toBe(false);
    expect(isGonePageError("database is locked")).toBe(false);
    expect(isGonePageError(null)).toBe(false);
  });
});
