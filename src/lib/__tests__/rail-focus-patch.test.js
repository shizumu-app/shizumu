import { describe, it, expect } from "vitest";

// Pure logic extracted from Page.svelte's onValueChange handler.
// When the user saves a new "what matters now" value, the matching entry
// in railFocuses must be patched so FocusRail reflects the update in the
// same tick, without waiting for a full loadRailFocuses round-trip.
// If the page is not yet in railFocuses (freshly created, or a date with
// no focuses returned yet), a synthesized entry is appended, mirroring
// the fallback synthesis in loadRailFocuses.
function patchRailFocus(railFocuses, page, text, effectiveDate, currentTrailMode) {
  const hasEntry = railFocuses.some((f) => f.id === page.id);
  if (hasEntry) {
    return railFocuses.map((f) =>
      f.id === page.id ? { ...f, what_matters_now: text || null } : f
    );
  }
  return [
    ...railFocuses,
    {
      id: page.id,
      date: effectiveDate,
      page_number: page.page_number,
      what_matters_now: text || null,
      is_open: page.is_open,
      lineage_id: page.lineage_id,
      isContinuousCanonical: currentTrailMode === "continuous",
      created_at: page.created_at,
    },
  ];
}

describe("patchRailFocus", () => {
  const pageA = {
    id: "a",
    page_number: 1,
    is_open: true,
    lineage_id: "trail-1",
    created_at: "2026-05-09T10:00:00Z",
  };
  const pageB = {
    id: "b",
    page_number: 1,
    is_open: true,
    lineage_id: "trail-2",
    created_at: "2026-05-09T11:00:00Z",
  };

  const baseRail = [
    { id: "a", what_matters_now: "old focus a", is_open: true },
    { id: "b", what_matters_now: "focus b", is_open: true },
  ];

  const effectiveDate = "2026-05-09";

  it("updates what_matters_now for the matching page id", () => {
    const updated = patchRailFocus(baseRail, pageA, "new focus", effectiveDate, "discrete");
    expect(updated[0].what_matters_now).toBe("new focus");
  });

  it("leaves other entries unchanged", () => {
    const updated = patchRailFocus(baseRail, pageA, "new focus", effectiveDate, "discrete");
    expect(updated[1]).toEqual(baseRail[1]);
  });

  it("sets what_matters_now to null when text is empty", () => {
    const updated = patchRailFocus(baseRail, pageA, "", effectiveDate, "discrete");
    expect(updated[0].what_matters_now).toBeNull();
  });

  it("does not mutate the original array", () => {
    const copy = baseRail.map((f) => ({ ...f }));
    patchRailFocus(baseRail, pageA, "something", effectiveDate, "discrete");
    expect(baseRail[0].what_matters_now).toBe(copy[0].what_matters_now);
  });

  it("preserves all other fields on the patched entry", () => {
    const updated = patchRailFocus(baseRail, pageA, "updated", effectiveDate, "discrete");
    expect(updated[0].id).toBe("a");
    expect(updated[0].is_open).toBe(true);
  });

  // --- synthesis path: page.id absent from railFocuses ---

  it("synthesizes an entry when the page id is absent from rail focuses", () => {
    const pageC = {
      id: "c",
      page_number: 2,
      is_open: true,
      lineage_id: "trail-1",
      created_at: "2026-05-09T12:00:00Z",
    };
    const updated = patchRailFocus(baseRail, pageC, "fresh focus", effectiveDate, "continuous");
    expect(updated).toHaveLength(baseRail.length + 1);
    const synthesized = updated.find((f) => f.id === "c");
    expect(synthesized).toBeDefined();
    expect(synthesized.what_matters_now).toBe("fresh focus");
    expect(synthesized.id).toBe("c");
    expect(synthesized.date).toBe(effectiveDate);
    expect(synthesized.page_number).toBe(2);
    expect(synthesized.is_open).toBe(true);
    expect(synthesized.lineage_id).toBe("trail-1");
    expect(synthesized.isContinuousCanonical).toBe(true);
    expect(synthesized.created_at).toBe("2026-05-09T12:00:00Z");
  });

  it("synthesized entry has what_matters_now null when text is empty", () => {
    const pageC = {
      id: "c",
      page_number: 1,
      is_open: true,
      lineage_id: null,
      created_at: "2026-05-09T12:00:00Z",
    };
    const updated = patchRailFocus([], pageC, "", effectiveDate, "discrete");
    expect(updated[0].what_matters_now).toBeNull();
  });

  it("does not synthesize a duplicate when page id is already present", () => {
    const updated = patchRailFocus(baseRail, pageA, "updated", effectiveDate, "discrete");
    expect(updated).toHaveLength(baseRail.length);
  });

  it("marks isContinuousCanonical false for discrete trail synthesis", () => {
    const pageC = {
      id: "c",
      page_number: 1,
      is_open: false,
      lineage_id: "trail-3",
      created_at: "2026-05-09T13:00:00Z",
    };
    const updated = patchRailFocus(baseRail, pageC, "text", effectiveDate, "discrete");
    const synthesized = updated.find((f) => f.id === "c");
    expect(synthesized.isContinuousCanonical).toBe(false);
  });

  // Whitespace-only text is preserved as-is (mirrors the DB write path).
  // Whitespace normalization is a separate pre-existing concern not addressed here.
  it("leaves whitespace-only text as-is in synthesized entry", () => {
    const pageC = {
      id: "c",
      page_number: 1,
      is_open: true,
      lineage_id: null,
      created_at: "2026-05-09T12:00:00Z",
    };
    const updated = patchRailFocus([], pageC, "   ", effectiveDate, "discrete");
    // "   " is truthy so `text || null` returns "   ", not null
    expect(updated[0].what_matters_now).toBe("   ");
  });
});
