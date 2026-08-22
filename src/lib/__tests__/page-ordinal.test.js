import { describe, it, expect } from "vitest";
import { ordinalOf, withOrdinals } from "../page-ordinal.js";

// The rail sorts by created_at (stable across devices via HLC) but labelled
// rows with page_number, which is minted per device. On a second device the
// list read "2, 3, 4, 5, 1". The label must come from the order, never from
// the number.
const focuses = [
  { id: "a", page_number: 2, created_at: "2026-08-22T01:00:00Z" },
  { id: "b", page_number: 3, created_at: "2026-08-22T01:05:00Z" },
  { id: "c", page_number: 1, created_at: "2026-08-22T02:24:00Z" },
];

describe("withOrdinals", () => {
  it("labels by position in the order given", () => {
    expect(withOrdinals(focuses).map((f) => f.ordinal)).toEqual([1, 2, 3]);
  });
  it("keeps every other field", () => {
    expect(withOrdinals(focuses)[2].page_number).toBe(1);
  });
});

describe("ordinalOf", () => {
  it("finds a page by id", () => {
    expect(ordinalOf(focuses, "c")).toBe(3);
  });
  it("is 0 for a page not in the list, so callers can fall back", () => {
    // Not a no-op: 0 is a deliberate sentinel that "page 0/3" would expose,
    // and Page.svelte uses it to fall back to the legacy number.
    expect(ordinalOf(focuses, "zzz")).toBe(0);
    expect(ordinalOf(null, "a")).toBe(0);
  });
});
