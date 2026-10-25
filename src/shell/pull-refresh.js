// WHAT DOES A SYNC PULL DO TO THE PAGE ON SCREEN?
//
// The worker emits `sync-pulled` after any pull that brought ops: the other
// device wrote something. The desktop has answered that since the editor
// existed (Page.svelte, its `sync-pulled` listener). The shell never
// listened at all, so a page open on the phone kept the copy it was opened
// with. The laptop's words reached the phone's database and not its
// screen, and the next keystroke on the phone saved the stale copy over
// them: last write wins, and the stale copy was the last write. Found by
// the readiness council on 2026-10-14, by reading for the listener.
//
// Two decisions, both here because CLAUDE.md puts decisions where a test
// can reach them:
//
// - where the fresh copy is read from. A continuous trail has one living
//   document and the desktop reads it through the trail, not the row.
// - what to do with the answer. Whether the EDITOR may take the new words
//   is a third decision and already has its own module
//   (src/lib/editor/pull-reload.js, `mayReplaceWithPulled`): a pull that
//   lands while a save is pending must not replace the newer typing.
//   EditorCore.reloadFromContent applies it, so nothing here repeats it.

/**
 * @param {object} args
 * @param {{ id: string, lineage_id?: string|null } | null} args.page  the open page
 * @param {"discrete"|"continuous"|null} args.trailMode  the open page's trail mode
 * @returns {{ how: "none" } | { how: "trail", lineageId: string } | { how: "page" }}
 */
export function pulledReadAddress({ page, trailMode }) {
  if (!page?.id) return { how: "none" };
  if (trailMode === "continuous" && page.lineage_id) {
    return { how: "trail", lineageId: page.lineage_id };
  }
  return { how: "page" };
}

/**
 * @param {object} args
 * @param {{ id: string, date?: string, lineage_id?: string|null } | null} args.open
 *   the page on screen when the pull landed
 * @param {{ id: string, lineage_id?: string|null } | null | undefined} args.fresh
 *   the same page as the database holds it now, or null when it is gone
 * @param {string} args.todayStr  YYYY-MM-DD, local
 * @returns {"none"|"today"|"retrail"|"reload"}
 *   - `reload`: same page, same trail. Hand the words to the editor and
 *     patch the row's own columns in place.
 *   - `retrail`: the other device moved the page to another trail. The
 *     header's trail name and the carry-forward both hang off the trail,
 *     so the row is adopted again, not patched.
 *   - `today`: the page is gone and it was today's. On the first pull
 *     after launch that is expected: `get_or_create_today` minted a blank
 *     page before sync could say what today already held, and the first
 *     pull's orphan sweep removed it. Show the real today.
 *   - `none`: nothing open, or a PAST page vanished. That is a delete
 *     someone asked for, and jumping to today would hide it.
 */
export function pulledPageAction({ open, fresh, todayStr }) {
  if (!open?.id) return "none";
  if (!fresh) return open.date === todayStr ? "today" : "none";
  if ((fresh.lineage_id || null) !== (open.lineage_id || null)) return "retrail";
  return "reload";
}

// ── AND EVERYTHING ELSE ON SCREEN ─────────────────────────────────────
//
// The writer's ask, 2026-10-14: "in phone i need to see things synced,
// blocks, trails, pages, everything, directly". Every surface the shell
// shows reads its rows once, when it opens. A pull that lands while it is
// open changes the database under it and nothing on screen, so a trail
// renamed on the laptop, a page written there, a pin kept there, all wait
// for the writer to leave and come back. This lists what is showing, so
// each can be read again in place.

/**
 * @param {object} args
 * @param {boolean} args.pageOpen  a page is loaded (it shows under any root)
 * @param {string} args.active  the root: "page" | "memory" | "settings" | ...
 * @param {string[]} args.pushed  the kinds on the stack, bottom first
 * @param {string|null} args.sheet  the open sheet's name, if any
 * @returns {Array<"page"|"memory"|"pins"|"trails"|"reading">}
 */
export function pullRefreshTargets({ pageOpen, active, pushed, sheet }) {
  const out = [];
  // The page is refreshed whatever is in front: it is the editor's copy,
  // and a stale copy is what the next save writes back.
  if (pageOpen) out.push("page");
  if (active === "memory") out.push("memory");
  if ((pushed || []).includes("pins")) out.push("pins");
  if (sheet === "trail") out.push("trails");
  // A page opened from memory: the other device can still be writing in it.
  if ((pushed || []).includes("reading")) out.push("reading");
  return out;
}
