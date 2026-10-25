// Turning the phone layout off was one-way. The only switch lives in the
// phone layout's own labs section, and the layout it hands you (this
// settings screen) had none, so a phone that opted out stayed out for good
// (found 2026-10-24 drafting the 0.8.0 notes; App.svelte's MobileActionBar
// note says the same). This screen now offers the way back, where it matters.
import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const env = vi.hoisted(() => ({ phone: true, stored: "false" }));
vi.mock("../../lib/responsive.js", async (importOriginal) => ({
  ...(await importOriginal()),
  isPhoneViewport: () => env.phone,
  isCoarsePointer: () => env.phone,
}));
vi.mock("../../lib/api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getSetting: vi.fn(async (key) => (key === "try_new_shell" ? env.stored : null)),
  setSetting: vi.fn(async () => {}),
}));

import * as api from "../../lib/api.js";
import Settings from "../Settings.svelte";

afterEach(() => { cleanupAll(); vi.clearAllMocks(); env.phone = true; env.stored = "false"; });

const props = { currentTone: "cream", onToneChange: () => {}, onDeleteAll: () => {}, onClose: () => {}, initialTab: "labs" };
const settle = async () => { for (let i = 0; i < 5; i++) { await tick(); await Promise.resolve(); } };
const layoutToggle = (root) => root.querySelector('[aria-label="new phone layout"]');

describe("settings — the way back to the phone layout", () => {
  it("offers the phone layout to a phone that turned it off, and turns it back on", async () => {
    const { target } = render(Settings, props);
    await settle();
    const t = layoutToggle(target);
    expect(t).toBeTruthy();
    t.click();
    await settle();
    expect(api.setSetting).toHaveBeenCalledWith("try_new_shell", "true");
    expect(target.textContent).toContain("when you reopen shizumu");
  });

  // A wide screen with a mouse never boots the phone layout, so a switch
  // for it there would control nothing.
  it("offers nothing on a wide screen with a mouse", async () => {
    env.phone = false;
    const { target } = render(Settings, { ...props, initialTab: "labs" });
    await settle();
    expect(layoutToggle(target)).toBeNull();
  });
});
