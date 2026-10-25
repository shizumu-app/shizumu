import { describe, it, expect, vi } from "vitest";
import { pasteNeedsNativeRead, nativeClipboardImage } from "../native-clipboard.js";

// WebKitGTK fires the paste and hands the page nothing for a clipboard that
// holds only an image: no types, no files, no items (measured on the Linux
// desktop under Xvfb, 2026-10-24, with a JPEG served on the clipboard). A
// screenshot pasted on Linux made nothing at all.
describe("pasteNeedsNativeRead", () => {
  it("asks the system when the paste arrived empty", () => {
    expect(pasteNeedsNativeRead({ types: [], files: [], items: [] }, { desktop: true })).toBe(true);
  });

  // Anything the webview did hand over is the paste: text stays text, a file
  // stays the file. Reading the system clipboard on top of it would insert
  // something the writer did not paste.
  it("leaves a paste that carried anything to the editor", () => {
    expect(pasteNeedsNativeRead({ types: ["text/plain"], files: [], items: [] }, { desktop: true })).toBe(false);
    expect(pasteNeedsNativeRead({ types: ["Files"], files: [{}], items: [] }, { desktop: true })).toBe(false);
  });

  // The phone's webview hands images over itself, and has no read permission.
  it("never asks on a phone", () => {
    expect(pasteNeedsNativeRead({ types: [], files: [], items: [] }, { desktop: false })).toBe(false);
  });
});

describe("nativeClipboardImage", () => {
  it("turns the system clipboard's image into a PNG file", async () => {
    const image = { size: async () => ({ width: 2, height: 1 }), rgba: async () => new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) };
    const encode = vi.fn(async (rgba, w, h) => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
    const file = await nativeClipboardImage({ readImage: async () => image, encode });
    expect(encode).toHaveBeenCalledWith(expect.any(Uint8Array), 2, 1);
    expect(file.type).toBe("image/png");
    expect(file.name).toBe("pasted image.png");
  });

  // No image on the clipboard (the plugin rejects) is a paste of nothing,
  // not an error to show: the writer pressed ctrl+V on an empty clipboard.
  it("answers null when the clipboard holds no image", async () => {
    const file = await nativeClipboardImage({ readImage: async () => { throw new Error("no image"); }, encode: vi.fn() });
    expect(file).toBeNull();
  });
});
