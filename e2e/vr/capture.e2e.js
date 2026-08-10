import { mkdirSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { SCENE_CASES, OUT_DIR, BASELINE_DIR } from "./scenes.mjs";
import { comparePng } from "./diff.mjs";

const ACTUAL_DIR = path.join(OUT_DIR, "actual");
const DIFF_DIR = path.join(OUT_DIR, "diff");
const UPDATE = process.env.VR_UPDATE === "1";

describe("VR Tier-2 Linux real-pixel", () => {
  let origin;

  before(async () => {
    rmSync(ACTUAL_DIR, { recursive: true, force: true });
    rmSync(DIFF_DIR, { recursive: true, force: true });
    mkdirSync(ACTUAL_DIR, { recursive: true });
    mkdirSync(DIFF_DIR, { recursive: true });
    if (UPDATE) mkdirSync(BASELINE_DIR, { recursive: true });
    await browser.setWindowSize(1280, 800);
    origin = new URL(await browser.getUrl()).origin;
  });

  for (const c of SCENE_CASES) {
    it(`${UPDATE ? "updates" : "matches"} ${c.name}`, async () => {
      await browser.url(`${origin}/?vr=1&scene=${c.id}&theme=${c.theme}`);
      await browser.waitUntil(
        async () => (await browser.execute(() => window.__VR_READY__ === true)) === true,
        { timeout: 30000, timeoutMsg: `__VR_READY__ never set for ${c.name}` }
      );
      const actual = path.join(ACTUAL_DIR, `${c.name}.png`);
      await browser.saveScreenshot(actual);

      const baseline = path.join(BASELINE_DIR, `${c.name}.png`);
      if (UPDATE) {
        copyFileSync(actual, baseline);
        return;
      }
      const diffFile = path.join(DIFF_DIR, `${c.name}.png`);
      const r = comparePng(actual, baseline, diffFile, { maxDiffPixelRatio: 0.01 });
      if (!r.match) {
        const hint =
          r.reason === "missing-baseline"
            ? " — run with VR_UPDATE=1 to create it"
            : r.reason === "size-mismatch"
              ? "" // comparePng writes no diff image for a size mismatch
              : ` — see ${diffFile}`;
        throw new Error(
          `VR mismatch ${c.name}: ${r.reason || `${r.diffPixels}/${r.totalPixels} px (ratio ${r.ratio.toFixed(4)})`}${hint}`
        );
      }
    });
  }
});
