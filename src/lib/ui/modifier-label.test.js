import { describe, it, expect } from "vitest";
import { modifierLabel, currentModifierLabel } from "./modifier-label.js";

describe("modifierLabel", () => {
  it("answers ⌘ on an Intel Mac (navigator.platform)", () => {
    expect(modifierLabel({ platform: "MacIntel", userAgent: "" })).toBe("⌘");
  });

  it("answers ⌘ on Apple Silicon (navigator.platform)", () => {
    expect(modifierLabel({ platform: "MacARM", userAgent: "" })).toBe("⌘");
  });

  it("answers ⌘ from the userAgent when platform is gone", () => {
    // Chromium is deprecating navigator.platform; Safari/Chrome on macOS
    // still carry "Macintosh" in the UA string. App.svelte:94 falls back
    // the same way and this module must not diverge from it.
    expect(
      modifierLabel({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      }),
    ).toBe("⌘");
  });

  it("answers ctrl on Linux", () => {
    expect(
      modifierLabel({
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      }),
    ).toBe("ctrl");
  });

  it("answers ctrl on Windows", () => {
    expect(
      modifierLabel({
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      }),
    ).toBe("ctrl");
  });

  it("answers ctrl when there is no navigator at all", () => {
    // Not "nothing happens": the panel must still print a usable key.
    // ctrl is the safe default — see the module comment.
    expect(modifierLabel(undefined)).toBe("ctrl");
    expect(modifierLabel(null)).toBe("ctrl");
  });

  it("answers ctrl when navigator exposes neither field", () => {
    expect(modifierLabel({})).toBe("ctrl");
  });

  it("ignores non-string platform/userAgent instead of throwing", () => {
    // A webview handing back a non-string here used to be an exception on
    // .includes, which would have blanked the whole panel.
    expect(modifierLabel({ platform: 42, userAgent: null })).toBe("ctrl");
  });

  it("does not match 'Mac' inside an unrelated Windows UA", () => {
    // Guards the fallback from over-matching: no "Macintosh", no ⌘.
    expect(
      modifierLabel({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0) Mac-like" }),
    ).toBe("ctrl");
  });

  it("currentModifierLabel reads the ambient navigator", () => {
    // jsdom reports a non-Mac platform, so this is the ctrl branch.
    expect(currentModifierLabel()).toBe(modifierLabel(navigator));
  });
});
