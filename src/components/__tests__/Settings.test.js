// Regression coverage for the "sync button opens settings but not on the
// sync tab" bug: Settings hardcoded activeTab to "appearance" with no way
// for a caller (the sync status pill) to request a specific tab on open.
import { describe, it, expect, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import Settings from "../Settings.svelte";

afterEach(cleanupAll);

const baseProps = {
  currentTone: "cream",
  onToneChange: () => {},
  onDeleteAll: () => {},
  onClose: () => {},
};

describe("Settings initialTab", () => {
  it("defaults to the appearance tab when no initialTab is given", async () => {
    const { target } = render(Settings, { ...baseProps });
    await tick();
    const active = target.querySelector(".sidebar-nav-row.active, [class*='active']");
    expect(target.querySelector(".section-title")?.textContent?.trim()).toBe("appearance");
  });

  it("opens directly on the requested tab", async () => {
    const { target } = render(Settings, { ...baseProps, initialTab: "sync" });
    await tick();
    expect(target.querySelector(".section-title")?.textContent?.trim()).toBe("sync");
  });
});
