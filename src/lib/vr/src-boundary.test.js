// The public GitHub mirror is assembled by COPYING allowlisted paths
// (.public-allowlist), not by deleting denied ones. `src/` is allowlisted;
// `marketing/`, `website/` and `docs/` are forbidden outright by the publish
// gate in .gitlab-ci.yml.
//
// So a file under src/ that imports something outside src/ builds fine here and
// fails on the mirror, where the importer arrives without the file. Not
// hypothetical: v0.7.6's flathub build died on
//
//   Could not resolve "../../../marketing/launch/screenshots/2026-08-26/
//   _capture/assets/evidence-empty-table.png?inline"
//   from "src/lib/vr/blobs-marketing.js"
//
// The desktop installers were unaffected — GitLab builds the whole repo — so
// nothing caught it until flathub, the one consumer that builds the stripped
// tree.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const SRC = resolve(import.meta.dirname, "../..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|svelte|ts)$/.test(name)) out.push(p);
  }
  return out;
}

describe("src/ is self-contained for the public mirror", () => {
  it("no file under src/ imports a path that escapes src/", () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
        const target = resolve(dirname(file), m[1].split("?")[0]);
        if (!target.startsWith(SRC + "/")) offenders.push(`${relative(SRC, file)} -> ${m[1]}`);
      }
    }
    // Not a vacuous "nothing happened" assertion: a non-empty list names the
    // exact import that would break the flathub build, so the failure message
    // is the fix.
    expect(offenders).toEqual([]);
  });
});
