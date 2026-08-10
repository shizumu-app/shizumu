import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { comparePng } from "./diff.mjs";

function writePng(file, w, h, fill) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = fill[0]; png.data[i + 1] = fill[1];
    png.data[i + 2] = fill[2]; png.data[i + 3] = 255;
  }
  writeFileSync(file, PNG.sync.write(png));
}

test("identical images match", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vrdiff-"));
  const a = path.join(dir, "a.png"); const b = path.join(dir, "b.png");
  writePng(a, 10, 10, [10, 20, 30]); writePng(b, 10, 10, [10, 20, 30]);
  const r = comparePng(a, b, null);
  assert.equal(r.match, true);
  assert.equal(r.diffPixels, 0);
});

test("different images do not match and report ratio", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vrdiff-"));
  const a = path.join(dir, "a.png"); const b = path.join(dir, "b.png");
  const diffPath = path.join(dir, "d.png");
  writePng(a, 10, 10, [0, 0, 0]); writePng(b, 10, 10, [255, 255, 255]);
  const r = comparePng(a, b, diffPath, { maxDiffPixelRatio: 0.01 });
  assert.equal(r.match, false);
  assert.equal(r.totalPixels, 100);
  assert.ok(r.ratio > 0.5);
  assert.ok(existsSync(diffPath));
  assert.ok(r.diffPixels > 0);
});

test("missing baseline reports reason", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vrdiff-"));
  const a = path.join(dir, "a.png");
  writePng(a, 4, 4, [1, 2, 3]);
  const r = comparePng(a, path.join(dir, "nope.png"), null);
  assert.equal(r.match, false);
  assert.equal(r.reason, "missing-baseline");
});

test("size mismatch reports reason", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vrdiff-"));
  const a = path.join(dir, "a.png"); const b = path.join(dir, "b.png");
  writePng(a, 10, 10, [5, 5, 5]); writePng(b, 10, 20, [5, 5, 5]);
  const r = comparePng(a, b, null);
  assert.equal(r.match, false);
  assert.equal(r.reason, "size-mismatch");
});
