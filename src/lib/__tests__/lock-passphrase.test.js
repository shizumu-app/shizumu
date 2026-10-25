import { describe, it, expect } from "vitest";
import { lockFormState, MIN_PASSPHRASE_CHARS } from "../lock-passphrase.js";

describe("lockFormState — changing the passphrase", () => {
  const change = (current, next, confirm) => lockFormState({ mode: "change", current, next, confirm });

  it("needs the current passphrase, a long enough new one, and the same one twice", () => {
    expect(change("old secret", "new secret", "new secret")).toEqual({ valid: true, hint: null });
  });

  it("says why the new one is not accepted", () => {
    expect(change("old secret", "short", "short").hint).toBe(`at least ${MIN_PASSPHRASE_CHARS} characters`);
    expect(change("old secret", "new secret", "new secreT").hint).toBe("passphrases do not match");
  });

  // No hint before anything is typed: an empty form is unfinished, not wrong.
  it("is not ready, and says nothing, while a field is still empty", () => {
    expect(change("", "new secret", "new secret")).toEqual({ valid: false, hint: null });
    expect(change("old secret", "", "")).toEqual({ valid: false, hint: null });
  });

  it("refuses a new passphrase that is the current one", () => {
    expect(change("same secret", "same secret", "same secret")).toEqual({
      valid: false, hint: "that is already the passphrase",
    });
  });
});

describe("lockFormState — turning the lock off", () => {
  it("needs only the current passphrase", () => {
    expect(lockFormState({ mode: "off", current: "old secret" })).toEqual({ valid: true, hint: null });
    expect(lockFormState({ mode: "off", current: "" }).valid).toBe(false);
  });
});
