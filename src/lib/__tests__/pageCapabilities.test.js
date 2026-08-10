import { describe, expect, test } from "vitest";
import { canCreateNewPage } from "../pageCapabilities.js";

describe("canCreateNewPage", () => {
  test("true when viewing today", () => {
    expect(canCreateNewPage("2026-08-02", "2026-08-02")).toBe(true);
  });

  test("false when viewing a past date — new pages belong to today", () => {
    expect(canCreateNewPage("2026-08-01", "2026-08-02")).toBe(false);
  });

  test("false when viewing a future date", () => {
    expect(canCreateNewPage("2026-08-03", "2026-08-02")).toBe(false);
  });

  // The regression this whole change exists for: trail mode is NOT an input.
  // Creation is always safe because create_new_page leaves lineage_id null;
  // the single-canonical invariant is enforced at assignment time in Rust.
  test("does not consider trail mode — takes only the two dates", () => {
    expect(canCreateNewPage.length).toBe(2);
  });

  test("false when either date is missing", () => {
    expect(canCreateNewPage(null, "2026-08-02")).toBe(false);
    expect(canCreateNewPage("2026-08-02", null)).toBe(false);
  });
});
