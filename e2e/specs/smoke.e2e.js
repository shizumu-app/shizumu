// Boot smoke test — proves the whole harness end to end: tauri-driver
// launches the app, the webview loads, and a known root renders. This is
// the verifiable backbone of the e2e job; the golden paths below build on
// it once their selectors are confirmed against a real run.
import { browser, $ } from "@wdio/globals";

describe("app boots", () => {
  it("renders a known top-level surface", async () => {
    // First launch may show onboarding, the encryption setup screen, the
    // lock screen, or (seeded) the page shell. Accept any known root so the
    // smoke test asserts "the webview loaded and Svelte mounted" without
    // coupling to first-run state.
    const roots = [".app-shell", ".setup-screen", ".lock-screen", ".onboarding"];
    await browser.waitUntil(
      async () => {
        for (const sel of roots) {
          if (await $(sel).isExisting()) return true;
        }
        return false;
      },
      { timeout: 20000, timeoutMsg: `no known root (${roots.join(", ")}) rendered` }
    );
    expect(true).toBe(true);
  });
});
