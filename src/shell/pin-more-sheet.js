// pin-more-sheet.js — what a pin row's `more` sheet offers on the phone,
// and the question it asks before an unpin.
//
// Ruling 6 (spec 2026-11-01): the phone keeps its own pin row but takes
// its action list from the desktop's pure module, so a pin offers the same
// things in the same words wherever you meet it. `pinRowActions` gives two
// worded actions on the row (`open`, `put on page`) and the rest behind
// `more`: carry forward on/off, the move choices, and `unpin…`, last and
// asking first. On the desktop `more` is a menu; the shell's one overlay is
// a Sheet, so here it is a sheet of rows.
//
// THE CONFIRM IS THE SAME SHEET, re-asked: `unpin…` turns the rows into the
// question (`unpin <title>? the writing stays on its page.`) with `keep`
// first and `unpin` last, so the row a thumb lands on first is the one that
// changes nothing — the order the disconnect sheet already uses. Dismissing
// the sheet is a keep too.
//
// Rename is left out (`canRename: false`): the pin's own screen renames it,
// where the title's home is known, as memory's menu does on the desktop.

import { pinRowActions } from "../lib/pin-row-actions.js";

/**
 * @param {any} pin
 * @param {{ lineages?: any[], title?: string, confirming?: boolean }} ctx
 * @returns {{ note: string|null, rows: Array<{ id: string, key: string, label: string, kind: "action"|"choice", target?: string|null }> }}
 */
export function pinMoreSheet(pin, { lineages = [], title = "", confirming = false } = {}) {
  if (!pin) return { note: null, rows: [] };
  const { more } = pinRowActions(pin, { lineages, title, canPutOnPage: false, canRename: false });
  if (confirming) {
    const unpin = more.find((a) => a.id === "unpin");
    const ask = unpin?.confirm;
    return {
      note: ask?.prompt ?? null,
      rows: [
        { id: "keep", key: "keep", label: ask?.no ?? "keep", kind: "action" },
        { id: "unpinNow", key: "unpinNow", label: ask?.yes ?? "unpin", kind: "action" },
      ],
    };
  }
  return {
    note: null,
    rows: more.map((a, i) => ({
      id: a.id,
      key: `${a.id}-${i}`,
      label: a.label,
      kind: a.id === "move" ? "choice" : "action",
      ...(a.id === "move" ? { target: a.target ?? null } : {}),
    })),
  };
}
