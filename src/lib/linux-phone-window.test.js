import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DESKTOP_MIN_SIZE,
  isLinuxAppHost,
  windowMinSizeFor,
  minSizeCall,
  resizeGripsShown,
} from "./linux-phone-window.js";
import { shouldBootShell } from "../shell/shell-boot.js";

// Real user agents. WebKitGTK says X11 on Wayland too.
const UA_LINUX_ARM = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const UA_LINUX_X86 = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 15; SM-A166B Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36";
const UA_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";

describe("which layout a Linux phone gets (shouldBootShell, asked with Linux inputs)", () => {
  // The gate itself lives in shell-boot.js and does not look at the OS.
  // These rows are what a Linux host feeds it: WebKitGTK's pointer answer
  // comes from the GDK seat (touch and no pointer → coarse, any pointer →
  // fine), the viewport from the compositor's logical size.

  it("a touch-only Linux phone at 360 CSS px boots the phone shell", () => {
    // Librem 5 or PinePhone at scale 2 under Phosh: PHONE_QUERY matches,
    // the seat has touch and no pointer.
    expect(shouldBootShell({ setting: null, mobileNav: true, coarsePointer: true })).toBe(true);
  });

  it("a Linux desktop keeps the desktop tree, at any window size", () => {
    // A desktop seat always has a pointer, so WebKitGTK says fine, and the
    // short-window case (mobileNav true) is refused on the pointer alone.
    expect(shouldBootShell({ setting: null, mobileNav: false, coarsePointer: false })).toBe(false);
    expect(shouldBootShell({ setting: null, mobileNav: true, coarsePointer: false })).toBe(false);
  });

  it("the stored opt-out wins on a Linux phone", () => {
    expect(shouldBootShell({ setting: "false", mobileNav: true, coarsePointer: true })).toBe(false);
  });
});

describe("isLinuxAppHost", () => {
  it("is the Tauri app on Linux, either architecture", () => {
    expect(isLinuxAppHost({ userAgent: UA_LINUX_ARM, isTauri: true })).toBe(true);
    expect(isLinuxAppHost({ userAgent: UA_LINUX_X86, isTauri: true })).toBe(true);
  });

  it("is not Android, whose user agent also says Linux", () => {
    expect(isLinuxAppHost({ userAgent: UA_ANDROID, isTauri: true })).toBe(false);
  });

  it("is not a browser on Linux, which has no window to size", () => {
    expect(isLinuxAppHost({ userAgent: UA_LINUX_ARM, isTauri: false })).toBe(false);
  });

  it("is not Windows, and not an absent user agent", () => {
    expect(isLinuxAppHost({ userAgent: UA_WINDOWS, isTauri: true })).toBe(false);
    expect(isLinuxAppHost({ userAgent: undefined, isTauri: true })).toBe(false);
  });
});

describe("windowMinSizeFor", () => {
  it("clears the floor on Linux while the phone shell is booted", () => {
    expect(windowMinSizeFor({ linuxHost: true, bootShell: true })).toBe("phone");
  });

  it("keeps the desktop floor on Linux on the desktop tree", () => {
    expect(windowMinSizeFor({ linuxHost: true, bootShell: false })).toBe("desktop");
  });

  it("does not size a window that is not a Linux app window", () => {
    // null, not "desktop": Android and iOS have no window floor to restore,
    // and Windows and macOS are left exactly as tauri.conf.json made them.
    expect(windowMinSizeFor({ linuxHost: false, bootShell: true })).toBe(null);
    expect(windowMinSizeFor({ linuxHost: false, bootShell: false })).toBe(null);
  });
});

describe("minSizeCall", () => {
  it("a desktop Linux launch makes no call at all", () => {
    // null because the window already has the floor tauri.conf.json gave
    // it; calling setMinSize with the same numbers is the only change a
    // desktop could see from this module, and it is not made.
    expect(minSizeCall({ applied: "desktop", wanted: "desktop" })).toBe(null);
  });

  it("the phone shell booting clears the minimum", () => {
    expect(minSizeCall({ applied: "desktop", wanted: "phone" })).toEqual({ size: null });
  });

  it("docking the phone to a mouse puts the desktop floor back", () => {
    expect(minSizeCall({ applied: "phone", wanted: "desktop" })).toEqual({ size: { width: 360, height: 480 } });
  });

  it("a host this module does not size gets no call", () => {
    // null because windowMinSizeFor answered null: not a Linux window
    expect(minSizeCall({ applied: "desktop", wanted: null })).toBe(null);
  });

  it("the floor matches tauri.conf.json, which is where the window got it", () => {
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const win = conf.app.windows[0];
    expect(DESKTOP_MIN_SIZE).toEqual({ width: win.minWidth, height: win.minHeight });
  });
});

describe("resizeGripsShown", () => {
  it("shows on a desktop app window", () => {
    expect(resizeGripsShown({ isTauri: true, isMobilePlatform: false, bootShell: false })).toBe(true);
  });

  it("hides while the phone shell is booted", () => {
    expect(resizeGripsShown({ isTauri: true, isMobilePlatform: false, bootShell: true })).toBe(false);
  });

  it("hides on Android and iOS, and in a browser, as before", () => {
    expect(resizeGripsShown({ isTauri: true, isMobilePlatform: true, bootShell: false })).toBe(false);
    expect(resizeGripsShown({ isTauri: false, isMobilePlatform: false, bootShell: false })).toBe(false);
  });
});
