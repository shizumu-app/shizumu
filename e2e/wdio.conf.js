// WebdriverIO config for the Tauri boot smoke test.
//
// Stack: WebdriverIO drives the app through `tauri-driver`, which proxies
// WebDriver commands to the platform webview driver. Playwright is NOT used
// — it cannot drive Tauri's native webview; tauri-driver + WebdriverIO is the
// documented Tauri 2 path (https://v2.tauri.app/develop/tests/webdriver/).
//
//   Linux   → WebKitGTK, driven by `WebKitWebDriver`
//             (Fedora: webkitgtk6.0; Debian/Ubuntu: webkit2gtk-driver)
//   Windows → WebView2, driven by `msedgedriver`
//
// Prerequisites (see README.md):
//   - the platform webdriver on PATH
//   - `cargo install tauri-driver`
//   - a built debug app binary (TAURI_APP_BINARY or the default below)
//   - Linux only: a display — run headless under `xvfb-run -a npm test`
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_WINDOWS = process.platform === "win32";

// The compiled app the driver launches. CI builds the debug binary; locally
// override with TAURI_APP_BINARY=/abs/path if you built release.
const APP_BINARY =
  process.env.TAURI_APP_BINARY ||
  path.resolve(
    __dirname,
    `../src-tauri/target/debug/shizumu${IS_WINDOWS ? ".exe" : ""}`,
  );

// Sandbox the app's data dir for the duration of the run so tests can't touch
// the user's real writing. Tauri resolves its data dir per-platform, so the
// redirect has to be per-platform too: $XDG_DATA_HOME on Linux, %APPDATA% /
// %LOCALAPPDATA% on Windows. Either way each `npm test` is a clean slate.
const E2E_DATA_HOME = mkdtempSync(path.join(tmpdir(), "shizumu-e2e-"));
const SANDBOX_ENV = IS_WINDOWS
  ? { APPDATA: E2E_DATA_HOME, LOCALAPPDATA: E2E_DATA_HOME }
  : { XDG_DATA_HOME: E2E_DATA_HOME };

// tauri-driver finds the platform webdriver on PATH by default. Override with
// TAURI_NATIVE_DRIVER=/abs/path when it isn't there (common on Windows, where
// msedgedriver ships wherever the installer put it).
const NATIVE_DRIVER = process.env.TAURI_NATIVE_DRIVER;
const DRIVER_ARGS = NATIVE_DRIVER ? ["--native-driver", NATIVE_DRIVER] : [];

let tauriDriver;

export const config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.e2e.js"],
  maxInstances: 1,
  capabilities: [
    {
      // No browserName: Tauri uses the native webview, not a browser
      // engine. tauri-driver reads tauri:options, launches the app, and
      // proxies to the platform driver. Setting a browserName makes
      // WebKitWebDriver reject with "Failed to match capabilities".
      // (per the Tauri 2 WebdriverIO docs)
      maxInstances: 1,
      "tauri:options": {
        application: APP_BINARY,
        env: SANDBOX_ENV,
      },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60000 },
  logLevel: "info",

  // Start tauri-driver before the session and tear it down after. It
  // listens on :4444 and spawns the native driver on :4445 itself.
  onPrepare() {
    tauriDriver = spawn("tauri-driver", DRIVER_ARGS, {
      stdio: [null, process.stdout, process.stderr],
      shell: IS_WINDOWS,
    });
  },
  onComplete() {
    if (tauriDriver) tauriDriver.kill();
    try { rmSync(E2E_DATA_HOME, { recursive: true, force: true }); } catch {}
  },
};

// Fail fast with a clear message if the driver binary is missing, rather
// than a cryptic ECONNREFUSED when WebdriverIO tries to reach :4444.
if (spawnSync("tauri-driver", ["--help"], { shell: IS_WINDOWS }).error) {
  const nativeDriver = IS_WINDOWS
    ? "msedgedriver is installed and on PATH (or set TAURI_NATIVE_DRIVER)"
    : "WebKitWebDriver is installed (webkitgtk6.0 / webkit2gtk-driver)";
  // eslint-disable-next-line no-console
  console.warn(
    `[e2e] tauri-driver not found — run \`cargo install tauri-driver\` and ensure ${nativeDriver}.`,
  );
}
