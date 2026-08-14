import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// keyboard-state.js is the ONLY visualViewport subscriber. A component
// adding its own listener re-creates the desync class this module
// exists to kill (hidden field / latched bar), so the rule is enforced
// by test, not convention.
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|svelte)$/.test(f)) out.push(p);
  }
  return out;
}

describe("single visualViewport owner", () => {
  it("no file but keyboard-state.js touches visualViewport", () => {
    const offenders = walk("src")
      .filter((p) => !p.endsWith("lib/keyboard-state.js"))
      .filter((p) => !p.includes("__tests__"))
      .filter((p) => readFileSync(p, "utf8").includes("visualViewport"));
    expect(offenders).toEqual([]);
  });
});
