// Pixel-diff two PNGs. Pure + synchronous so it is unit-testable and easy to
// call from the wdio spec. Writes a diff image when pixels differ (and diffPath
// is provided). Tolerance mirrors Tier-1's maxDiffPixelRatio default.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export function comparePng(actualPath, baselinePath, diffPath, opts = {}) {
  const maxDiffPixelRatio = opts.maxDiffPixelRatio ?? 0.01;
  if (!existsSync(baselinePath)) {
    return { match: false, diffPixels: 0, totalPixels: 0, ratio: 1, reason: "missing-baseline" };
  }
  const actual = PNG.sync.read(readFileSync(actualPath));
  const baseline = PNG.sync.read(readFileSync(baselinePath));
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    return { match: false, diffPixels: 0, totalPixels: 0, ratio: 1, reason: "size-mismatch" };
  }
  const { width, height } = actual;
  const totalPixels = width * height;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    actual.data, baseline.data, diff.data, width, height, { threshold: 0.1 }
  );
  const ratio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const match = ratio <= maxDiffPixelRatio;
  if (!match && diffPath) writeFileSync(diffPath, PNG.sync.write(diff));
  return { match, diffPixels, totalPixels, ratio };
}
