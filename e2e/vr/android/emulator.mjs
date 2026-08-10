// adb/emulator orchestration for Tier-2 Android capture. Pure parsers are
// unit-tested; the process wrappers are exercised by the capture orchestrator
// against a live emulator.
import { execFileSync } from "node:child_process";
import { parseWebviewSocket } from "./cdp.mjs";

export function isBootComplete(getpropOutput) {
  return getpropOutput.trim() === "1";
}

export function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

export function adb(args) {
  return sh("adb", args);
}

export function hasOnlineEmulator(adbDevicesOutput) {
  return /\bemulator-\d+\s+device\b/.test(adbDevicesOutput);
}

export async function waitForBoot(timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  // Poll `adb devices` for an ONLINE emulator, then the boot flag. More robust
  // than `adb wait-for-device`, which errors "closed" during early boot.
  for (;;) {
    let booted = false;
    try {
      if (hasOnlineEmulator(adb(["devices"]))) {
        booted = isBootComplete(adb(["shell", "getprop", "sys.boot_completed"]));
      }
    } catch {}
    if (booted) return;
    if (Date.now() > deadline) throw new Error("emulator boot timed out");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export function forwardWebviewCdp(cdpPort) {
  const unix = adb(["shell", "cat", "/proc/net/unix"]);
  const socket = parseWebviewSocket(unix);
  if (!socket) throw new Error("no webview_devtools_remote socket — is the app launched and a debug build?");
  adb(["forward", `tcp:${cdpPort}`, `localabstract:${socket}`]);
}
