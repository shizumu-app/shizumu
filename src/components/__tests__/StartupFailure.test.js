import { describe, it, expect, afterEach } from "vitest";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import StartupFailure from "../StartupFailure.svelte";

afterEach(cleanupAll);

describe("StartupFailure", () => {
  it("says the writing could not be opened, where the file is, and why", () => {
    const { target } = render(StartupFailure, {
      failure: { message: "failed to open database: file is not a database", db_path: "/home/w/.local/share/app.shizumu.Shizumu/settles.db", needs_passphrase: false },
    });
    expect(target.textContent).toContain("could not be opened");
    expect(target.textContent).toContain("/home/w/.local/share/app.shizumu.Shizumu/settles.db");
    expect(target.textContent).toContain("file is not a database");
  });

  it("offers nothing to write into", () => {
    // The app is running on a placeholder; typing here would be lost at quit.
    const { target } = render(StartupFailure, { failure: { message: "m", db_path: "/p", needs_passphrase: false } });
    expect(target.querySelector("input, textarea, [contenteditable]")).toBeNull();
  });
});
