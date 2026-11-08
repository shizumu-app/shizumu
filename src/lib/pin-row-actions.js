// pin-row-actions.js — which actions a pin row offers, in what words, and
// which of them asks first.
//
// THE BUG. Each row in the pins panel carried four unlabelled glyphs,
// ⋯ ↻ ↓ ×, with delete (×) sitting directly beside insert (↓): one slip
// of the pointer from putting a pin on the page was unpinning it, with no
// confirmation (walk-through, 2026-11-01). Spec §1 and ruling 6: two worded
// actions on the row, `open` and `put on page`; everything else behind ⋯,
// with unpin last and asking first.
//
// One list, for every surface that lists pins: the desktop panel and
// memory render it through PinRow, and the phone's own row takes the same
// list (ruling 6), so a pin offers the same things wherever you meet it.

/**
 * @typedef {{ id: string, label: string, ariaLabel?: string, confirm?: { prompt: string, yes: string, no: string }, target?: string|null, group?: string }} PinAction
 */

/**
 * The move-to-trail choices (the panel's old scope menu, unchanged in what
 * it offers): share up to the parent trail, make it global, or put it back
 * on the trail of the page it came from.
 *
 * @param {any} pin
 * @param {Array<{id: string, name: string, parent_id?: string|null}>} lineages
 * @returns {PinAction[]}
 */
export function pinMoveActions(pin, lineages = []) {
  const byId = new Map((lineages || []).map((l) => [l.id, l]));
  const own = pin?.lineage_id ? byId.get(pin.lineage_id) : null;
  const parent = own?.parent_id ? byId.get(own.parent_id) : null;
  const out = [];
  if (parent) out.push({ id: "move", label: `move up to ${parent.name}`, target: parent.id, group: "move" });
  if (pin?.lineage_id) out.push({ id: "move", label: "move to everywhere", target: null, group: "move" });
  const birth = pin?.source_page_lineage_id ? byId.get(pin.source_page_lineage_id) : null;
  if (birth && birth.id !== pin.lineage_id) {
    out.push({ id: "move", label: `move back to ${birth.name}`, target: birth.id, group: "move" });
  }
  return out;
}

/**
 * Whether the carry-forward switch belongs in the menu. Carry-forward
 * injects only pins a trail owns (get_carry_forward_pins: WHERE
 * so.lineage_id = ?1, a String, never NULL), so on a global pin the switch
 * would change nothing a writer could see. It still shows when it is
 * already ON, so a pin switched on before it was made global can be
 * switched off.
 */
export function offersCarryForward(pin) {
  return !!(pin?.lineage_id || pin?.auto_insert);
}

/**
 * @param {any} pin
 * @param {{ lineages?: any[], title?: string, canPutOnPage?: boolean, canRename?: boolean }} ctx
 * @returns {{ primary: PinAction[], more: PinAction[] }}
 */
export function pinRowActions(pin, { lineages = [], title = "", canPutOnPage = true, canRename = true } = {}) {
  const name = (title || "").trim() || "this pin";
  const primary = [{ id: "open", label: "open", ariaLabel: `open ${name}` }];
  if (canPutOnPage) primary.push({ id: "putOnPage", label: "put on page", ariaLabel: `put ${name} on this page` });

  const more = [];
  if (offersCarryForward(pin)) {
    more.push(
      pin.auto_insert
        ? { id: "carry", label: "stop carrying forward", group: "carry" }
        : { id: "carry", label: "carry forward to new pages", group: "carry" },
    );
  }
  if (canRename) more.push({ id: "rename", label: "rename", group: "edit" });
  more.push(...pinMoveActions(pin, lineages));
  more.push({
    id: "unpin",
    label: "unpin…",
    group: "unpin",
    confirm: { prompt: `unpin ${name}? the writing stays on its page.`, yes: "unpin", no: "keep" },
  });
  return { primary, more };
}
