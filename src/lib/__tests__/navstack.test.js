import { describe, it, expect, beforeEach } from "vitest";
import { navPush, navPopAll, subscribe, _resetForTests } from "../navstack.js";

describe("navPopAll", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("closes matching entries through their own onClose and drops them from the stack", () => {
    let sheetClosed = false;
    let settingsClosed = false;
    navPush("sheet", () => { sheetClosed = true; }, { hideBar: true });
    navPush("settings", () => { settingsClosed = true; });

    let snap;
    subscribe((s) => { snap = s; });
    expect(snap.depth).toBe(2);
    expect(snap.hideBar).toBe(true);

    navPopAll((e) => e.hideBar);

    expect(sheetClosed).toBe(true);
    expect(settingsClosed).toBe(false);
    expect(snap.hideBar).toBe(false);
    expect(snap.depth).toBe(1);
  });

  // A predicate matching nothing is a plain no-op: no entry's onClose fires,
  // and depth/hideBar are unchanged. Distinct from the "closes a match"
  // case above, so a regression that always sweeps (or never does) fails
  // one of the two.
  it("leaves the stack untouched when nothing matches", () => {
    let closed = false;
    navPush("settings", () => { closed = true; });

    let snap;
    subscribe((s) => { snap = s; });
    navPopAll((e) => e.hideBar);

    expect(closed).toBe(false);
    expect(snap.depth).toBe(1);
  });
});
