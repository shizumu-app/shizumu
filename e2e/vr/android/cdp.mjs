// CDP capture over the Android System WebView's remote-debugging socket
// (exposed via `adb forward` — see emulator.mjs). Page.captureScreenshot
// grabs the WebView content only (no Android status bar), so captures are
// deterministic. parseWebviewSocket is pure and unit-tested; captureScene
// needs a live forwarded CDP endpoint.
import { writeFileSync } from "node:fs";
import CDP from "chrome-remote-interface";

export function parseWebviewSocket(procNetUnix) {
  const names = [];
  for (const line of procNetUnix.split("\n")) {
    const m = line.match(/@(webview_devtools_remote_\d+)\s*$/);
    if (m) names.push(m[1]);
  }
  return names.length ? names[names.length - 1] : null;
}

export async function captureScene(cdpPort, { url, outPath, readyTimeoutMs = 30000 }) {
  const client = await CDP({ port: cdpPort });
  try {
    const { Page, Runtime } = client;
    await Page.enable();
    // Wait for the NEW document to actually load before polling. Page.navigate
    // resolves on initiation, not commit — polling immediately would run against
    // the PREVIOUS scene's document, which still has __VR_READY__ === true (the
    // app sets it once and never resets), yielding a wrong/mid-nav capture.
    // Arm the load listener before navigating so a fast load isn't missed.
    const loaded = Page.loadEventFired();
    await Page.navigate({ url });
    await loaded;
    // Poll __VR_READY__ via Runtime.evaluate — no fixed sleep.
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      const { result } = await Runtime.evaluate({
        expression: "window.__VR_READY__ === true",
        returnByValue: true,
      });
      if (result.value === true) break;
      if (Date.now() > deadline) throw new Error(`__VR_READY__ never set for ${url}`);
      await new Promise((r) => setTimeout(r, 250));
    }
    const { data } = await Page.captureScreenshot({ format: "png" });
    writeFileSync(outPath, Buffer.from(data, "base64"));
  } finally {
    await client.close();
  }
}
