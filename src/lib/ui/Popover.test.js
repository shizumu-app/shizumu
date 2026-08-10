import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "./test-helper.js";
import Popover from "./Popover.svelte";
import * as responsive from "../responsive.js";

// Popover.svelte reads `isMobileNav`/`watchMobileNav` from responsive.js to
// pick its desktop-panel vs. phone-sheet branch. responsive.js itself caches
// its MediaQueryList objects at module scope (see src/lib/responsive.js),
// so stubbing window.matchMedia per-test doesn't reliably flip that branch
// once any earlier test in this file has caused a real (non-null) MQL to be
// cached — the cached object's `matches` sticks for the rest of the module's
// lifetime. Mocking the two responsive.js exports directly sidesteps that
// entirely and is the more direct unit boundary for this component anyway.
vi.mock("../responsive.js", () => ({
  isMobileNav: vi.fn(() => false),
  watchMobileNav: vi.fn((cb) => {
    cb(false);
    return () => {};
  }),
}));

function setMobileNav(active) {
  vi.mocked(responsive.isMobileNav).mockReturnValue(active);
  vi.mocked(responsive.watchMobileNav).mockImplementation((cb) => {
    cb(active);
    return () => {};
  });
}

afterEach(() => {
  cleanupAll();
  setMobileNav(false); // desktop is the default for the pre-existing tests below
});

describe("Popover", () => {
  it("renders nothing when open=false", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const { target } = render(Popover, { anchor, open: false });
    expect(target.querySelector(".popover")).toBeNull();
    anchor.remove();
  });

  it("renders panel when open=true", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const { target } = render(Popover, { anchor, open: true });
    await tick();
    expect(target.querySelector(".popover")).not.toBeNull();
    anchor.remove();
  });

  it("fires onClose on Escape", async () => {
    const onClose = vi.fn();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(Popover, { anchor, open: true, onClose });
    await tick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledOnce();
    anchor.remove();
  });
});

// Regression for the phone/sheet-path dismissal bug: `handleDocClick` used
// to run its containment checks even when mobileNav is true, but `panelEl`
// only binds on the desktop branch — so a tap anywhere inside the rendered
// BottomSheet (e.g. a calendar-day tap) fell through both checks and fired
// onClose before the tap's own handler could act. BottomSheet owns all
// dismissal on that path (scrim, Esc, hardware back, drag); Popover must
// get out of the way entirely on that path.
describe("Popover mobile sheet-path dismissal (FIX 1)", () => {
  it("mobile: pointerdown inside the sheet body does not close it", async () => {
    setMobileNav(true);
    const onClose = vi.fn();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const { target } = render(Popover, {
      anchor,
      open: true,
      onClose,
      title: "day",
    });
    await tick();

    const sheetBody = target.querySelector(".sheet-body");
    expect(sheetBody).not.toBeNull();
    const dayButton = document.createElement("button");
    sheetBody.appendChild(dayButton);
    dayButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
    anchor.remove();
  });

  it("desktop: pointerdown outside the panel closes it once", async () => {
    setMobileNav(false);
    const onClose = vi.fn();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(Popover, { anchor, open: true, onClose });
    await tick();

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(onClose).toHaveBeenCalledOnce();
    outside.remove();
    anchor.remove();
  });
});
