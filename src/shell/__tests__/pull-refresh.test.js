import { describe, it, expect } from "vitest";
import { pulledReadAddress, pulledPageAction, pullRefreshTargets } from "../pull-refresh.js";

const TODAY = "2026-10-14";

describe("pulledReadAddress", () => {
  it("reads a continuous trail's page through its trail, as the desktop does", () => {
    expect(pulledReadAddress({ page: { id: "p", lineage_id: "t" }, trailMode: "continuous" }))
      .toEqual({ how: "trail", lineageId: "t" });
  });

  it("reads every other page by its own address", () => {
    expect(pulledReadAddress({ page: { id: "p", lineage_id: "t" }, trailMode: "discrete" }))
      .toEqual({ how: "page" });
    expect(pulledReadAddress({ page: { id: "p", lineage_id: null }, trailMode: null }))
      .toEqual({ how: "page" });
  });

  it("reads nothing when no page is open, because there is nothing on screen to refresh", () => {
    expect(pulledReadAddress({ page: null, trailMode: null })).toEqual({ how: "none" });
  });
});

describe("pulledPageAction", () => {
  const open = { id: "p", date: TODAY, lineage_id: "t" };

  it("reloads a page still on the same trail", () => {
    expect(pulledPageAction({ open, fresh: { id: "p", lineage_id: "t" }, todayStr: TODAY })).toBe("reload");
  });

  it("adopts the page again when the other device moved it to another trail", () => {
    expect(pulledPageAction({ open, fresh: { id: "p", lineage_id: "u" }, todayStr: TODAY })).toBe("retrail");
    expect(pulledPageAction({ open, fresh: { id: "p", lineage_id: null }, todayStr: TODAY })).toBe("retrail");
  });

  it("treats a missing and a null trail as the same untrailed page", () => {
    expect(pulledPageAction({
      open: { id: "p", date: TODAY }, fresh: { id: "p", lineage_id: null }, todayStr: TODAY,
    })).toBe("reload");
  });

  it("shows the real today when today's page was swept by the first pull", () => {
    expect(pulledPageAction({ open, fresh: null, todayStr: TODAY })).toBe("today");
  });

  it("does nothing when a past page vanished", () => {
    // A past page disappearing is a delete somebody asked for. Snapping the
    // writer to today would hide that it happened.
    expect(pulledPageAction({
      open: { id: "p", date: "2026-10-01" }, fresh: null, todayStr: TODAY,
    })).toBe("none");
  });

  it("does nothing with no page open", () => {
    // Nothing is on screen, so there is nothing a pull could leave stale.
    expect(pulledPageAction({ open: null, fresh: { id: "p" }, todayStr: TODAY })).toBe("none");
  });
});


describe("pullRefreshTargets", () => {
  it("always refreshes a loaded page, even behind another root", () => {
    expect(pullRefreshTargets({ pageOpen: true, active: "settings", pushed: [], sheet: null })).toEqual(["page"]);
  });

  it("refreshes memory while it is the root on screen", () => {
    expect(pullRefreshTargets({ pageOpen: true, active: "memory", pushed: [], sheet: null }))
      .toEqual(["page", "memory"]);
  });

  it("refreshes the pins list while its screen is on the stack", () => {
    expect(pullRefreshTargets({ pageOpen: true, active: "page", pushed: ["pins"], sheet: null }))
      .toEqual(["page", "pins"]);
  });

  it("refreshes the trail list while the trail sheet is open", () => {
    expect(pullRefreshTargets({ pageOpen: true, active: "page", pushed: [], sheet: "trail" }))
      .toEqual(["page", "trails"]);
  });

  it("refreshes the page being read while the reading view is on the stack", () => {
    expect(pullRefreshTargets({ pageOpen: true, active: "memory", pushed: ["reading"], sheet: null }))
      .toEqual(["page", "memory", "reading"]);
  });

  it("refreshes nothing that is not showing", () => {
    // A surface that is closed reads its rows when it opens, so a read now
    // would be a round trip nobody looks at.
    expect(pullRefreshTargets({ pageOpen: false, active: "page", pushed: [], sheet: null })).toEqual([]);
  });
});
