import { describe, it, expect } from "vitest";
import { lockScreen, LOCK_TIMEOUTS, MIN_PASSPHRASE } from "./lock-settings-model.js";

// The phone's lock settings (docs/superpowers/specs/2026-11-07-account-lock-design.md):
// the laptop's choices, because the lock is the account's and either device
// may set, change or remove it.
describe("lockScreen", () => {
  it("offers to set the lock up when it is off, and nothing that needs a passphrase", () => {
    const m = lockScreen({ on: false });
    expect(m.rows.map((r) => r.id)).toEqual(["setup"]);
    expect(m.form).toBeNull();
  });

  it("offers change, turn off and the inactivity choices when it is on", () => {
    const m = lockScreen({ on: true, timeout: 5 });
    expect(m.rows.filter((r) => r.kind === "action").map((r) => r.id)).toEqual(["change", "off"]);
    const choices = m.rows.filter((r) => r.kind === "choice");
    expect(choices.map((r) => r.label)).toEqual(LOCK_TIMEOUTS.map((t) => t.label));
    expect(choices.filter((r) => r.chosen).map((r) => r.id)).toEqual(["timeout-5"]);
  });

  it("says the lock is the account's, so a reader knows the laptop follows", () => {
    expect(lockScreen({ on: false }).note).toMatch(/every device/);
    expect(lockScreen({ on: true }).note).toMatch(/every device/);
  });

  it("asks for the passphrase twice to set it up, and submits only when both match and are long enough", () => {
    const short = lockScreen({ on: false, form: "setup", values: { next: "heron", confirm: "heron" } });
    expect(short.form.fields.map((f) => f.id)).toEqual(["next", "confirm"]);
    expect(short.form.ready).toBe(false);
    expect(short.form.hint).toBe(`at least ${MIN_PASSPHRASE} characters`);
    const differ = lockScreen({ on: false, form: "setup", values: { next: "heron over the weir", confirm: "heron over the wier" } });
    expect(differ.form.ready).toBe(false);
    expect(differ.form.hint).toBe("the two do not match");
    const ok = lockScreen({ on: false, form: "setup", values: { next: "heron over the weir", confirm: "heron over the weir" } });
    expect(ok.form.ready).toBe(true);
    expect(ok.form.hint).toBe("");
    expect(ok.form.submit).toBe("turn the lock on");
  });

  it("asks for the current passphrase to change or remove it", () => {
    const change = lockScreen({ on: true, form: "change", values: { current: "", next: "second heron", confirm: "second heron" } });
    expect(change.form.fields.map((f) => f.id)).toEqual(["current", "next", "confirm"]);
    expect(change.form.ready).toBe(false);
    const off = lockScreen({ on: true, form: "off", values: { current: "heron over the weir" } });
    expect(off.form.fields.map((f) => f.id)).toEqual(["current"]);
    expect(off.form.ready).toBe(true);
    expect(off.form.submit).toBe("turn the lock off");
  });

  it("is not ready while a submit is running, and shows the backend's words when it refuses", () => {
    const busy = lockScreen({ on: true, form: "off", values: { current: "x" }, busy: true });
    expect(busy.form.ready).toBe(false);
    const refused = lockScreen({ on: true, form: "off", values: { current: "x" }, error: "that is not the current passphrase" });
    expect(refused.form.hint).toBe("that is not the current passphrase");
  });

  it("drops a form that does not fit the lock's state", () => {
    // A change form over a lock turned off elsewhere has nothing to change:
    // no form, back to the rows the state offers.
    expect(lockScreen({ on: false, form: "change" }).form).toBeNull();
    expect(lockScreen({ on: true, form: "setup" }).form).toBeNull();
  });
});
