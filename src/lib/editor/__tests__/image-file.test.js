import { describe, it, expect } from "vitest";
import { isInsertableImage, imageFilename } from "../image-file.js";

// A clipboard image often has no extension in its name (a phone photo
// "1000026431", a screenshot tool's "image"). The paste picked it by its
// MIME type and the insert then refused it by its name, without a word
// (sync journey J7.1, 2026-10-24).
describe("isInsertableImage", () => {
  it("takes an image by its type, whatever its name", () => {
    expect(isInsertableImage({ name: "1000026431", type: "image/jpeg" })).toBe(true);
    expect(isInsertableImage({ name: "image", type: "image/png" })).toBe(true);
  });

  it("takes an image by its extension when the type is missing", () => {
    expect(isInsertableImage({ name: "harbour.webp", type: "" })).toBe(true);
  });

  it("refuses what is not an image", () => {
    expect(isInsertableImage({ name: "notes.pdf", type: "application/pdf" })).toBe(false);
    expect(isInsertableImage({ name: "README", type: "" })).toBe(false);
  });

  // A type the app cannot draw is not taken just for starting with image/.
  it("refuses an image type the editor cannot show", () => {
    expect(isInsertableImage({ name: "scan.tiff", type: "image/tiff" })).toBe(false);
  });
});

describe("imageFilename", () => {
  it("keeps a name that already says what it is", () => {
    expect(imageFilename({ name: "harbour.jpg", type: "image/jpeg" })).toBe("harbour.jpg");
  });

  it("gives a nameless or extensionless image the extension of its type", () => {
    expect(imageFilename({ name: "1000026431", type: "image/jpeg" })).toBe("1000026431.jpg");
    expect(imageFilename({ name: "", type: "image/png" })).toBe("pasted image.png");
  });
});

// WebKitGTK (the Linux desktop) can hand a pasted image over as a clipboard
// ITEM with an empty `files` list, so a paste that read only `files` made
// nothing (sync journey J7.1, 2026-10-24).
import { clipboardImage } from "../image-file.js";

describe("clipboardImage", () => {
  const photo = { name: "1000026431", type: "image/jpeg" };

  it("finds the image among the files", () => {
    expect(clipboardImage({ files: [photo], items: [] })).toBe(photo);
  });

  it("finds it among the items when files is empty", () => {
    const items = [
      { kind: "string", type: "text/uri-list", getAsFile: () => null },
      { kind: "file", type: "image/jpeg", getAsFile: () => photo },
    ];
    expect(clipboardImage({ files: [], items })).toBe(photo);
  });

  // Text on the clipboard is a text paste; no image is not an error.
  it("is null when the clipboard holds no image", () => {
    expect(clipboardImage({ files: [], items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] })).toBeNull();
    expect(clipboardImage(null)).toBeNull();
  });
});
