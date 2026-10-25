import { defineConfig, devices } from "@playwright/test";

// Tier-1 visual-regression: engine proxies for the in-scope targets.
//  - chromium (desktop)  -> Windows WebView2 engine proxy
//  - chromium (Pixel 7)  -> Android System WebView engine proxy
//  - webkit   (desktop)  -> Linux WebKitGTK family proxy
// Baselines live in tests/vr/baselines and are committed to the repo.
export default defineConfig({
  testDir: "tests/vr",
  snapshotPathTemplate: "tests/vr/baselines/{projectName}/{arg}{ext}",
  forbidOnly: !!process.env.CI,
  // Keep both the report and per-test artifacts under playwright-report/ (and
  // OUT of the default test-results/): the HTML report folder must not nest
  // inside outputDir or Playwright errors with a folder-clash config error.
  outputDir: "playwright-report/artifacts",
  reporter: [["html", { outputFolder: "playwright-report/vr", open: "never" }]],
  expect: {
    // 0.2%: the previous 1% gate let a real 0.29% layout regression through
    // (BrandSlide mockup collapse, caught only by a manual capture pass).
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
      // Generating a NEW baseline loops screenshot→compare until two frames
      // match; the default 5s is sized for comparing against an existing
      // one. A fullPage shot of the shell gallery on WebKit at
      // deviceScaleFactor 3 exceeds it, and which shot runs out first is
      // random — the symptom was one missing baseline per run, filename
      // changing each time. Comparisons against an existing baseline do not
      // pay this cost.
      timeout: 30000,
    },
  },
  webServer: {
    command: "VITE_VR=1 npm run build && VITE_VR=1 npm run preview -- --port 4321",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  use: {
    baseURL: "http://localhost:4321",
    timezoneId: "UTC",
    // The app zeroes every --motion-* under prefers-reduced-motion
    // (global.css), so asking for it here means a screenshot can never catch
    // a transition mid-flight. Playwright's animations:"disabled" covers CSS
    // animations and the Web Animations API, but not a CSS transition driven
    // by a state change — which is what Sheet's `transition: height` is.
    reducedMotion: "reduce",
  },
  projects: [
    { name: "win-webview2", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "android-webview", use: { ...devices["Pixel 7"] } },
    // A phone on its side. Landscape makes a handset ~890px WIDE, which
    // cleared both the 480px phone breakpoint and the 768px tablet one and
    // silently handed the user the desktop layout — the action bar
    // unmounted, gestures switched off. The breakpoints now key on the
    // short side too (src/lib/responsive.js), and this project is what
    // keeps them honest.
    { name: "android-landscape", use: { ...devices["Pixel 7 landscape"] } },
    // linux-webkitgtk: BLOCKED on bare Fedora 42 (ICU 76 vs webkit's ICU 74 versioned symbols).
    // Runs in the pinned Ubuntu Docker image via `npm run test:vr:docker`.
    { name: "linux-webkitgtk", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } } },
    // ios-webkit: WebKit at an iPhone viewport, standing in for WKWebView
    // until an iOS target exists (there is no src-tauri/gen/ios yet). It
    // photographs the shell only: there is no desktop tree to check here,
    // and the two §5 flags that genuinely need a device — the keyboard
    // fixture and Stack's interactive back — cannot be settled by this
    // project either way. WebKit is already in the pinned image, so this
    // costs no new toolchain.
    { name: "ios-webkit", use: { ...devices["iPhone 14"] } },
  ],
});
