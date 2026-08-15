import { describe, it, expect } from "vitest";
import { describeAttachmentOpenError } from "../attachment-error.js";

describe("describeAttachmentOpenError", () => {
  it("passes through a message already written in brand voice", () => {
    expect(describeAttachmentOpenError("file not on this device")).toBe(
      "file not on this device",
    );
  });

  it("passes through the android share-sheet failure message", () => {
    expect(
      describeAttachmentOpenError("could not open the share sheet for this file"),
    ).toBe("could not open the share sheet for this file");
  });

  it("collapses a raw OS/opener error to a generic readable line", () => {
    // The bug this guards: the user saw exactly this string inline, run
    // straight into the paragraph that followed it.
    const raw = "opener failed: No such file or directory (os error 2)";
    const out = describeAttachmentOpenError(raw);
    expect(out).not.toBe(raw);
    expect(out).not.toMatch(/os error/i);
    expect(out).toBe("could not open this file — the original may be missing or unreadable.");
  });

  it("collapses an unrecognized future backend message too", () => {
    // Not an allowlist bypass: anything NOT explicitly known-readable
    // collapses, so a new raw Rust/OS string introduced later can't leak
    // into the UI just because nobody thought to block it.
    expect(describeAttachmentOpenError("panicked at src/foo.rs:42")).toBe(
      "could not open this file — the original may be missing or unreadable.",
    );
  });

  it("handles a thrown Error object, not just a string", () => {
    const err = new Error("opener failed: No such file or directory (os error 2)");
    expect(describeAttachmentOpenError(err)).toBe(
      "could not open this file — the original may be missing or unreadable.",
    );
  });

  it("falls back to the generic line for an empty or missing message", () => {
    expect(describeAttachmentOpenError("")).toBe(
      "could not open this file — the original may be missing or unreadable.",
    );
    expect(describeAttachmentOpenError(undefined)).toBe(
      "could not open this file — the original may be missing or unreadable.",
    );
  });
});
