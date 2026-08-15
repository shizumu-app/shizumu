// What `attachment_open` failed with is whatever the OS-level opener or
// Android share intent said back — e.g. Rust's own
// "opener failed: No such file or directory (os error 2)". That is a
// diagnostic string, not something written for a reader, and rendering it
// raw is what put an os-error next to the paragraph that followed it in
// the doc with no boundary between them (see AttachmentBlock.svelte's
// `.attachment-error`, which now also gives it its own line).
//
// A decision — is this message safe to show as-is, or does it need
// collapsing to something written in brand voice — belongs in its own
// pure module per the project's testing rules, not inline in the
// component where nothing could unit-test it.
//
// Messages the backend already writes in brand voice (lowercase, no
// jargon, no exclamation marks) pass through unchanged; anything else,
// known or not, collapses to one generic line so a future backend error
// string can't leak raw Rust/OS text into the UI by surprise.
const READABLE = new Set([
  "file not on this device",
]);

const READABLE_PREFIXES = [
  // attachments::commands::attachment_open_android's own message, already
  // lowercase and jargon-free.
  "could not open the share sheet",
];

const FALLBACK = "could not open this file — the original may be missing or unreadable.";

export function describeAttachmentOpenError(rawError) {
  const message = String(rawError?.message ?? rawError ?? "").trim();
  if (!message) return FALLBACK;
  const lower = message.toLowerCase();
  if (READABLE.has(lower) || READABLE_PREFIXES.some((p) => lower.startsWith(p))) {
    return message;
  }
  return FALLBACK;
}
