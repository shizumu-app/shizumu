// Static-render companion for attachment images.
//
// generateHTML can't know a blob's on-device path — it's resolved per
// device at runtime — so Attachment.renderHTML emits `<img data-blob-hash>`
// with no src. This fills the src in once that HTML is in the DOM.
//
// Resolution is memoized per blob hash: a memory screen can show the same
// image across dozens of cards, and each one would otherwise cost its own
// round-trip to the Rust side.
import { attachmentLocalSrc } from "../api.js";

/** @type {Map<string, Promise<string|null>>} */
const srcCache = new Map();

/** Test seam — also worth calling if the blob store is ever relocated. */
export function clearBlobSrcCache() {
  srcCache.clear();
}

/**
 * Resolve one blob hash to a viewable src, memoized per hash.
 *
 * Exported because the pin panel needs the same answer for a pinned image
 * as the static doc renderer needs for an inline one — and needs it for a
 * single hash rather than for a DOM subtree, so hydrateBlobImages below is
 * the wrong shape. Sharing the resolver shares the memo with it too, which
 * is the point: a panel listing the same image on several rows, next to a
 * memory card rendering it inline, resolves it once.
 *
 * @param {string} blobHash
 * @returns {Promise<string|null>} null when the blob isn't on this device
 */
export function blobImageSrc(blobHash) {
  if (!blobHash) return Promise.resolve(null);
  return resolveBlobSrc(blobHash);
}

function resolveBlobSrc(blobHash) {
  let pending = srcCache.get(blobHash);
  if (!pending) {
    pending = (async () => {
      const path = await attachmentLocalSrc(blobHash);
      if (!path) return null;
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      return convertFileSrc(path);
    })().catch(() => null);
    srcCache.set(blobHash, pending);
  }
  return pending;
}

/**
 * Fill in the src of every un-hydrated attachment image under `root`.
 * Images whose blob isn't on this device are marked so they aren't
 * retried on every re-render.
 *
 * @param {ParentNode|null} root
 * @returns {Promise<number>} how many images got a src
 */
export async function hydrateBlobImages(root) {
  if (!root || typeof root.querySelectorAll !== "function") return 0;
  const pending = [...root.querySelectorAll(
    "img[data-blob-hash]:not([src]):not([data-blob-missing])",
  )];
  if (pending.length === 0) return 0;

  let hydrated = 0;
  await Promise.all(pending.map(async (img) => {
    const hash = img.getAttribute("data-blob-hash");
    if (!hash) return;
    const src = await resolveBlobSrc(hash);
    if (src) {
      img.setAttribute("src", src);
      hydrated++;
    } else {
      // The row survived a GC sweep, or the blob hasn't arrived from
      // another device yet. Leave it srcless so no broken-image glyph
      // shows, and don't ask again.
      img.setAttribute("data-blob-missing", "true");
    }
  }));
  return hydrated;
}
