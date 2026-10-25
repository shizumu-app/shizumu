// attachment-relookup.js — may a sync pull send an image block back to ask
// whether its bytes are on this device now?
//
// An attachment node can reach a device before its bytes do: the page
// syncs as one op, the bytes as a separate relay object the worker fetches
// on its tick, and the worker announces that tick with "sync-pulled".
// AttachmentBlock resolves a hash's on-device path once and keeps the
// answer, because the path of a content-addressed blob cannot change. A
// MISSING answer can, which is the one case worth asking again.

/**
 * @param {object} args
 * @param {boolean} args.isImage      the block draws an image
 * @param {string|null} args.hash     its blob hash
 * @param {boolean} args.drawn        a path is already resolved
 * @param {string|null} args.failedHash  a hash whose image failed to load
 * @returns {boolean}
 */
export function looksAgainAfterPull({ isImage, hash, drawn, failedHash }) {
  if (!isImage || !hash) return false;
  // Drawn: the path is known and cannot change; asking again costs an IPC
  // round trip per image per pull for nothing.
  if (drawn) return false;
  // A path that resolved but would not load stays failed for the session
  // (AttachmentBlock handleImageError): retrying it is the flicker loop.
  if (hash === failedHash) return false;
  return true;
}
