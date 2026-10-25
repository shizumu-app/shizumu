import { describe, it, expect } from "vitest";
import { startupScreen } from "../startup-gate.js";

describe("startupScreen", () => {
  it("shows nothing special when the file opened", () => {
    expect(startupScreen(null)).toBe(null);
    expect(startupScreen(undefined)).toBe(null);
  });

  it("asks for the passphrase when that is all the file needs", () => {
    expect(startupScreen({ needs_passphrase: true, message: "x", db_path: "/d/settles.db" })).toBe("locked");
  });

  it("blocks writing when the file could not be opened at all", () => {
    // The app is on an in-memory placeholder: anything typed would be lost.
    expect(startupScreen({ needs_passphrase: false, message: "file is not a database", db_path: "/d/settles.db" })).toBe("failed");
  });
});
