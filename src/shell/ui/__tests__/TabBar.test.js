import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import TabBar from "../TabBar.svelte";

afterEach(cleanupAll);

const TABS = [
  { id: "page", label: "page" },
  { id: "memory", label: "memory" },
  { id: "settings", label: "settings" },
];

describe("TabBar", () => {
  it("renders one control per root", () => {
    const { target } = render(TabBar, { tabs: TABS, active: "page" });
    expect(target.querySelectorAll(".shell-tab").length).toBe(3);
  });

  it("marks the active root, and only it", () => {
    const { target } = render(TabBar, { tabs: TABS, active: "memory" });
    const active = target.querySelectorAll(".shell-tab.active");
    expect(active.length).toBe(1);
    expect(active[0].dataset.tabId).toBe("memory");
  });

  it("reports the tab that was chosen", () => {
    const onSelect = vi.fn();
    const { target } = render(TabBar, { tabs: TABS, active: "page", onSelect });
    target.querySelector('[data-tab-id="settings"]').click();
    expect(onSelect).toHaveBeenCalledWith("settings");
  });

  it("does not report a re-tap of the root already showing", () => {
    // Tapping the current root is not navigation. Firing anyway would
    // reset the root's own push stack under the user, which is what
    // "tap the tab you are on and lose your place" looks like.
    const onSelect = vi.fn();
    const { target } = render(TabBar, { tabs: TABS, active: "page", onSelect });
    target.querySelector('[data-tab-id="page"]').click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks each control with aria-current for the active root", () => {
    const { target } = render(TabBar, { tabs: TABS, active: "memory" });
    expect(target.querySelector('[data-tab-id="memory"]').getAttribute("aria-current")).toBe("page");
    expect(target.querySelector('[data-tab-id="page"]').getAttribute("aria-current")).toBeNull();
  });
});
