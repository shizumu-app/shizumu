// WHICH SCREEN A LAUNCH THAT COULD NOT OPEN THE WRITER'S FILE SHOWS.
//
// The backend no longer crashes when the database will not open: it runs on
// an empty in-memory placeholder and says why (commands.rs,
// `startup_failure`). Nothing typed into the placeholder reaches the file,
// so the screen must not offer a page at all until the real file is open.
//
// - "locked": the file is encrypted and no passphrase was found for it. The
//   lock screen opens it.
// - "failed": the file is damaged or unreadable. Say so, say where it is, and
//   offer nothing to write into.

/** @param {{ needs_passphrase: boolean } | null | undefined} failure */
export function startupScreen(failure) {
  if (!failure) return null;
  return failure.needs_passphrase ? "locked" : "failed";
}
