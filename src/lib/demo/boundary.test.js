import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const SRC = resolve(import.meta.dirname, "../..");
const ALLOWED = new Set(["main.js"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|svelte)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the demo is reachable from exactly one place", () => {
  it("is imported only by main.js, so it stays out of the app bundle", () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel.startsWith("lib/demo/")) continue;
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      // "demo/", not "lib/demo/": a file already inside src/lib (api.js,
      // chiefly - the exact path this test exists to guard) reaches the
      // demo directory as "./demo/..." with no "lib/" segment at all, and
      // a literal "lib/demo/" match misses that case entirely.
      if (/from\s+["'][^"']*demo\/[^"']*["']/.test(text) || /import\(\s*["'][^"']*demo\/[^"']*["']\s*\)/.test(text)) {
        offenders.push(rel);
      }
    }
    // Anything reachable from api.js or a component is in the Tauri bundle,
    // which is how demo copy would reach the shipped app.
    expect(offenders).toEqual([]);
  });
});
