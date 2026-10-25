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

describe("describeAttachmentOpenError — the set the backend actually writes", () => {
  // THE DEVICE REPORT, and the reason this block exists. The backend could
  // fail seven ways and this module recognised two, so five of them showed
  // one generic line about the original being missing — a line that is
  // wrong about a file sitting right there, and that cannot be told apart
  // from any of the others in a photograph. The hunt for a JPG that would
  // not open spent a whole pass on that.
  //
  // Every string below is written in attachments/commands.rs or
  // attachments/share.rs. Two statements of one rule, which is the only
  // arrangement in which either can catch the other: change a message there
  // without changing it here and the writer is back to the fallback.
  const FROM_THE_BACKEND = [
    "file not on this device",
    "could not reach this app's own storage",
    "could not find where this file is kept",
    "could not make room for this file",
    "could not make a copy of this file to open",
    "could not hand this file to another app",
    "this file lost track of itself",
  ];

  it("shows each of them as itself", () => {
    for (const message of FROM_THE_BACKEND) {
      expect(describeAttachmentOpenError(new Error(message)), message).toBe(message);
    }
  });

  it("still collapses anything that reads like a machine", () => {
    // The reason the allowlist is an allowlist rather than a denylist: a
    // backend error added tomorrow leaks raw Rust or OS text otherwise.
    expect(describeAttachmentOpenError(new Error("opener failed: os error 2"))).not.toContain(
      "os error",
    );
    expect(
      describeAttachmentOpenError(new Error("invalid args `filename`: invalid type: null")),
    ).not.toContain("null");
  });
});
