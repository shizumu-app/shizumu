// Covers INV-SEC-3 at the component level: encryption setup cannot
// complete without a valid passphrase (>= 8 chars AND matching confirm).
// In a non-Tauri env handleSubmit skips invoke("setup_encryption") and
// calls onComplete only when the validation gate passes. Keydown is on
// svelte:window, so Enter/Escape are dispatched on window.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import SetupEncryption from "../SetupEncryption.svelte";

afterEach(cleanupAll);

function fill(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function fields(target) {
  const [pass, confirm] = target.querySelectorAll("input[type=password]");
  return { pass, confirm };
}

function pressWindow(key) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("SetupEncryption", () => {
  it("renders two passphrase fields", () => {
    const { target } = render(SetupEncryption, { onComplete: vi.fn(), onCancel: vi.fn() });
    expect(target.querySelectorAll("input[type=password]").length).toBe(2);
  });

  it("warns and refuses to complete when the passphrase is too short", async () => {
    const onComplete = vi.fn();
    const { target } = render(SetupEncryption, { onComplete, onCancel: vi.fn() });
    const { pass, confirm } = fields(target);
    fill(pass, "short");
    fill(confirm, "short");
    await tick();

    expect(target.querySelector(".hint")?.textContent).toContain("at least 8");
    pressWindow("Enter");
    await tick();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("warns and refuses to complete when the passphrases mismatch", async () => {
    const onComplete = vi.fn();
    const { target } = render(SetupEncryption, { onComplete, onCancel: vi.fn() });
    const { pass, confirm } = fields(target);
    fill(pass, "longenough");
    fill(confirm, "longenoughX");
    await tick();

    expect(target.querySelector(".hint-warn")?.textContent).toContain("do not match");
    pressWindow("Enter");
    await tick();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("completes on Enter with a valid, matching passphrase", async () => {
    const onComplete = vi.fn();
    const { target } = render(SetupEncryption, { onComplete, onCancel: vi.fn() });
    const { pass, confirm } = fields(target);
    fill(pass, "longenough");
    fill(confirm, "longenough");
    await tick();

    pressWindow("Enter");
    await tick();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape", async () => {
    const onCancel = vi.fn();
    render(SetupEncryption, { onComplete: vi.fn(), onCancel });
    pressWindow("Escape");
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
