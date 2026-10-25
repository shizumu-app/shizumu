// pin-artifact-view.js — what a pin's own screen shows: the writing it
// cached, in the shape an editor will take; what the bar calls it; and
// the rows underneath — the way back to where it came from, the carry,
// the unpin. Where it came from and WHEN is the provenance line, which is
// provenance.js's; what the two fields open holding is pin-draft.js's.
//
// §2 said "a row opens an actions sheet; note/artifact editing opens a
// full-detent sheet with its field above the keyboard." The note half of
// that sentence shipped and the artifact half did not, and the gap was
// wider than an editor: `pinNoteDraft` returns null for every pin whose
// content is a doc, so the old sheet offered those rows `rename` and
// nothing else. A board, a table, a chart and an image were each a row
// with a title and no way to see what was under it — on the surface
// CLAUDE.md calls "a pointer back into your thinking". The screen this
// module serves closed that gap as a READING surface; the second device
// pass then made the row open it directly and made the writing on it
// editable (PinEditor), and the sheets went. The doc this module shapes
// is what that editor mounts on.
//
// ── THE CACHE IS THE ARTIFACT ─────────────────────────────────────────
//
// CLAUDE.md's pin pointer clause: "a pin is a pointer plus a frozen
// snapshot: it caches its content and keeps a reference to its source
// page… When the source page is deleted, the pin survives orphaned with
// its cache intact." So `pinArtifactDoc` reads `pin.content` and never
// re-fetches the source. An orphaned pin has no source to re-fetch, and a
// live one would show the writer today's source under a heading that says
// it is what they kept — which is the one thing a frozen snapshot must not
// do.
//
// ── THE SHAPE THE RUST SIDE ACTUALLY STORES ───────────────────────────
//
// `refresh_pin_caches` stores BARE-NODE JSON — a `table` node, a `list`
// node — not a doc wrapper, while older pins are doc-shaped from the
// pre-rewrite sync code, and a note's content is a plain string. Three
// shapes, and `renderDocHTML` accepts exactly one of them: its second
// guard is `if (!doc || doc.type !== "doc") return ""`. Handing it a bare
// table node returns an empty string and paints a blank screen with no
// error anywhere — the defect this module exists to make impossible, and
// the reason this conversion is here with tests on it rather than inline
// in the screen. PinArtifactModal.svelte's own `parseContent` draws the
// same three-way fork for the same reason; this is that fork, reading
// rather than mounting.
//
// ── AND THE SCHEMA IT STORED THEM UNDER ───────────────────────────────
//
// The three migrations are applied for the same reason the desktop modal
// applies them, which is not tidiness: `READONLY_EXTENSIONS` no longer
// carries `taskList` / `bulletList` / `orderedList` / `algorithmBlock`, so
// `generateHTML` THROWS on a pin captured before those migrations —
// `renderDocHTML` catches it and returns "". A pin is a frozen snapshot by
// definition, so the oldest pins in a writer's tree are exactly the ones
// most likely to hold the oldest schema. Without this, a list pinned last
// year opens blank.

import { migrateListSchema } from "../lib/extensions/migrate-list-schema.js";
import { migrateQASchema } from "../lib/extensions/migrate-qa-schema.js";
import { migrateRecipeSchema } from "../lib/extensions/migrate-recipe-schema.js";
import { pinKind } from "../lib/pin-display.js";

/** Mirrors pin-draft.js's copy of pin-display.js's private
 *  `looksLikeJSON`, and for the same reason it was copied there: it is a
 *  two-line guard against legacy rows whose content was stored as raw
 *  serialized JSON, and the original is private on purpose. */
function looksLikeJSON(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  return trimmed[0] === "{" || trimmed[0] === "[";
}

/** Plain text → a doc, one paragraph per line.
 *
 *  A note's content is a string, and the screen renders through the same
 *  static renderer everything else goes through rather than through a
 *  second `<p>` branch in the markup: one rendering path means one set of
 *  prose rules (src/styles/prose.css) and one answer to what a long line
 *  does. An empty line becomes an empty paragraph rather than being
 *  dropped, because a writer's blank line between two thoughts is part of
 *  what they kept. */
function textDoc(text) {
  const lines = text.split("\n");
  return {
    type: "doc",
    content: lines.map((line) =>
      line.length > 0
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : { type: "paragraph" },
    ),
  };
}

/**
 * The doc the screen renders — the pin's cached content, in the one shape
 * `renderDocHTML` accepts, or null when there is nothing readable.
 *
 * Null is the screen's empty state, and it is reachable three ways: a pin
 * with no content at all, a pin whose content is an empty string, and a
 * pin whose content LOOKS like JSON and does not parse. The third is the
 * case worth naming — `pinNoteDraft` withholds the editor's body field for
 * exactly it, because showing the string would put schema on screen, and
 * showing it here would do the same with no field to blame.
 *
 * @param {any} pin
 * @returns {object|null} a `{type: "doc"}` node, migrated to today's schema.
 */
export function pinArtifactDoc(pin) {
  if (!pin) return null;
  const raw = pin.content;
  if (raw == null) return null;

  let parsed = null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (!looksLikeJSON(raw)) return textDoc(raw);
    try {
      parsed = JSON.parse(raw);
    } catch {
      // JSON-shaped and unparseable. Not rendered as text: the writer
      // would be shown the serializer's braces and told they kept them.
      return null;
    }
  } else if (typeof raw === "object") {
    parsed = raw;
  } else {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;

  const doc =
    parsed.type === "doc"
      ? parsed
      : typeof parsed.type === "string"
        ? { type: "doc", content: [parsed] }
        : null;
  if (!doc) return null;

  // Same order the desktop modal applies them in. Each is idempotent on
  // already-current JSON, so a pin captured yesterday pays three tree
  // walks and changes nothing.
  return migrateQASchema(migrateRecipeSchema(migrateListSchema(doc)));
}

/**
 * The nav band's line: `pin`, one word, and nothing under it.
 *
 * THIS REVERSES A CONSIDERED CHOICE, so here is the whole history rather
 * than a replacement that looks like nobody thought about it before.
 *
 * The bar named the pin's own label until the second device pass, with the
 * kind in an eyebrow over a Title that said the label again — on a phone,
 * the same line twice, a thumb's width apart ("pin page detail not well
 * structured"). The fix then was to put the KIND in the bar: the title was
 * a field now, so the bar could say the one thing a field cannot — what
 * the writer is looking at — using `pinKind`'s word (text, tasks, table,
 * image), which is the chip the desktop's row shows.
 *
 * The fifth device pass asked for this screen to be clean, and the bar
 * read `text` over a title field and a body that both said the pin's own
 * opening words. The duplication came from the title (pin-draft.js now
 * ends it), and the user's call on the bar was `pin`: it names the surface
 * the way `pins` and `memory` name theirs, and the kind is apparent from
 * the writing directly beneath it.
 *
 * WHAT IT COSTS, recorded so it can be weighed again: for an artifact that
 * has to render before it can be recognised — a chart, a board, a table —
 * the kind was a word of warning the writer got before the scroll. If that
 * turns out to matter, the eyebrow is where it goes, not the title.
 *
 * `pin` for no pin: a title, because NavBar with an empty one is a bare
 * back arrow over nothing. The host guards on the pin before pushing, so
 * it is the bar's answer for a state the app cannot currently produce.
 *
 * @param {any} pin
 * @returns {{title: string, subtitle: string}}
 */
export function pinArtifactHeader(pin) {
  // One answer for both: a pin and no pin look the same in the bar, which
  // is right — the bar names the surface, and the surface is the same one.
  return { title: "pin", subtitle: "" };
}

/**
 * The rows under the writing, in order: the way back, the carry, the
 * unpin. Each carries its `kind` (row-kind.js's words) because the screen
 * draws a chevron on the push and none on the two actions, and a row
 * that knows what it is should say so rather than leave the screen to
 * guess from its id.
 *
 * THE ACTIONS MOVED HERE FROM THE ROW'S SHEET, and the old sheet's own
 * header said they would: "if reading turns out to be what writers come
 * here for and unpinning the rarity, the row should open this screen and
 * the actions should move" — a measurement, and the second device pass
 * made it. The arguments each row carried come with it.
 *
 * ── the way back ─────────────────────────────────────────────────────
 *
 * The return beat's other half: the page the writing was taken from. An
 * orphaned pin has no source and is offered none — the page is gone from
 * the database, so the row would open the reading view's "this page did
 * not open" every time. The facts that used to open this list (`from
 * <trail>`, `source removed`) are the provenance line now (provenance.js).
 *
 * ── carry forward is withheld where the query would ignore it ────────
 *
 * `update_pin_auto_insert` writes a column; `get_carry_forward_pins` is
 * what reads it, and its WHERE clause is narrower than the toggle looks
 * (commands.rs:3897-3899):
 *
 *     WHERE so.lineage_id = ?1 AND so.auto_insert = 1
 *       AND so.status != 'orphaned'
 *
 * So the flag does nothing at all for a pin with no trail (`lineage_id`
 * NULL never equals an id) and nothing for an orphaned pin whatever trail
 * it is on. Offering the row there would be a control that writes a
 * column and changes no behaviour the writer can ever observe. The label
 * names what the TAP does — `carry forward` / `stop carrying forward` —
 * because a row reading the pin's current state would be a value, not an
 * action.
 *
 * ── unpinning is not a deletion ──────────────────────────────────────
 *
 * CLAUDE.md's return beat: "Pins sink too, if you let them go: unpinning
 * is part of the model, not a failure of it." So the row says `unpin`,
 * not `delete`, its kind is `action` rather than `destructive` (the
 * accent Row reserves for damage would frame a normal beat of the model
 * as damage), and it is last — the row that removes something is not the
 * row a thumb lands on by accident.
 *
 * ── what is NOT here, from the desktop's PinArtifactModal ────────────
 *
 * THE DIVERGENCE RESOLUTION. The banner's two buttons keep or overwrite
 * the snapshot, and `update` re-fetches the source page, walks it for the
 * node carrying this pin's id, and writes whatever it finds over what the
 * writer kept — with an `alert()` on every miss. A destructive decision
 * on a kept artifact; the FACT stays (`changed elsewhere`, on the
 * provenance line), and the two buttons are the next thing this surface
 * owes.
 *
 * THE SCOPE ACTIONS (share up / make global / restore) arrived as one
 * row, `trail`: its value names the pin's trail and a tap opens every
 * trail it could be on instead (trail-manage.js's `pinTrailRows`). The
 * laptop's three moves are particular rows of that list. The row is
 * offered only when the host hands `trail` (the value to show), because
 * only a host holding the trails list can open the picker — a row with
 * nothing behind it is the one thing these rows must never be.
 *
 * THE BACKLINKS need a list this shell never fetches; memory's own
 * subject. `open file` for an attachment pin: `attachmentOpen` has no
 * caller anywhere in this shell, so a tap wired to it would be the
 * first, unproven.
 *
 * @param {any} pin
 * @param {{trail?: string|null}} [options]  `trail`: the pin's trail as
 *   the row shows it, or null to withhold the row
 * @returns {{id: string, label: string, value?: string,
 *            kind: "push"|"action"|"choice"}[]}
 */
export function pinArtifactRows(pin, { trail = null } = {}) {
  if (!pin) return [];
  const orphaned = pin.status === "orphaned";
  const rows = [];

  if (!orphaned && typeof pin.source_page_id === "string" && pin.source_page_id) {
    rows.push({ id: "source", label: "open the page it came from", kind: "push" });
  }
  // Orphans included: the pin still lives on a trail, and moving it needs
  // no source page. A choice, not a push — it opens a sheet, not a screen.
  if (typeof trail === "string") {
    rows.push({ id: "trail", label: "trail", value: trail, kind: "choice" });
  }
  if (pin.lineage_id && !orphaned) {
    rows.push({
      id: "carry",
      label: pin.auto_insert ? "stop carrying forward" : "carry forward",
      kind: "action",
    });
  }
  rows.push({ id: "unpin", label: "unpin", kind: "action" });
  return rows;
}
