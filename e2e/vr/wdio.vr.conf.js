// WebdriverIO config for Tier-2 Linux real-pixel VR capture. Mirrors the
// golden-path wdio.conf.js (tauri-driver + sandboxed XDG_DATA_HOME) but points
// at the VR capture spec. Run headless under xvfb.
//
// The debug Tauri binary loads its frontend from devUrl (http://localhost:1420)
// at runtime — it does NOT serve the embedded dist. So this config serves the
// VITE_VR=1 production build (`npm run build`) on that same port via `vite
// preview` before the driver launches. The webview then loads our harness from
// :1420, bootstrapVR runs (gate passes via VITE_VR baked into the build), seeds
// the requested scene, and sets window.__VR_READY__. Preview (not the dev
// server) gives production-shaped, deterministic rendering matching Tier-1.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_BINARY =
  process.env.TAURI_APP_BINARY ||
  path.resolve(__dirname, "../../src-tauri/target/debug/shizumu");
const E2E_DATA_HOME = mkdtempSync(path.join(tmpdir(), "shizumu-vr-"));

let tauriDriver, preview;

// Poll until the preview server answers, so the app's initial load of :1420
// succeeds. Date.now()/setTimeout are fine here — the determinism freeze only
// applies to the app under test, not this harness runner.
async function waitForPort(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 200) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`preview server not up at ${url}`);
}

export const config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./capture.e2e.js"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: APP_BINARY,
        env: { XDG_DATA_HOME: E2E_DATA_HOME },
      },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  // The WebKitWebDriver `GET /screenshot` command is slow and high-variance
  // on wry under xvfb (tens of seconds to several minutes per frame). Give
  // each WebDriver command a long ceiling so saveScreenshot can complete, and
  // a mocha per-test timeout above it.
  connectionRetryTimeout: 420000,
  mochaOpts: { ui: "bdd", timeout: 480000 },
  logLevel: "warn",
  async onPrepare() {
    // --host binds all interfaces (incl. IPv4 127.0.0.1). Without it vite
    // preview binds [::1] only; the Tauri webview resolves devUrl's
    // "localhost" to 127.0.0.1 (first /etc/hosts entry) and the IPv6-only
    // socket refuses it, leaving the webview on about:blank.
    // detached:true puts vite in its own process group so onComplete can kill
    // the WHOLE group. `npm run preview` execs vite as a grandchild and does not
    // reliably forward SIGTERM, so a plain preview.kill() leaves vite holding
    // port 1420 (EADDRINUSE on the next run / the golden-path e2e suite).
    preview = spawn("npm", ["run", "preview", "--", "--port", "1420", "--strictPort", "--host"], {
      cwd: REPO_ROOT,
      env: { ...process.env, VITE_VR: "1" },
      stdio: [null, process.stdout, process.stderr],
      detached: true,
    });
    try {
      await waitForPort("http://127.0.0.1:1420", 60000);
    } catch (err) {
      // WDIO does not reliably run onComplete when onPrepare rejects, so tear
      // down the detached preview group here or it leaks port 1420.
      if (preview?.pid) { try { process.kill(-preview.pid, "SIGTERM"); } catch {} }
      throw err;
    }
    tauriDriver = spawn("tauri-driver", [], {
      stdio: [null, process.stdout, process.stderr],
    });
  },
  onComplete() {
    if (tauriDriver) tauriDriver.kill();
    // Negative pid signals the process group (see detached:true above).
    if (preview?.pid) { try { process.kill(-preview.pid, "SIGTERM"); } catch {} }
    try { rmSync(E2E_DATA_HOME, { recursive: true, force: true }); } catch {}
  },
};

if (spawnSync("tauri-driver", ["--help"]).error) {
  // eslint-disable-next-line no-console
  console.warn("[vr] tauri-driver not found — `cargo install tauri-driver` and install WebKitWebDriver.");
}
