// image-file-guard.js — is the file the user just picked actually an image?
//
// `/image` opens the picker with `accept="image/*"`. That is a HINT, not a
// gate: every desktop file dialog offers an "all files" escape hatch, and a
// content:// pick on Android can arrive with no usable type at all. So a PDF
// or a .zip could be handed to `attachmentAddBytes` with `kind: "image"` and
// inserted as an image node, which then renders as a broken picture the user
// cannot explain and cannot fix from inside the app.
//
// A decision — is this an image — belongs in its own pure module per the
// project's testing rules, not inline in the slash command where nothing
// could unit-test it.
//
// Two signals, in order:
//   1. the browser's reported MIME type, when there is one. `image/*` is
//      the whole rule; the browser already normalized it.
//   2. the filename extension, when the MIME is empty or generic. Android's
//      content:// picks routinely report "" or
//      "application/octet-stream" for a perfectly good JPEG, and rejecting
//      those would break the platform where the picker's accept filter is
//      least reliable in the first place — exactly backwards.
//
// A pick that gives us NEITHER a usable MIME nor a recognisable extension
// is rejected. Guessing from bytes would mean sniffing magic numbers for a
// gain measured in files nobody names properly.

/**
 * Extensions the app is willing to insert as an image node. Kept narrower
 * than "everything a browser can decode": these are the formats an
 * `<img src>` renders in the app's webviews (webkit2gtk on Linux, WebView2
 * on Windows, Android System WebView) without a codec surprise.
 */
export const IMAGE_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico", "heic", "heif",
];

/**
 * MIME types that mean "the picker didn't actually know". Treated as
 * absent rather than as a rejection, so the extension gets its turn.
 */
const UNINFORMATIVE_MIME = new Set([
  "",
  "application/octet-stream",
  "content/unknown",
]);

function extensionOf(filename) {
  if (typeof filename !== "string") return "";
  const base = filename.split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * isImagePick — the gate itself.
 *
 * @param {{name?: string, mime?: string}|null|undefined} picked - the shape
 *   `pickFileBytes` resolves to (minus its bytes, which this never reads).
 * @returns {boolean} true if this file may be inserted as an image.
 */
export function isImagePick(picked) {
  if (!picked) return false;
  const mime = (picked.mime || "").trim().toLowerCase();
  if (mime && !UNINFORMATIVE_MIME.has(mime)) {
    return mime.startsWith("image/");
  }
  return IMAGE_EXTENSIONS.includes(extensionOf(picked.name));
}

/**
 * The line shown when a pick is refused. Brand voice: lowercase, present
 * tense, no exclamation mark, and it names the alternative rather than
 * only the refusal — `/file` attaches anything, so the user is one command
 * away from what they were trying to do.
 *
 * Names the offending file so a multi-select or a mis-click is legible.
 *
 * @param {{name?: string}|null|undefined} picked
 * @returns {string}
 */
export function imageRejectionMessage(picked) {
  const name = (picked?.name || "").trim();
  const what = name ? `"${name}"` : "that file";
  return `${what} is not an image — use /file to attach it instead.`;
}
