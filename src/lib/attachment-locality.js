// Attachment locality — the one place that decides whether a pinned file
// reads as here or as "not on this device", and the one place the storage
// panel counts the same fact from.
//
// The signal is `has_local` on the attachment row, which `attachment_list`
// already returns. Rows are never deleted: `attachment_gc` deletes the blob
// file and sets `has_local = 0`, keeping the row so synced devices can
// re-fetch. So `has_local` is the exact, durable answer to "are the bytes
// here", and nothing needs to stat the disk to ask it.
//
// Away is a normal state, not an error. Two routine ways in: the gc swept a
// blob nothing pointed at anymore, or the attachment never left the device
// that added it (attachments are sync = 0 by default) while the pin that
// points at it travelled. The pin is a pointer plus a frozen cache — it
// outliving its bytes on one device is the pin-pointer clause working, not a
// failure. Callers render it in the muted register the size already uses.

import { isFilePin, attachmentMetaOf } from "./pin-display.js";

/** The phrase both surfaces use. Kept here so they cannot drift apart. */
export const AWAY_LABEL = "not on this device";

/**
 * The storage panel's local-attachment explainer. This is local fact, not
 * a sync fact — attachments default to sync = 0, so most files on most
 * devices are governed by this sentence whether or not sync is ever set
 * up — and it must stay true read by a single-device install with no
 * relay: it does not name "other devices" as something that currently
 * exists, only sync as the thing that would let the pin travel with its
 * bytes rather than alone. See SyncSettings.svelte, storage tab.
 */
export const ATTACHMENT_LOCALITY_NOTE =
  "a file stays on the device that added it unless you sync it — synced, the pin travels with its bytes. unsynced, the pin travels alone.";

/**
 * The gc floor, named where the user meets it: a pin is a pointer plus a
 * frozen cache (pin pointer semantics), so a pinned file's blob is a
 * reference `attachment_gc` will never collect. Local retention, not a
 * sync feature — true with no relay configured, which is exactly when an
 * unsynced sweep is unrecoverable and this line matters most.
 */
export const PIN_RETENTION_NOTE =
  "a pin keeps its file here — unpinning is what releases the bytes.";

/**
 * Build the hash → has_local lookup from an `attachment_list` result.
 * Rows without a usable blob_hash are dropped — they cannot be matched
 * against a pin's cached hash anyway.
 * @param {Array<{blob_hash?: string, has_local?: boolean}>|null|undefined} attachments
 * @returns {Map<string, boolean>}
 */
export function attachmentLocality(attachments) {
  const map = new Map();
  if (!Array.isArray(attachments)) return map;
  for (const a of attachments) {
    if (!a || typeof a.blob_hash !== "string" || !a.blob_hash) continue;
    map.set(a.blob_hash, !!a.has_local);
  }
  return map;
}

/**
 * Where a blob's bytes are, as far as this device can tell.
 * @returns {"here"|"away"|null} null means "no claim" — see below.
 */
export function blobLocality(blobHash, locality) {
  if (!blobHash || !locality || typeof locality.get !== "function") return null;
  const hasLocal = locality.get(blobHash);
  // No row for this hash means we know nothing, so we say nothing. A pin can
  // arrive by sync ahead of the attachment row it points at; calling that
  // "away" would label a file that lands seconds later. Silence here is the
  // correct output, not a missed case.
  if (hasLocal === undefined) return null;
  return hasLocal ? "here" : "away";
}

/**
 * Same question, asked of a pin row. Non-file pins and pins whose cached
 * content carries no blob_hash get no claim.
 * @returns {"here"|"away"|null}
 */
export function pinFileLocality(pin, locality) {
  if (!locality || typeof locality.get !== "function") return null;
  if (!isFilePin(pin)) return null;
  const meta = attachmentMetaOf(pin?.content);
  return blobLocality(meta?.blob_hash, locality);
}

/**
 * The file pin's second line. The size alone when the bytes are here (or
 * when we have no claim to make), size and state when they are not.
 */
export function fileRowDetail(sizeText, locality) {
  const size = sizeText || "";
  if (locality !== "away") return size;
  return size ? `${size} — ${AWAY_LABEL}` : AWAY_LABEL;
}

/** How many listed attachments this device is not holding the bytes for. */
export function awayCount(attachments) {
  if (!Array.isArray(attachments)) return 0;
  let n = 0;
  for (const a of attachments) {
    if (!a || typeof a.blob_hash !== "string" || !a.blob_hash) continue;
    if (!a.has_local) n += 1;
  }
  return n;
}
