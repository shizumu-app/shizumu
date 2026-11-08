// The phone's lock settings (the account's one lock, account_lock.rs): the
// rows a state offers, a form that opens in place, and a submit that is
// inert until the passphrases are long enough and match.
import { describe, it, expect, vi, afterEach } from "vitest";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import LockSettingsScreen from "../LockSettingsScreen.svelte";

afterEach(cleanupAll);

const rowNamed = (target, text) =>
  [...target.querySelectorAll(".shell-row")].find((r) => (r.textContent || "").trim().startsWith(text));
// Row renders a real <button class="shell-row"> only when it does something.
const live = (row) => !!row && row.tagName === "BUTTON";
const press = (el) => { el.click(); flushSync(); };
const typeInto = (input, v) => { input.value = v; input.dispatchEvent(new Event("input", { bubbles: true })); flushSync(); };

describe("LockSettingsScreen", () => {
  it("offers set up when the lock is off, and says every device follows", () => {
    const { target } = render(LockSettingsScreen, { on: false });
    flushSync();
    expect(rowNamed(target, "set up")).toBeTruthy();
    expect(rowNamed(target, "turn off")).toBeFalsy();
    expect(target.textContent).toMatch(/every device on this account/);
  });

  it("opens the setup form, keeps its submit inert until the two match, then sends the passphrase", () => {
    const onSubmit = vi.fn();
    const { target } = render(LockSettingsScreen, { on: false, onSubmit });
    flushSync();
    press(rowNamed(target, "set up"));
    const inputs = [...target.querySelectorAll("input")];
    expect(inputs.length).toBe(2);
    expect(inputs.every((i) => i.type === "password")).toBe(true);

    typeInto(inputs[0], "heron over the weir");
    typeInto(inputs[1], "heron over the wier");
    const submit = () => rowNamed(target, "turn the lock on");
    expect(live(submit())).toBe(false);
    expect(target.textContent).toMatch(/the two do not match/);

    typeInto(inputs[1], "heron over the weir");
    expect(live(submit())).toBe(true);
    press(submit());
    expect(onSubmit).toHaveBeenCalledWith("setup", expect.objectContaining({ next: "heron over the weir", confirm: "heron over the weir" }));
  });

  it("offers change, turn off and the inactivity choices when the lock is on, and a choice reports its minutes", () => {
    const onTimeout = vi.fn();
    const { target } = render(LockSettingsScreen, { on: true, timeout: 0, onTimeout });
    flushSync();
    expect(rowNamed(target, "change passphrase")).toBeTruthy();
    expect(rowNamed(target, "turn off")).toBeTruthy();
    press(rowNamed(target, "15 minutes"));
    expect(onTimeout).toHaveBeenCalledWith(15);
  });

  it("shows the backend's refusal under the form", () => {
    const { target } = render(LockSettingsScreen, { on: true, error: "that is not the current passphrase" });
    flushSync();
    press(rowNamed(target, "turn off"));
    expect(target.textContent).toMatch(/that is not the current passphrase/);
  });
});
