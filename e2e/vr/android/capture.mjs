// Tier-2 Android real-pixel orchestrator: boot a headless AVD, install+launch
// the VR debug APK, forward the WebView CDP socket, then drive each scene over
// CDP and diff against baselines. Not a wdio spec — a plain node runner.
import { mkdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { SCENE_CASES, OUT_DIR, BASELINE_DIR } from "../scenes.mjs";
import { comparePng } from "../diff.mjs";
import { captureScene, parseWebviewSocket } from "./cdp.mjs";
import { adb, waitForBoot, forwardWebviewCdp } from "./emulator.mjs";

const UPDATE = process.env.VR_UPDATE === "1";
const AVD = process.env.VR_AVD || "Pixel_API_36";
const CDP_PORT = Number(process.env.VR_CDP_PORT || 9222);
const APK = process.env.VR_APK;
const APP_ID = "app.shizumu.Shizumu";
const ANDROID_OUT = path.join(OUT_DIR, "android");
const ANDROID_BASELINE = path.join(BASELINE_DIR, "..", "android");

function emulatorBin() {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  return home ? path.join(home, "emulator", "emulator") : "emulator";
}

async function main() {
  if (!APK || !existsSync(APK)) throw new Error(`set VR_APK to the debug APK path (got: ${APK})`);
  rmSync(ANDROID_OUT, { recursive: true, force: true });
  mkdirSync(ANDROID_OUT, { recursive: true });
  if (UPDATE) mkdirSync(ANDROID_BASELINE, { recursive: true });

  // Boot a headless, software-GPU emulator (deterministic, host-independent).
  const emu = spawn(
    emulatorBin(),
    ["-avd", AVD, "-no-window", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect", "-no-snapshot", "-no-metrics"],
    { stdio: ["ignore", "ignore", "ignore"], detached: true }
  );
  emu.on("error", (e) => console.error("emulator spawn error:", e.message));
  let failures = [];
  try {
    await waitForBoot(Number(process.env.VR_BOOT_TIMEOUT_MS || 420000));
    // Freeze system animations for stability.
    for (const k of ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]) {
      try { adb(["shell", "settings", "put", "global", k, "0"]); } catch {}
    }
    adb(["install", "-r", "-g", APK]);
    adb(["shell", "monkey", "-p", APP_ID, "-c", "android.intent.category.LAUNCHER", "1"]);
    // Wait for the WebView socket to appear, then forward CDP.
    await waitForWebview();
    forwardWebviewCdp(CDP_PORT);

    const origin = "http://tauri.localhost"; // Tauri v2 Android asset origin
    for (const c of SCENE_CASES) {
      const outPng = path.join(ANDROID_OUT, `${c.name}.png`);
      await captureScene(CDP_PORT, {
        url: `${origin}/?vr=1&scene=${c.id}&theme=${c.theme}`,
        outPath: outPng,
      });
      const baseline = path.join(ANDROID_BASELINE, `${c.name}.png`);
      if (UPDATE) { copyFileSync(outPng, baseline); continue; }
      const r = comparePng(outPng, baseline, path.join(ANDROID_OUT, `${c.name}.diff.png`), {
        maxDiffPixelRatio: 0.01,
      });
      if (!r.match) failures.push(`${c.name}: ${r.reason || `ratio ${r.ratio.toFixed(4)}`}`);
    }
  } finally {
    try { adb(["forward", "--remove", `tcp:${CDP_PORT}`]); } catch {}
    try { adb(["emu", "kill"]); } catch {}
    if (emu.pid) { try { process.kill(-emu.pid, "SIGTERM"); } catch {} }
  }
  if (!UPDATE && failures.length) {
    console.error(`VR Android mismatches:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(UPDATE ? `wrote ${SCENE_CASES.length} android baselines` : `all ${SCENE_CASES.length} scenes match`);
}

async function waitForWebview(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const unix = adb(["shell", "cat", "/proc/net/unix"]);
    if (parseWebviewSocket(unix)) return; // reuse the one socket-detection source
    if (Date.now() > deadline) throw new Error("WebView devtools socket never appeared");
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
