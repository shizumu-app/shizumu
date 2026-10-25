// insert-menu.js — what the insert sheet offers, from the slash menu's own
// list.
//
// This file was insert-filter.js, a substring rule over eleven rows the
// host wrote out by hand. The fourth device pass ended the hand-written
// list: "blocks list does not show similar to /, task as an example". A
// writer who knows `/task` typed `task` into the finder and got nothing —
// §3 had collapsed task, bullet and numbered into one `list` row and the
// three headings into one `heading`, because eleven rows at 44px overfilled
// the half detent the sheet opened at. Both halves of that reason are gone:
// the sheet takes the full detent and has a finder over it (the third
// device pass), so length costs a scroll nobody has to make.
//
// So the sheet IS the slash menu: its titles, its sections, its
// descriptions, in its order. Two surfaces for one question stay one
// answer, and a command added upstream arrives here without anybody
// remembering to add it.
//
// ── what the sheet leaves out, and why each one ───────────────────────
//
// The MARKS — `strikethrough`, `code`. They act on a selection, not on the
// document's shape, and the selection strip carries them (toolbar-model.js).
// A row that italicises the word behind a sheet is not an insert.
//
// `text` (remove marker). It converts the line the caret is in, which is
// `turn into`'s question and has its own sheet (turn-into-model.js).
// Offering it here would put one action in two places with two names.
//
// Everything else the slash menu makes is a block, so everything else is
// here — including the four §3 never listed (`heading 2`, `heading 3`,
// `decision`, `blockquote`, `divider`), which were unreachable from this
// phone except by typing `/`.
//
// ── the rows the SHEET owns ───────────────────────────────────────────
//
// `paragraph` has no slash command — on the desktop you make one by
// pressing Enter — and the sheet has carried it since P2f for the writer
// who came here to add a plain line. It heads `structure`, where a heading
// would put it.
//
// ── the items are PASSED IN ───────────────────────────────────────────
//
// suggestion-strip-model.js's rule, for its reason: a model that imported
// the editor's command list could no longer be tested against plain
// objects, and its tests would then be asserting the editor's list rather
// than this file's decisions. The host imports `commandItems` and hands it
// over.

/** The order the sections come in, which is the order the slash menu's own
 *  list declares them in (slash-commands.js). Not alphabetical and not
 *  invented here: a writer who has seen the menu should find the same
 *  shape. A section the items do not carry is simply never emitted. */
const SECTION_ORDER = Object.freeze(["structure", "lists", "inline & code", "shizumu blocks"]);

/** Titles the sheet does not offer — see the header for each. */
const WITHHELD = new Set(["strikethrough", "code", "text"]);

/** The one row with no slash command behind it. Its `id` is what the host
 *  keys its own insert on, and it is deliberately NOT a slash title: the
 *  host's table looks `paragraph` up before it asks `SLASH_BY_TITLE`. */
const PARAGRAPH = Object.freeze({
  id: "paragraph",
  label: "paragraph",
  value: "a plain line",
  section: "structure",
});

function matches(row, query) {
  if (!query) return true;
  return (
    row.label.toLowerCase().includes(query) ||
    (typeof row.value === "string" && row.value.toLowerCase().includes(query))
  );
}

/**
 * The sheet's rows, grouped into the slash menu's sections.
 *
 * SUBSTRING, OVER THE DESCRIPTION TOO. `checkbox` finds `task`, `ordered`
 * finds `numbered`, `rows` finds `table` — the words a writer reaches for
 * are as often the description's as the title's, and the description is on
 * screen beside the row, so a match on it is a match the writer can see.
 * A blank query keeps everything, in order; nothing is ever re-sorted by
 * how well it matched, because rows that move under a thumb between
 * keystrokes are rows that get mis-tapped.
 *
 * @param {object} args
 * @param {Array<{title: string, description?: string, section?: string}>} args.items
 *   the editor's own `commandItems`.
 * @param {string} [args.query]  what is in the finder.
 * @returns {Array<{section: string, rows: Array<{id: string, label: string, value: string}>}>}
 */
export function insertMenuSections({ items = [], query = "" } = {}) {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  const rows = [PARAGRAPH];
  for (const item of Array.isArray(items) ? items : []) {
    const title = typeof item?.title === "string" ? item.title : "";
    if (!title || WITHHELD.has(title)) continue;
    rows.push({
      id: title,
      label: title,
      value: typeof item.description === "string" ? item.description : "",
      section: typeof item.section === "string" ? item.section : "shizumu blocks",
    });
  }

  const out = [];
  for (const section of SECTION_ORDER) {
    const kept = rows
      .filter((row) => row.section === section && matches(row, q))
      .map(({ id, label, value }) => ({ id, label, value }));
    if (kept.length > 0) out.push({ section, rows: kept });
  }
  return out;
}

/**
 * The row return runs: the first one left, reading the sections in order.
 *
 * Null when the query matches nothing, which is the sheet's own empty
 * state rather than a guess at what was meant.
 *
 * @param {ReturnType<typeof insertMenuSections>} sections
 * @returns {{id: string, label: string, value: string}|null}
 */
export function firstInsertRow(sections = []) {
  for (const group of sections) {
    if (group.rows.length > 0) return group.rows[0];
  }
  return null;
}
