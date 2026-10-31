import { describe, it, expect } from "vitest";
import { mentionParts } from "../mention-label.js";

const L = [
  { id: "a", name: "the harbour book", parent_id: null },
  { id: "b", name: "research", parent_id: "a" },
];

describe("mentionParts — a page as its trail and its name, for the palette", () => {
  it("splits a discrete page into its trail path and its focus", () => {
    expect(mentionParts({ page: { lineage_id: "b", what_matters_now: "the storm chapter", date: "2026-10-31" }, lineages: L }))
      .toEqual({ context: "the harbour book › research", title: "the storm chapter" });
  });

  it("names a page with no focus by its date", () => {
    expect(mentionParts({ page: { lineage_id: "a", what_matters_now: "", date: "2026-10-31" }, lineages: L }))
      .toEqual({ context: "the harbour book", title: "2026-10-31" });
  });

  it("names a continuous trail's page by the trail itself, under its parents", () => {
    expect(mentionParts({ page: { lineage_id: "b", lineage_mode: "continuous", date: "2026-10-31" }, lineages: L }))
      .toEqual({ context: "the harbour book", title: "research" });
  });

  it("puts an untrailed page's date before its focus, and stands a bare date alone", () => {
    expect(mentionParts({ page: { lineage_id: null, what_matters_now: "notes", date: "2026-10-31" }, lineages: L }))
      .toEqual({ context: "2026-10-31", title: "notes" });
    // No trail and no focus leaves nothing to put beside the date: an empty
    // context, not a repeated one.
    expect(mentionParts({ page: { lineage_id: null, date: "2026-10-31" }, lineages: L }))
      .toEqual({ context: "", title: "2026-10-31" });
  });
});
