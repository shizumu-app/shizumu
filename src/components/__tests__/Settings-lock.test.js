// Until 0.8 a writer who turned on "lock with password" could not change the
// passphrase or turn the lock off again: the row said "on" and nothing else
// (reported from 0.7.8 on flathub). These drive the row as a writer would.
import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const api = vi.hoisted(() => ({
  encrypted: true,
  changePassphrase: vi.fn(async () => {}),
  removeEncryption: vi.fn(async () => {}),
}));
vi.mock("../../lib/api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  checkEncryptionStatus: vi.fn(async () => api.encrypted),
  changePassphrase: api.changePassphrase,
  removeEncryption: api.removeEncryption,
}));

import Settings from "../Settings.svelte";
import { LOCK_SETTINGS_EVENT } from "../../lib/auto-lock.js";

afterEach(() => { cleanupAll(); vi.clearAllMocks(); api.encrypted = true; });

const props = { currentTone: "cream", onToneChange: () => {}, onDeleteAll: () => {}, onClose: () => {}, initialTab: "encryption" };
const settle = async () => { for (let i = 0; i < 5; i++) { await tick(); await Promise.resolve(); } };
const button = (root, text) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const type = async (input, value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); await tick(); };

describe("settings — lock with password, once it is on", () => {
  it("offers to change the passphrase and to turn the lock off", async () => {
    const { target } = render(Settings, props);
    await settle();
    expect(button(target, "change passphrase")).toBeTruthy();
    expect(button(target, "turn off")).toBeTruthy();
  });

  it("turns the lock off with the current passphrase, and offers set up again", async () => {
    const announced = [];
    const listen = (e) => announced.push(e.detail);
    window.addEventListener(LOCK_SETTINGS_EVENT, listen);
    const { target } = render(Settings, props);
    await settle();
    button(target, "turn off").click();
    await settle();
    const fields = target.querySelectorAll("input[type=password]");
    expect(fields.length).toBe(1);
    await type(fields[0], "old secret");
    button(target.querySelector(".lock-form"), "turn off").click();
    await settle();

    expect(api.removeEncryption).toHaveBeenCalledWith("old secret");
    // The inactivity timer has to hear it, or it locks a plain file nothing opens.
    expect(announced).toContainEqual({ encrypted: false });
    expect(button(target, "set up")).toBeTruthy();
    expect(target.textContent).not.toContain("lock after inactivity");
    window.removeEventListener(LOCK_SETTINGS_EVENT, listen);
  });

  it("changes the passphrase from the current one to a new one typed twice", async () => {
    const { target } = render(Settings, props);
    await settle();
    button(target, "change passphrase").click();
    await settle();
    const [current, next, confirm] = target.querySelectorAll("input[type=password]");
    await type(current, "old secret");
    await type(next, "new secret");
    await type(confirm, "new secret");
    button(target.querySelector(".lock-form"), "change passphrase").click();
    await settle();

    expect(api.changePassphrase).toHaveBeenCalledWith("old secret", "new secret");
    expect(button(target, "change passphrase")).toBeTruthy(); // back on the row, still locked
  });

  it("shows the app's answer when the current passphrase is wrong, and stays on the form", async () => {
    api.removeEncryption.mockRejectedValueOnce("that is not the current passphrase");
    const { target } = render(Settings, props);
    await settle();
    button(target, "turn off").click();
    await settle();
    await type(target.querySelector("input[type=password]"), "a guess");
    button(target.querySelector(".lock-form"), "turn off").click();
    await settle();

    expect(target.textContent).toContain("that is not the current passphrase");
    expect(target.querySelector(".lock-form")).toBeTruthy();
  });
});
