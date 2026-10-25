// A pasted image the webview did not hand over, read from the system.
//
// WebKitGTK fires the paste and gives the page nothing for a clipboard that
// holds only an image: no types, no files, no items (measured on the Linux
// desktop, 2026-10-24, with a JPEG served on the clipboard). So a screenshot
// pasted on Linux made nothing at all, and sync journey J7.1 never passed.
// The clipboard plugin reads it past the webview; this is only ever asked on
// the writer's own ctrl+V, and only when the paste arrived empty.

/**
 * @param {{ types?: ArrayLike<string>, files?: ArrayLike<any>, items?: ArrayLike<any> } | null} data
 * @param {{ desktop: boolean }} where
 * @returns {boolean}
 */
export function pasteNeedsNativeRead(data, { desktop }) {
  if (!desktop || !data) return false;
  const none = (list) => !list || list.length === 0;
  return none(data.types) && none(data.files) && none(data.items);
}

/** PNG bytes for an RGBA buffer, through a canvas. */
async function encodePng(rgba, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return await new Promise((done) => canvas.toBlob(done, "image/png"));
}

/**
 * The system clipboard's image as a PNG File, or null when there is none.
 * `readImage` and `encode` are injectable for tests; by default the
 * clipboard plugin and a canvas.
 */
export async function nativeClipboardImage({ readImage, encode = encodePng } = {}) {
  try {
    const read = readImage ?? (await import("@tauri-apps/plugin-clipboard-manager")).readImage;
    const image = await read();
    const { width, height } = await image.size();
    if (!width || !height) return null;
    const blob = await encode(await image.rgba(), width, height);
    if (!blob) return null;
    return new File([blob], "pasted image.png", { type: "image/png" });
  } catch {
    // No image on the clipboard: the plugin rejects. A paste of nothing.
    return null;
  }
}
