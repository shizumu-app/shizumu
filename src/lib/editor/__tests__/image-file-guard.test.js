import { describe, it, expect } from "vitest";
import { isImagePick, imageRejectionMessage, IMAGE_EXTENSIONS } from "../image-file-guard.js";

describe("isImagePick", () => {
  it("accepts a file the browser reports as an image", () => {
    expect(isImagePick({ name: "photo.png", mime: "image/png" })).toBe(true);
    expect(isImagePick({ name: "x", mime: "image/webp" })).toBe(true);
  });

  it("rejects a file the browser reports as anything else", () => {
    // The whole point of the guard: `accept="image/*"` is a picker hint,
    // and every desktop dialog offers an "all files" escape hatch.
    expect(isImagePick({ name: "report.pdf", mime: "application/pdf" })).toBe(false);
    expect(isImagePick({ name: "notes.txt", mime: "text/plain" })).toBe(false);
    expect(isImagePick({ name: "clip.mp4", mime: "video/mp4" })).toBe(false);
  });

  it("falls back to the extension when the picker reports no type", () => {
    // Android content:// picks routinely report "" for a good JPEG.
    // Rejecting those would break the platform whose accept filter is
    // least reliable — exactly backwards.
    expect(isImagePick({ name: "IMG_0042.JPG", mime: "" })).toBe(true);
    expect(isImagePick({ name: "scan.heic", mime: "application/octet-stream" })).toBe(true);
    expect(isImagePick({ name: "shot.png", mime: "content/unknown" })).toBe(true);
  });

  it("rejects an untyped pick whose extension is not an image one", () => {
    expect(isImagePick({ name: "archive.zip", mime: "" })).toBe(false);
    expect(isImagePick({ name: "report.pdf", mime: "application/octet-stream" })).toBe(false);
  });

  it("rejects an untyped pick with no usable extension at all", () => {
    // Neither signal available. Sniffing magic bytes would buy correctness
    // only for files nobody names properly; refusing is the honest answer.
    expect(isImagePick({ name: "screenshot", mime: "" })).toBe(false);
    expect(isImagePick({ name: "", mime: "" })).toBe(false);
    expect(isImagePick({ name: ".gitignore", mime: "" })).toBe(false);
    expect(isImagePick({ name: "trailing.", mime: "" })).toBe(false);
  });

  it("is case-insensitive on both signals", () => {
    expect(isImagePick({ name: "a.PNG", mime: "" })).toBe(true);
    expect(isImagePick({ name: "a.bin", mime: "IMAGE/PNG" })).toBe(true);
  });

  it("reads the extension from the basename, not from a directory component", () => {
    // A content:// path or a Windows pick can carry separators.
    expect(isImagePick({ name: "C:\\photos.png\\readme", mime: "" })).toBe(false);
    expect(isImagePick({ name: "/home/a.zip/b.png", mime: "" })).toBe(true);
  });

  it("rejects a null / absent pick", () => {
    expect(isImagePick(null)).toBe(false);
    expect(isImagePick(undefined)).toBe(false);
  });

  it("accepts every extension it advertises", () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(isImagePick({ name: `f.${ext}`, mime: "" })).toBe(true);
    }
  });
});

describe("imageRejectionMessage", () => {
  it("names the file and points at the command that would work", () => {
    const msg = imageRejectionMessage({ name: "report.pdf" });
    expect(msg).toContain("report.pdf");
    expect(msg).toContain("/file");
  });

  it("stays readable when the pick has no name", () => {
    expect(imageRejectionMessage({})).toBe("that file is not an image — use /file to attach it instead.");
  });

  it("holds the brand voice: lowercase opening, no exclamation mark", () => {
    // Enforced here rather than left to review — this string is one of the
    // few the editor shows in the user's own words. Only the prose is
    // checked for case: the filename is the user's and is quoted verbatim.
    for (const picked of [{ name: "A.PDF" }, {}, null]) {
      const msg = imageRejectionMessage(picked);
      expect(msg).not.toContain("!");
      expect(/^[a-z"]/.test(msg)).toBe(true);
      const prose = msg.replace(/"[^"]*"/, "");
      expect(prose).toBe(prose.toLowerCase());
    }
  });
});
