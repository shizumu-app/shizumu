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

  it("no file but keyboard-state.js touches the native keyboard signal", () => {
    // Same rule, same reason, new door. The Android activity publishes IME
    // visibility into `window.__nativeKeyboard`, and that is a second source
    // of keyboard truth — so it gets the same single-owner treatment the
    // visual viewport has, before a component starts reading it directly
    // and the two disagree.
    //
    // The scan is dumb on purpose, exactly like the one above: the rule is
    // "one reader, ever", and a cleverer matcher would let a second one
    // through spelled slightly differently.
    const offenders = walk("src")
      .filter((p) => !p.endsWith("lib/keyboard-state.js"))
      .filter((p) => !p.includes("__tests__"))
      .filter((p) => readFileSync(p, "utf8").includes("__nativeKeyboard"));
    expect(offenders).toEqual([]);
  });
});

// ── and one owner per path ────────────────────────────────────────────────
//
// The rule above stops a component adding its own visualViewport listener.
// It did not stop two components each starting keyboard-state's own
// subscription, which is how the shell ended up with two baselines and a
// bottom bar that followed listener order rather than the keyboard
// (2026-10-04, Galaxy A34). keyboard-state.js now shares one subscription
// between callers, so this is about intent rather than breakage: the two
// paths each have exactly one owner, and App.svelte's call stands down on
// the shell path.
describe("one keyboard-state owner per path", () => {
  const callers = () =>
    walk("src")
      .filter((p) => !p.endsWith("lib/keyboard-state.js"))
      .filter((p) => !p.endsWith("lib/viewport-height.js"))
      .filter((p) => !p.includes("__tests__"))
      // `startKeyboardState` without parentheses too: ShellRoot takes it as
      // an injectable prop default (`startViewport = startKeyboardState`)
      // so its test can hand in a spy, and a caller that owns the
      // subscription by that route owns it just the same.
      .filter((p) =>
        /\bstartKeyboardState\b/.test(readFileSync(p, "utf8")) ||
        /\bsyncAppHeight\s*\(/.test(readFileSync(p, "utf8")));

  it("is started from App.svelte and ShellRoot.svelte, and nowhere else", () => {
    expect(callers().map((p) => p.replace(/\\/g, "/")).sort()).toEqual([
      "src/App.svelte",
      "src/shell/ShellRoot.svelte",
    ]);
  });

  it("App.svelte stands down when the shell boots", () => {
    const app = readFileSync("src/App.svelte", "utf8");
    const call = app.indexOf("syncAppHeight()");
    expect(call).toBeGreaterThan(-1);
    // The guard sits in the same effect, just above the call.
    expect(app.slice(Math.max(0, call - 400), call)).toMatch(/if\s*\(bootShell\)\s*return;/);
  });
});
