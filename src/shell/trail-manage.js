// Managing a trail on the phone: what its screen offers, where it may move,
// what a rename means, and which trail a pin may be put on.
//
// trail-sheet-model.js's header names where this belongs — "management
// belongs in memory, not on the writing surface" — and this is that half
// arriving. The page's own trail sheet still only chooses; renaming,
// moving under another trail and deleting live on a trail screen pushed
// from memory's trails sheet. Fold stays laptop-only.
//
// ── the same commands as the laptop ───────────────────────────────────
//
// LineageSelector (the laptop's picker) calls renameLineage,
// setLineageParent and deleteLineage, and so does the phone. Its move
// picker offers every trail but the one moving and its descendants, plus
// top level; `moveUnderRows` is that rule. Its delete defaults to
// "unlink pages" (`deleteLineage(id, null)`), and that is the delete the
// phone makes: pages stay and lose the trail, trails inside it move up to
// its parent, its pins move up with them (commands.rs `delete_lineage`).
//
// ── every label here is user-facing copy ──────────────────────────────
//
// Lowercase, no exclamation marks, trail names shown exactly as typed
// (trail-sheet-model.js's rule: nothing prepends an article or appends a
// noun to a name). The words are ones the app already uses: `top level`
// is the laptop's, `no trail` is memory's heading for pins on no trail
// (memory-model.js), `this pin` is the page sheet's `this page` for the
// other surface that can sit on a trail.

import { lineagePath } from "../lib/trail-utils.js";
import { orderedTrails, UNTRAILED } from "./trail-index.js";

const NAME_MAX = 36;
const TOP_LEVEL = "top level";
const NO_TRAIL = "no trail";
/** Beside the place a trail already sits, in the move sheet. */
const NOW = "now";
/** Beside the trail a pin is already on, in the pin's trail sheet. */
const THIS_PIN = "this pin";

/**
 * Every trail under `id`, at any depth. Bounded by `seen`, so a malformed
 * row set with a cycle in it terminates (trail-index.js's defence, for its
 * reason); in such a set the trail can come back as its own descendant,
 * which only makes the move sheet offer less.
 *
 * @param {string} id
 * @param {Array<{id: string, parent_id?: string|null}>} lineages
 * @returns {Set<string>}
 */
export function descendantsOf(id, lineages = []) {
  const rows = Array.isArray(lineages) ? lineages.filter((l) => l && l.id) : [];
  const out = new Set();
  const queue = [id];
  const seen = new Set();
  while (queue.length) {
    const parent = queue.shift();
    if (seen.has(parent)) continue;
    seen.add(parent);
    for (const l of rows) {
      if (l.parent_id === parent && !out.has(l.id)) {
        out.add(l.id);
        queue.push(l.id);
      }
    }
  }
  return out;
}

/**
 * The move-under sheet's rows: `top level`, then every trail that is not
 * this one or under it, in tree order. Where the trail already sits is
 * listed, marked `now` and inert — the convention the page sheet's
 * `this page` keeps — rather than hidden, so the writer can see where it
 * is while choosing where it goes.
 *
 * @param {object} args
 * @param {any} args.lineage  the trail being moved
 * @param {any[]} args.lineages
 * @returns {Array<{id: string, label: string, value: string,
 *                  parentId: string|null, selectable: boolean}>}
 */
export function moveUnderRows({ lineage = null, lineages = [] } = {}) {
  if (!lineage?.id) return [];
  const rows = Array.isArray(lineages) ? lineages.filter((l) => l && l.id) : [];
  const ids = new Set(rows.map((l) => l.id));
  // A parent the list does not hold is no parent (trail-index.js's rule),
  // so a trail whose parent vanished reads as top level here too.
  const current = lineage.parent_id && ids.has(lineage.parent_id) ? lineage.parent_id : null;
  const blocked = descendantsOf(lineage.id, rows);
  blocked.add(lineage.id);

  const out = [
    {
      id: "top",
      label: TOP_LEVEL,
      value: current === null ? NOW : "",
      parentId: null,
      selectable: current !== null,
    },
  ];
  for (const l of orderedTrails(rows)) {
    if (blocked.has(l.id)) continue;
    const here = l.id === current;
    out.push({
      id: l.id,
      label: cut(clean(l.name) || "untitled"),
      value: here ? NOW : cut(parentPath(l, rows)),
      parentId: l.id,
      // Continuous trails included, as on the laptop: a continuous parent
      // does not share its document with its children.
      selectable: !here,
    });
  }
  return out;
}

/**
 * The rows under a trail's name on its screen: `move under…` with where
 * the trail lives now, then `delete trail`, destructive and last — the
 * row that takes something away is not the one a thumb lands on first.
 *
 * `move under…` is withheld when its sheet would hold no choice: a lone
 * top-level trail can only go where it already is.
 *
 * @param {object} args
 * @param {any} args.lineage
 * @param {any[]} args.lineages
 * @returns {Array<{id: "move"|"delete", label: string, value: string,
 *                  kind: "choice"|"destructive"}>}
 */
export function trailScreenRows({ lineage = null, lineages = [] } = {}) {
  if (!lineage?.id) return [];
  const rows = [];
  if (moveUnderRows({ lineage, lineages }).some((r) => r.selectable)) {
    const parent = lineage.parent_id
      ? (lineages ?? []).find((l) => l?.id === lineage.parent_id)
      : null;
    rows.push({
      id: "move",
      label: "move under…",
      value: parent ? cut(clean(parent.name) || "untitled") : TOP_LEVEL,
      // A choice: its value names where the trail is, and a tap opens the
      // places it could be instead. No chevron, because a sheet is not a
      // screen (row-kind.js).
      kind: "choice",
    });
  }
  rows.push({ id: "delete", label: "delete trail", value: "", kind: "destructive" });
  return rows;
}

/**
 * What committing the name field means.
 *
 *   none    the name it already has (after trimming) — nothing is written
 *   revert  an emptied field — the old name goes back; a trail with no
 *           name is a row nobody can tell from another (`lineage_name_empty`
 *           on the backend)
 *   taken   another trail carries it, compared without case — the same
 *           rule the trail sheet keeps, and the same reason: the writer can
 *           see that trail in the list, so the round trip teaches nothing
 *   rename  anything else, trimmed
 *
 * @param {object} args
 * @param {any} args.lineage
 * @param {any[]} args.lineages
 * @param {string} args.typed
 * @returns {{action: "none"|"revert"|"taken"|"rename", name?: string}}
 */
export function renameIntent({ lineage = null, lineages = [], typed = "" } = {}) {
  if (!lineage?.id) return { action: "none" };
  const name = clean(typed);
  if (!name) return { action: "revert" };
  if (name === lineage.name) return { action: "none" };
  const taken = (Array.isArray(lineages) ? lineages : []).some(
    (l) => l && l.id !== lineage.id && clean(l.name).toLowerCase() === name.toLowerCase(),
  );
  if (taken) return { action: "taken", name };
  return { action: "rename", name };
}

/** The laptop's error copy (LineageSelector's ERROR_COPY) for the codes a
 *  phone can reach, and one plain line for anything else. */
const ERROR_COPY = {
  lineage_name_empty: () => "name cannot be empty",
  lineage_name_taken: (name) => `a trail named “${name}” already exists`,
  lineage_not_found: () => "trail no longer exists",
  parent_not_found: () => "target trail no longer exists",
  cannot_self_parent: () => "cannot move under itself",
  cannot_move_under_descendant: () => "cannot move under its own descendant",
};

/**
 * @param {unknown} err
 * @param {string} [name]
 * @returns {string}
 */
export function trailErrorText(err, name = "") {
  const code = typeof err === "string" ? err : (err && /** @type {any} */ (err).message) || "";
  const copy = ERROR_COPY[code];
  return copy ? copy(name) : "that did not save. try it again.";
}

/** The delete confirmation's one row: it names the trail, the safeguard the
 *  pages sheet's delete row uses (page-picker.js) — a row that says which
 *  trail it deletes cannot be pressed believing it deletes another. */
export function trailDeleteLabel(lineage) {
  return `delete “${cut(clean(lineage?.name) || "untitled")}”`;
}

/**
 * What the confirmation says happens, before the row that does it. The
 * three facts `delete_lineage` makes true with no target: the pages stay
 * and lose the trail, and the trails inside it and its pins move up to its
 * parent — or to the top level and to no trail, for a root.
 *
 * @param {object} args
 * @param {any} args.lineage
 * @param {any[]} args.lineages
 * @returns {string}
 */
export function trailDeleteNote({ lineage = null, lineages = [] } = {}) {
  const parent = lineage?.parent_id
    ? (lineages ?? []).find((l) => l?.id === lineage.parent_id)
    : null;
  const up = parent ? `“${cut(clean(parent.name) || "untitled")}”` : null;
  return up
    ? `its pages stay in memory, on no trail. the trails inside it and its pins move to ${up}.`
    : `its pages stay in memory, on no trail. the trails inside it move to the top level, and its pins to no trail.`;
}

/**
 * The pin's trail sheet: `no trail`, then every trail in tree order. The
 * pin's own is marked `this pin` and inert. `lineageId` is what
 * `updatePinScope` is handed — null for no trail, which is the laptop's
 * "make global" (SharedObjectsPanel's `applyScopeAction`), said in the
 * phone's word for it.
 *
 * Every trail, not only the laptop's three scope moves (share up, make
 * global, restore): those are shortcuts to particular rows of this list,
 * and the command they call takes any trail.
 *
 * @param {object} args
 * @param {any} args.pin
 * @param {any[]} args.lineages
 * @returns {Array<{id: string, label: string, value: string,
 *                  lineageId: string|null, selectable: boolean}>}
 */
export function pinTrailRows({ pin = null, lineages = [] } = {}) {
  const rows = Array.isArray(lineages) ? lineages.filter((l) => l && l.id) : [];
  const current = pin?.lineage_id ?? null;
  const out = [
    {
      id: "none",
      label: NO_TRAIL,
      value: current === null ? THIS_PIN : "",
      lineageId: null,
      selectable: current !== null,
    },
  ];
  for (const l of orderedTrails(rows)) {
    const here = l.id === current;
    out.push({
      id: l.id,
      label: cut(clean(l.name) || "untitled"),
      value: here ? THIS_PIN : cut(parentPath(l, rows)),
      lineageId: l.id,
      selectable: !here,
    });
  }
  return out;
}

/** The pin screen's `trail` row value: the trail's name, `no trail`, or
 *  nothing while the name is not known — a blank beats a wrong word. Null
 *  for no pin, which withholds the row (pin-artifact-view.js).
 *
 *  @param {{pin: any, trailName?: string|null}} args
 *  @returns {string|null} */
export function pinTrailValue({ pin = null, trailName = null } = {}) {
  if (!pin) return null;
  if (!pin.lineage_id) return NO_TRAIL;
  return trailName ? cut(clean(trailName)) : "";
}

/**
 * What a tap on a row of memory's trails sheet does.
 *
 * The row SCOPES memory, as it always has: choosing a trail to look at is
 * the sheet's job and stays one tap. The row memory is already showing
 * used to be inert; for a trail it now opens that trail's screen. The tap
 * on the scope that is on had nothing to do, so giving it the trail's
 * screen costs no existing gesture, and a Row is one button — a second
 * control inside each row would put two targets in one 44px line beside
 * the thumb that scopes.
 *
 * `all trails` and `untrailed` are scopes, not trails: nothing to rename,
 * move or delete, so showing they stay inert.
 *
 * @param {{id: string|null, selected: boolean}} row  a `trailIndexRows` row
 * @returns {"scope"|"manage"|null}
 */
export function scopeRowAction(row) {
  if (!row) return null;
  if (!row.selected) return "scope";
  if (row.id == null || row.id === UNTRAILED) return null;
  return "manage";
}

function parentPath(lineage, lineages) {
  return lineagePath(lineage.id, lineages)
    .filter((l) => l.id !== lineage.id)
    .map((l) => clean(l.name))
    .filter(Boolean)
    .join(" › ");
}

function cut(text) {
  if (text.length <= NAME_MAX) return text;
  return `${text.slice(0, NAME_MAX).trimEnd()}…`;
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
