// MAY A SYNC PULL REPLACE WHAT IS IN THE EDITOR?
//
// Page.svelte listens for `sync-pulled` — which the worker emits after any
// pull that brought ops, i.e. whenever the other device wrote anything — and
// on every one re-reads the open page and hands it to the editor. That is
// right when the other device changed THIS page: without it the editor keeps
// a stale copy and the writer's next save wipes the remote update.
//
// It was wrong in one case, and the case destroyed writing. The editor saves
// on a one-second debounce, so for that second the newest words exist only
// in the editor. A pull landing then found the editor and the stored copy
// different — of course; the stored one had not caught up — and replaced the
// editor with the older copy. Measured on a desktop: the sentence typed a
// moment before the pull was gone from the screen and never reached the
// database (scripts/desktop/scenarios/probe-pull-while-typing.mjs).
//
// While a save is pending, the editor holds the newer edit. Sync already
// resolves a page edited in two places by last write wins, and the pending
// save is the later write; it lands within the second. So the answer then is
// no — and the stored copy is shown on the next pull, by which time it holds
// the writer's words too.
//
// CLAUDE.md: a decision lives in a pure module, where a test can reach it.

/**
 * @param {object} args
 * @param {boolean} args.pendingSave - the editor has typing it has not saved yet
 * @param {string} args.current - the editor's document, serialised
 * @param {string|null|undefined} args.incoming - the stored document, serialised
 * @returns {boolean} true when the editor should show the stored copy
 */
export function mayReplaceWithPulled({ pendingSave, current, incoming }) {
  if (!incoming) return false;
  if (incoming === current) return false;
  if (pendingSave) return false;
  return true;
}

// AND WHEN IT MAY NOT, IT IS PUT OFF, NOT DROPPED. "Shown on the next pull"
// assumed one was coming. When the other device had stopped writing there was
// none, and the open page never showed its line (sync journeys J10.6 and
// J5.3, 25 october: the laptop typed, the phone's line landed inside the
// laptop's save second, and the phone then waited for the laptop). So the
// editor answers "deferred" and its host saves now and reads the page again,
// which by then holds both devices' words.

/**
 * @param {object} args  as mayReplaceWithPulled
 * @returns {"apply"|"deferred"|"same"} apply the stored copy; put it off for
 *   a pending save (the host saves and reads again); or nothing to show
 */
export function pullReload({ pendingSave, current, incoming }) {
  if (!incoming || incoming === current) return "same";
  return pendingSave ? "deferred" : "apply";
}

// AND MAY THE EDITOR SAVE WHAT A PULL PUT THERE? No.
//
// A save stamps the page with this device's time. Saving the copy a pull
// just delivered makes the other device's words look newer here than they
// are, and sync settles a page edited in two places by the newest write: a
// sentence the other device typed in the same seconds then loses to its own
// previous copy, sent back. Measured with one page open on an A16 and a
// laptop (2026-10-16): the laptop's sentence was gone from both. The editor
// asks to save after a reload because loading changes the document a little
// (this editor adds attributes the other device does not write), not
// because anyone typed.
//
// So a save whose document is exactly what the last pull left is skipped.
// Anything typed since makes the document differ, and saves as always.

/**
 * @param {object} args
 * @param {string} args.json - the editor's document, serialised, about to be saved
 * @param {string|null} args.pulled - the document as the last pull left it, or null
 * @returns {boolean} true when the save would only send the pull back
 */
export function isEchoOfPull({ json, pulled }) {
  return pulled !== null && pulled !== undefined && json === pulled;
}

// AND WHAT DOES "THE SAME" MEAN, NOW THAT BLOCKS CARRY IDS? A page stored
// before 0.8.2 has no blockId; the editor that opened it gave every block a
// derived id as part of the load (src/lib/block-id.js). Compared raw, the
// stored copy and the editor's always differed, so every pull re-applied an
// untouched old page: content reset, caret moved, until it was edited once.
//
// So the stored copy is compared as a load would leave it: given the same
// derived ids the editor gave it (fillDerivedBlockIds keeps any id already
// stored), run through the editor's schema (which adds the default attrs a
// copy written elsewhere leaves out), and serialised with keys in a fixed
// order, because the editor writes attrs in schema order and the fill
// appends blockId last. The ids are not
// simply ignored: a pull that changed only an id (another device's edit
// settled a duplicate) is a real change, and an editor holding the old id
// would save it back over the new one.

/** JSON.stringify with every object's keys sorted, so key order never counts. */
export function stableStringify(value) {
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = v[k];
    return out;
  });
}

/**
 * The two serialised documents pullReload compares, like with like.
 * @param {object} args
 * @param {object} args.current - the editor's document (editor.getJSON())
 * @param {object} args.incoming - the stored document, parsed
 * @param {string|null|undefined} args.pageId - the open page, whose derived ids the editor holds
 * @param {(json: object, pageId: string) => object} args.fillIds - fillDerivedBlockIds
 * @param {(json: object) => object} [args.normalise] - json through the editor's
 *   schema (schema.nodeFromJSON(json).toJSON()); a copy the schema cannot
 *   read is compared as it is, and then differs, which applies it as before
 * @returns {{ current: string, incoming: string }}
 */
export function comparablePair({ current, incoming, pageId, fillIds, normalise }) {
  let filled = pageId ? fillIds(incoming, pageId) : incoming;
  if (normalise) {
    try { filled = normalise(filled); } catch { /* compared as it is */ }
  }
  return { current: stableStringify(current), incoming: stableStringify(filled) };
}
