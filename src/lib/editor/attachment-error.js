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
// WHY THIS LIST GREW. It held two strings while the backend could fail in
// seven ways, so five of them — a missing app directory, an unresolvable
// blob path, no cache directory, a failed mkdir, a failed copy — all landed
// on the fallback below, and none of them logged either. A device pass
// spent on a photograph of that one line could not tell them apart, and did
// not. The allowlist is the right shape; what was missing was a set for it
// to recognise. Every entry here is written by
// attachments::commands.rs/share.rs, which now also logs the technical
// cause beside it.
const READABLE = new Set([
  "file not on this device",
  "could not reach this app's own storage",
  "could not find where this file is kept",
  "could not make room for this file",
  "could not make a copy of this file to open",
  "could not hand this file to another app",
  // The front end's own, for a node whose attrs never arrived — see
  // AttachmentBlock. Tauri would otherwise reject the call at its argument
  // layer with "invalid type: null", which is exactly the kind of string
  // this module exists to keep off the page.
  "this file lost track of itself",
]);

const READABLE_PREFIXES = [
  // Kept for the message attachment_open_android used to send. A build of
  // the app older than the one that stopped sending it can still be the
  // thing a tester is holding.
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
