import { describe, it, expect } from "vitest";
import { platformProfile, osFromUserAgent, currentPlatformProfile } from "../platform.js";

// Real strings, copied rather than invented, because a hand-written UA is a
// test of the regex against itself. Each one is what the named environment
// actually sends.
const UA = {
  // Tauri's Android WebView: `Android` plus the `wv` token that marks it as
  // an embedded WebView rather than Chrome.
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.101 " +
    "Mobile Safari/537.36",
  // Chrome on the same phone, no `wv`. The OS is the same fact either way —
  // it is `isWeb` that separates these two, not this function.
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/121.0.6167.101 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/15E148",
  // An iPad WebView that has NOT been put into desktop-class mode — Tauri's
  // default, and the one iPad case this function can read.
  ipadWebView:
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/15E148",
  // Safari on iPadOS, desktop-class (its default). Byte-identical to
  // `macSafari` below — that is the trap, not a copy-paste slip.
  ipadSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
};

/** A stand-in window carrying the two facts `currentPlatformProfile` reads
 *  and nothing else. Tauri is present or it is not — the value is only ever
 *  checked for truthiness (api.js, LockScreen.svelte). */
function fakeWindow({ ua, tauri = false }) {
  return { navigator: { userAgent: ua }, ...(tauri ? { __TAURI_INTERNALS__: {} } : {}) };
}

describe("platformProfile", () => {
  it("gives Android the system back and disarms the shell's edge", () => {
    const p = platformProfile({ os: "android", isWeb: false });
    expect(p.back).toBe("system");
    expect(p.backAtRoot).toBe("background");
    // Not a missing feature: on Android gesture navigation BOTH screen edges
    // belong to the OS. A shell edge-back here is the gesture that swung
    // between "too eager" and "dead" across four releases (§1, Removed).
    expect(p.edgeBackArmed).toBe(false);
  });

  it("gives iOS the shell's own interactive back", () => {
    const p = platformProfile({ os: "ios", isWeb: false });
    expect(p.back).toBe("shell");
    expect(p.edgeBackArmed).toBe(true);
    // iOS has no "background the app" gesture to hand the root back to.
    expect(p.backAtRoot).toBe("none");
  });

  it("gives both native phones haptics and a tone-following status bar", () => {
    for (const os of ["android", "ios"]) {
      const p = platformProfile({ os, isWeb: false });
      expect(p.haptics).toBe(true);
      expect(p.statusBar).toBe(true);
    }
  });

  it("treats web as web whatever the OS underneath says", () => {
    // The PWA, the VR harness and `npm run dev` all run on some OS, and an
    // Android *browser* must not get the native profile: there is no Tauri
    // haptics plugin and no status-bar plugin behind it, so those calls
    // would throw. isWeb wins over os, always.
    const p = platformProfile({ os: "android", isWeb: true });
    expect(p.back).toBe("shell");
    expect(p.haptics).toBe(false);
    expect(p.statusBar).toBe(false);
    expect(p.edgeBackArmed).toBe(true);
  });

  it("falls back to the web profile for an unknown or missing os", () => {
    // Web is the safe default: every capability it claims is one the
    // browser actually has. Guessing "android" for an unknown string would
    // arm plugin calls that are not there.
    expect(platformProfile({ os: null, isWeb: false }).back).toBe("shell");
    expect(platformProfile({}).haptics).toBe(false);
  });

  it("returns a frozen profile so no screen can mutate the seam", () => {
    const p = platformProfile({ os: "ios", isWeb: false });
    expect(Object.isFrozen(p)).toBe(true);
  });

  it("agrees that web and Android both see popstate as back, for unrelated reasons", () => {
    // Web: the browser's own back button fires popstate directly. Android:
    // Tauri's WebView plumbs the system back gesture through as popstate
    // too. Same field value, different plumbing underneath — which is
    // exactly why this is its own axis rather than derived from `back`.
    expect(platformProfile({ os: "android", isWeb: false }).popstateBack).toBe(true);
    expect(platformProfile({ isWeb: true }).popstateBack).toBe(true);
  });

  it("gives iOS no popstate source — its back is shell-drawn gesture only", () => {
    expect(platformProfile({ os: "ios", isWeb: false }).popstateBack).toBe(false);
  });
});

describe("osFromUserAgent", () => {
  it("reads Android out of the WebView Tauri actually ships", () => {
    expect(osFromUserAgent(UA.androidWebView)).toBe("android");
  });

  it("reads Android out of the browser on the same phone", () => {
    // The PWA's UA. This function answers the OS; whether that OS gets the
    // native profile is `isWeb`'s call, one layer up.
    expect(osFromUserAgent(UA.androidChrome)).toBe("android");
  });

  it("reads iOS out of an iPhone and out of an iPad WebView", () => {
    expect(osFromUserAgent(UA.iphone)).toBe("ios");
    expect(osFromUserAgent(UA.ipadWebView)).toBe("ios");
  });

  it("answers nothing for a desktop, which is the whole of its desktop story", () => {
    // Not a vacuous negative: null is what routes a laptop to the WEB
    // profile, and the shell runs on laptops every day (`npm run dev`, the
    // VR harness, a browser narrowed to phone width). An `os` guessed here
    // would arm plugin calls that are not behind a desktop browser.
    expect(osFromUserAgent(UA.linuxFirefox)).toBeNull();
    expect(osFromUserAgent(UA.macSafari)).toBeNull();
  });

  it("cannot tell desktop-class iPad Safari from a Mac, and says so by answering null", () => {
    // THE TRAP, pinned rather than left to be rediscovered. Safari on
    // iPadOS defaults to desktop-class browsing and sends a Macintosh UA —
    // the two strings in this assertion are identical, which is why no
    // reader of the UA alone can separate them (`navigator.maxTouchPoints`
    // can, and is not a UA fact).
    //
    // Null is the RIGHT answer here rather than a tolerated wrong one, and
    // the reason is one layer up: a desktop-class UA belongs to a browser,
    // a browser is `isWeb`, and `isWeb` beats `os` — so an iPad running the
    // PWA gets the web profile whichever way this answers. The test below
    // ("keeps an iPad browser on the web profile...") is the one that holds
    // that half in place; if it ever goes red this null becomes a real bug.
    expect(UA.ipadSafari).toBe(UA.macSafari);
    expect(osFromUserAgent(UA.ipadSafari)).toBeNull();
  });

  it("answers null rather than throwing when there is no user agent to read", () => {
    // Server-side rendering and any test that builds a window by hand. The
    // fallback is the WEB profile, which is the safe one.
    expect(osFromUserAgent(undefined)).toBeNull();
    expect(osFromUserAgent(null)).toBeNull();
    expect(osFromUserAgent("")).toBeNull();
  });
});

describe("currentPlatformProfile", () => {
  it("disarms the shell's edge back inside the Android app", () => {
    // The live defect this reader exists for: until it landed, the shell
    // drew its own edge back on Android beside the system's, which is the
    // competing-owner gesture §1 removed.
    const p = currentPlatformProfile(fakeWindow({ ua: UA.androidWebView, tauri: true }));
    expect(p.edgeBackArmed).toBe(false);
    expect(p.back).toBe("system");
    expect(p.backAtRoot).toBe("background");
  });

  it("gives the iOS app the shell's own interactive back", () => {
    const p = currentPlatformProfile(fakeWindow({ ua: UA.iphone, tauri: true }));
    expect(p.edgeBackArmed).toBe(true);
    expect(p.popstateBack).toBe(false);
  });

  it("keeps an Android browser on the web profile — no Tauri, no plugins", () => {
    // The PWA on the same phone as the first test. Same `os`, opposite
    // profile, and the difference is Tauri's absence: there is no haptics
    // plugin and no status-bar plugin behind a browser to call.
    const p = currentPlatformProfile(fakeWindow({ ua: UA.androidWebView, tauri: false }));
    expect(p.edgeBackArmed).toBe(true);
    expect(p.haptics).toBe(false);
    expect(p.statusBar).toBe(false);
  });

  it("keeps an iPad browser on the web profile whatever its user agent claims", () => {
    // The other half of the iPadOS trap above. Desktop-class Safari reads
    // as no OS at all, and it does not matter: no Tauri means web, and web
    // is the profile an iPad browser should have.
    const p = currentPlatformProfile(fakeWindow({ ua: UA.ipadSafari, tauri: false }));
    expect(p.back).toBe("shell");
    expect(p.edgeBackArmed).toBe(true);
  });

  it("falls back to the web profile with no window at all", () => {
    expect(currentPlatformProfile(null).back).toBe("shell");
    expect(currentPlatformProfile(undefined).back).toBe("shell");
  });

  it("reads the real window when nothing is passed", () => {
    // The production call takes no argument. jsdom is a browser with no
    // Tauri on it, so the answer here is the web profile — and that is also
    // why every existing shell test keeps the behaviour it had before this
    // wire: the suite runs on the same profile the shell already defaulted to.
    expect(currentPlatformProfile().back).toBe("shell");
    expect(currentPlatformProfile().edgeBackArmed).toBe(true);
  });
});
