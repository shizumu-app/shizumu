import { describe, it, expect } from "vitest";
import { focusPropChanged } from "./focus-field-sync.js";

// The laptop's focus field (WhatMattersNow.svelte) keeps its own text and
// takes its `value` prop only when that prop really changed. Until 0.8.2 it
// took the prop whenever it differed from the last saved text: Page.svelte's
// `page.what_matters_now` is not patched on save, so it stayed null, and the
// first time `page` was replaced (a trail created from the header) the field
// read that stale null as news, emptied itself, and Return saved "" over the
// focus. Found on the A16 run of 2026-11-07, J12.1: op 2494 saved the focus,
// the trail landed, op 2497 wrote "".
describe("focusPropChanged", () => {
  it("takes the first value it is given", () => {
    expect(focusPropChanged(null, "p1", "ship the merge")).toBe(true);
    expect(focusPropChanged(null, "p1", null)).toBe(true);
  });

  it("does not take the same stale prop again after the writer typed and saved", () => {
    // The page object was replaced (a trail set), its focus still the null
    // it was created with: not a change, so the typed focus stays.
    const seen = { pageId: "p1", value: "" };
    expect(focusPropChanged(seen, "p1", null)).toBe(false);
    expect(focusPropChanged(seen, "p1", "")).toBe(false);
  });

  it("takes a value that really changed on the same page (the other device's edit)", () => {
    expect(focusPropChanged({ pageId: "p1", value: "" }, "p1", "from the phone")).toBe(true);
    expect(focusPropChanged({ pageId: "p1", value: "old" }, "p1", "new")).toBe(true);
  });

  it("takes the value of another page, even when both are empty", () => {
    // A page switch must clear the previous page's typed text.
    expect(focusPropChanged({ pageId: "p1", value: "" }, "p2", null)).toBe(true);
  });
});
