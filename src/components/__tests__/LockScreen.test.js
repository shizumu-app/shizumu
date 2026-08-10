// First feature-component test — establishes the src/components/__tests__/
// layer (Spec G step 2). Reuses the Svelte 5 mount() harness from
// src/lib/ui/test-helper.js; no @testing-library in the repo.
//
// LockScreen has no $lib/api dependency: in a non-Tauri environment
// (jsdom sets no window.__TAURI_INTERNALS__) the unlock path skips the
// `invoke("unlock")` call and treats any non-blank passphrase as valid,
// firing onUnlock. Components that DO call $lib/api should mock it
// per-test with vi.mock("../../lib/api.js", ...) — see
// src/lib/__tests__/api.test.js for the invoke-mock pattern.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import LockScreen from "../LockScreen.svelte";

afterEach(cleanupAll);

function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(input) {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

describe("LockScreen", () => {
  it("renders the passphrase input", () => {
    const { target } = render(LockScreen, { onUnlock: vi.fn() });
    const input = target.querySelector("input[type=password]");
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe("passphrase");
  });

  it("unlocks on Enter with a non-blank passphrase", async () => {
    const onUnlock = vi.fn();
    const { target } = render(LockScreen, { onUnlock });
    const input = target.querySelector("input[type=password]");

    type(input, "open sesame");
    await tick();
    pressEnter(input);
    await tick();

    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it("does not unlock on a blank passphrase", async () => {
    const onUnlock = vi.fn();
    const { target } = render(LockScreen, { onUnlock });
    const input = target.querySelector("input[type=password]");

    type(input, "   "); // whitespace only — trimmed to empty
    await tick();
    pressEnter(input);
    await tick();

    expect(onUnlock).not.toHaveBeenCalled();
  });
});
