// Which pasted or dropped file becomes an image block, and under what name.
//
// The paste chose a file by its MIME type and the insert then refused it by
// its name's extension, without a word: a clipboard image is often named
// with no extension at all (a phone photo "1000026431", a screenshot tool's
// "image"), so the paste was swallowed and nothing appeared (sync journey
// J7.1, 2026-10-24). The type decides; the extension is the fallback for a
// file that came with no type.

const BY_TYPE = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/svg+xml", "svg"],
]);
const EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);

function extensionOf(name) {
  const dot = (name || "").lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** @param {{ name?: string, type?: string }} file */
export function isInsertableImage(file) {
  if (file?.type) return BY_TYPE.has(file.type.toLowerCase());
  return EXTS.has(extensionOf(file?.name));
}

/** The name the attachment is stored under: the file's own, with its
 *  type's extension added when it has none. @param {{ name?: string, type?: string }} file */
export function imageFilename(file) {
  const name = (file?.name || "").trim() || "pasted image";
  if (EXTS.has(extensionOf(name))) return name;
  const ext = BY_TYPE.get((file?.type || "").toLowerCase());
  return ext ? `${name}.${ext}` : name;
}

/**
 * The image a paste carries, from its files or, when those are empty, its
 * items: WebKitGTK can hand a pasted image over only as a `kind: "file"`
 * item, and a paste that read `files` alone made nothing (J7.1).
 * @param {{ files?: ArrayLike<any>, items?: ArrayLike<any> } | null} data  a DataTransfer
 * @returns {any | null}  a File
 */
export function clipboardImage(data) {
  if (!data) return null;
  const fromFiles = Array.from(data.files || []).find(isInsertableImage);
  if (fromFiles) return fromFiles;
  for (const item of Array.from(data.items || [])) {
    if (item?.kind !== "file") continue;
    const file = item.getAsFile?.();
    if (file && isInsertableImage(file)) return file;
  }
  return null;
}
