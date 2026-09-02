// What the find bar says it found.
//
// Extracted from FindBar.svelte's template, where it was four inline
// branches nothing could reach: the component owns no match state (the
// FindReplace extension broadcasts `shizumu:find-state` and the bar renders
// it), so the only way to exercise the label was to mount the whole bar.
//
// Written for a real defect. `activeIdx` can be -1 WITH matches present.
// find-replace.js sets it to 0 on every `setFindQuery` (:89), but its
// doc-change branch (:96-102) carries `prev.activeIdx` forward and never
// promotes -1 back to 0 — so a query that matched nothing and then starts
// matching, because the user typed the word into the page, lands there and
// stays. The template tested `total > 0` alone and rendered
// `{activeIdx + 1} of {total}`, i.e. **"0 of 3"**: a match numbered zero
// that no arrow reaches, while no match carries the active highlight
// either (find-replace.js:115).
//
// The mobile shell reached the same answer independently
// (src/shell/find-strip-model.js) and diverged from this bar deliberately
// while the bug stood. They now agree.

/**
 * @param {string} query     what the writer typed, untrimmed
 * @param {number} total     matches in the document
 * @param {number} activeIdx the current match, or -1 for none
 * @returns {string} the label, "" when there is nothing to say
 */
export function findCountLabel(query, total = 0, activeIdx = -1) {
  // Nothing typed. Deliberately NOT "no matches": an untyped field
  // reporting a failed search accuses the writer of something they have
  // not done, on the frame the bar opens.
  //
  // Not trimmed, either. collectMatches (find-replace.js:28-45) searches
  // the raw string, so a query of spaces really does highlight every space
  // in the document; reading it as "untyped" would blank the label while
  // the page lit up.
  if (!query) return "";

  if (total === 0) return "no matches";

  // A match is current: the ordinary case, counting from one.
  if (activeIdx >= 0) return `${activeIdx + 1} of ${total}`;

  // Matches exist but none is current — the state that used to read
  // "0 of n". Say how many were found; `next` is the way to the first.
  return total === 1 ? "1 match" : `${total} matches`;
}
