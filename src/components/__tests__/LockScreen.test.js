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
//
// The Tauri branch is covered separately below by faking
// window.__TAURI_INTERNALS__ and mocking @tauri-apps/api/core, so the
// passphrase answer itself can be driven. It shipped untested, and the
// bug that hid there was real: the boolean `unlock` returns was discarded
// and onUnlock fired for any passphrase.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import LockScreen from "../LockScreen.svelte";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(cleanupAll);

// handleSubmit awaits a dynamic import and the invoke promise before it
// settles, so a single tick() is not enough to see the outcome.
async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

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

describe("LockScreen under Tauri", () => {
  beforeEach(() => {
    // isTauri is read at component init, so this must be set before render().
    window.__TAURI_INTERNALS__ = {};
    invoke.mockReset();
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  async function submit(onUnlock, value = "open sesame") {
    const { target } = render(LockScreen, { onUnlock });
    const input = target.querySelector("input[type=password]");
    type(input, value);
    await tick();
    pressEnter(input);
    await settle();
    return input;
  }

  it("refuses when unlock answers false", async () => {
    invoke.mockResolvedValue(false);
    const onUnlock = vi.fn();

    const input = await submit(onUnlock);

    expect(invoke).toHaveBeenCalledWith("unlock", { passphrase: "open sesame" });
    // false is the backend saying "wrong passphrase" — it is not an error,
    // so the app must stay locked rather than fall through to onUnlock.
    expect(onUnlock).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(input.classList.contains("shake")).toBe(true);
  });

  it("unlocks when unlock answers true", async () => {
    invoke.mockResolvedValue(true);
    const onUnlock = vi.fn();

    const input = await submit(onUnlock);

    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(input.classList.contains("shake")).toBe(false);
  });

  it("refuses when unlock throws", async () => {
    invoke.mockRejectedValue(new Error("db is locked"));
    const onUnlock = vi.fn();

    const input = await submit(onUnlock);

    expect(onUnlock).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(input.classList.contains("shake")).toBe(true);
  });

  it("treats a null answer as unlocked, not refused", async () => {
    // The browser mock answers null for commands it does not implement.
    // Only an explicit false is a refusal; a bare falsy check here would
    // lock web dev out of its own app.
    invoke.mockResolvedValue(null);
    const onUnlock = vi.fn();

    await submit(onUnlock);

    expect(onUnlock).toHaveBeenCalledTimes(1);
  });
});
