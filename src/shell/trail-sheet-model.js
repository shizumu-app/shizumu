// What the trail sheet offers, and what it declines to offer.
//
// The desktop's picker is `LineageSelector` — 1272 lines that also rename,
// re-parent, fold and delete trails, and whose `onLineageChange` lands in
// `Page.svelte`'s seven-branch `handleLineageChange`. The shell wants that
// file's DECISIONS, not that file. This module is the decisions.
//
// ── what a phone's trail sheet is for: assignment ─────────────────────
//
// CLAUDE.md's context clause is the whole product argument for this sheet:
// "a new page starts empty. a trail is for a project, not a day… choose a
// trail and the page picks up context: the pins you already kept there,
// already on the page." Choosing is the verb. Everything else the desktop
// picker does to a trail — renaming it, moving it under another, folding
// two together, deleting one — is trail MANAGEMENT, and spec §2 already
// has a home for that: "Trails are a pushed index" in memory. Building a
// second home for it on the writing surface would be two answers to one
// question, which is the drift class this workstream keeps catching.
//
// WHERE MEMORY'S TRAILS LIVE NOW is a sheet on memory's own bar (the
// fifth device pass). It lists them and scopes memory to one, and since
// task 9e (2026-10-16) the row memory is already showing pushes that
// trail's screen: rename, move under, delete (trail-manage.js,
// TrailScreen.svelte). So management has landed, in memory, and this
// sheet still only chooses. Fold stays laptop-only.
//
// ── a continuous trail is listed and is not a choice ──────────────────
//
// A continuous trail owns one canonical living document, and every way of
// pointing this page at one is destructive or a navigation:
//
//   - the trail already has its document, and this page has writing on it:
//     the desktop MERGES (`appendPageToCanonical`), which deletes the
//     source row. Its own comment records what the neighbouring branch
//     would do wrong — "would delete the source row and destroy the
//     source trail's entire history".
//   - the trail already has its document and this page is empty: the
//     desktop navigates to the document and DELETES this page.
//   - the trail has no document yet: this page becomes it, permanently,
//     and CLAUDE.md's trail-exception clause is explicit that continuity
//     is "a deliberate refusal of sinking for that one focused topic".
//     A row in a bottom sheet is not how a writer makes that decision.
//
// So the rows are there and they are inert — which `Row` supports by
// construction ("a row that merely displays a value is inert markup,
// because putting it in the tab order promises an interaction it cannot
// deliver"). Listing them rather than hiding them buys two things: the
// writer can see the trail they made exists, and the create rule below
// can refuse a name that is already taken by one. Opening a living
// document is opening a page, which is what memory's trail index is for.
//
// ── the create row, and the two choices it does not make ──────────────
//
// A sheet with no trails in it and no way to make one is a sheet a fresh
// phone can never use, so the field creates. It creates the PLAIN kind
// only: discrete, top-level. Mode and parent are the two properties of a
// trail that are painful to change afterwards — a continuous trail's
// canonical cannot even be unlinked — and a phone sheet that defaulted
// both silently would be the surface where trails get made wrong. Both
// choices live where trails are managed.
//
// The row appears only for a name no trail already carries. The backend
// answers `lineage_name_taken` and the desktop renders that as an error;
// the phone does not need the round trip to know, and an error toast for
// a name the writer can see in the list two rows down is friction with
// nothing to teach.
//
// ── every label here is user-facing copy ──────────────────────────────
//
// Lowercase, present tense, fewest words. Trail names are the WRITER's
// words and are never decorated: P2f Task 2 found `"the book"` rendering
// as "the the book trail" and `"book trail"` as "the book trail trail",
// so nothing in this file prepends an article or appends a noun to a name.
// A name is shown exactly as it was typed, cut only when it will not fit.

import { lineagePath } from "../lib/trail-utils.js";
import { orderedTrails } from "./trail-index.js";

/** Characters of a trail name a row shows before it is cut. `Row`'s label
 *  has no ellipsis of its own, and a long name would push the value off a
 *  phone's width. The cut is display only — `name` below carries the whole
 *  string, so what gets created is what was typed. */
const NAME_MAX = 36;

/** Beside the trail this page is already on. */
const THIS_PAGE = "this page";

/** Beside a trail that owns one canonical document. It says what the trail
 *  IS rather than naming its mode — "continuous" is the column's word, and
 *  a writer who has never read the schema has no use for it. */
const LIVING_DOC = "living doc";

/**
 * @param {object} [args]
 * @param {Array<object>} [args.lineages]  `getLineages()` rows
 * @param {string|null} [args.currentLineageId]  the loaded page's trail
 * @param {string} [args.typedName]  what is in the sheet's field
 * @returns {Array<{
 *   id: string,
 *   kind: "create" | "create-continuous" | "nest" | "nest-target"
 *       | "unlink" | "trail" | "open-doc",
 *   label: string,
 *   value: string,
 *   name?: string,
 *   lineageId?: string|null,
 *   parentId?: string|null,
 *   pageId?: string,
 *   selectable: boolean,
 * }>}
 *   `label` is the trail's OWN name and `value` is where it lives — see
 *   `parentPath`. This block said three kinds and knew nothing about
 *   nesting for the whole of the release that shipped it.
 */
export function trailSheetRows({
  lineages = [],
  currentLineageId = null,
  typedName = "",
  nesting = false,
  pageEmpty = false,
  canonicalByLineage = {},
} = {}) {
  const rows = Array.isArray(lineages) ? lineages.filter((l) => l && l.id) : [];
  const name = clean(typedName);
  const out = [];

  const taken = rows.some((l) => clean(l.name).toLowerCase() === name.toLowerCase());

  // ── starting a trail inside another ──────────────────────────────────
  //
  // The device pass on 2026-10-04 found that a trail started on the phone
  // is always top-level: nothing here nests one, and nothing elsewhere on
  // the phone does either. The desktop has had it since LineageSelector —
  // a parent beside the name, `└ under: <name>`, any trail allowed.
  //
  // This does not reopen the line this file's header draws. Choosing where
  // a NEW trail begins is part of starting it; moving an existing trail
  // under another is management and stays in memory's index, unbuilt.
  //
  // Two steps rather than a second screen: a sibling to the create row
  // turns this same list into the parents, and the create row follows into
  // that mode as the top-level answer, so the way back is the row the
  // writer already meant to press.
  if (nesting && name && !taken) {
    out.push({
      id: "create",
      kind: "create",
      label: `start “${cut(name)}” at the top level`,
      value: "",
      name,
      parentId: null,
      selectable: true,
    });
    for (const lineage of orderedTrails(rows)) {
      out.push({
        id: lineage.id,
        kind: "nest-target",
        label: cut(clean(lineage.name)),
        value: cut(parentPath(lineage, rows)),
        lineageId: lineage.id,
        name,
        parentId: lineage.id,
        // Continuous trails included, as on the desktop: a continuous
        // parent does not share its document with its children, so there
        // is nothing here to protect, and a phone-only rule would be a
        // second answer to a question already answered.
        selectable: true,
      });
    }
    return out;
  }

  if (name && !taken) {
    out.push({
      id: "create",
      kind: "create",
      parentId: null,
      // A sentence that says what the tap does, in the trail verb, rather
      // than a caption. The third device pass: "the trail creation is not
      // clear — user taps text and no indication". `new trail: X` read as
      // a line describing the field; `start the trail “X”` reads as the
      // thing to press. The host draws it in the action tone.
      label: `start the trail “${cut(name)}”`,
      value: "",
      name,
      selectable: true,
    });
    // ── and the same trail as a living document ──────────────────────
    //
    // ONLY ON AN EMPTY PAGE, which is the whole of what makes this safe to
    // offer here. A continuous trail's canonical cannot be unlinked, so the
    // page that becomes one carries whatever was on it in permanently — and
    // on a phone that page is whatever happened to be open. On an empty one
    // the choice costs nothing, so the irreversible half has nothing to
    // take. The header's refusal is about the routes onto a trail that
    // ALREADY owns a document; this starts one that does not.
    if (pageEmpty) {
      out.push({
        id: "create-continuous",
        kind: "create-continuous",
        parentId: null,
        // "living doc" rather than "continuous": the mode's own word is
        // the column's, and a writer who has never read the schema has no
        // use for it. The same substitution LIVING_DOC makes below.
        label: `start “${cut(name)}” as a living doc`,
        value: "",
        name,
        selectable: true,
      });
    }
    // Only with somewhere to put it. The first trail on a phone has nowhere
    // to go but the top level, and a row that opens an empty list is a row
    // that lies about having choices.
    if (rows.length > 0) {
      out.push({
        id: "nest",
        kind: "nest",
        label: "start it inside a trail…",
        value: "",
        name,
        selectable: true,
      });
    }
  }

  // Only when there is a trail to come off. On an untrailed page this row
  // would name the state the page is already in, which is a row that can
  // do nothing — and the sheet's whole job is choices that act.
  if (currentLineageId) {
    out.push({
      id: "unlink",
      kind: "unlink",
      label: "no trail",
      value: "",
      lineageId: null,
      selectable: true,
    });
  }

  for (const lineage of orderedTrails(rows)) {
    const continuous = lineage.mode === "continuous";
    const current = lineage.id === currentLineageId;
    // ── a continuous trail with a document is a PLACE, not a target ────
    //
    // The header refuses every way of pointing THIS PAGE at a trail that
    // already owns a document, and that refusal stands: merging deletes
    // the source row, and the empty-page branch deletes this page. None of
    // them is here.
    //
    // Opening the document is a different verb. It loads the trail's
    // canonical and writes nothing at all, which is what the writer meant
    // by pressing a trail they keep a book in. Until this, the row said
    // "living doc" and did nothing when pressed — the one thing the
    // header says a row in this sheet must never be.
    //
    // With no canonical yet there is nothing to open, and the only other
    // meaning a tap could carry is the permanent one the create row above
    // makes deliberately and only on an empty page. So that row stays
    // unselectable rather than quietly becoming the irreversible choice.
    const canonical = continuous ? (canonicalByLineage?.[lineage.id] ?? null) : null;
    const openable = continuous && !current && !!canonical;
    out.push({
      id: lineage.id,
      kind: openable ? "open-doc" : "trail",
      label: cut(clean(lineage.name)),
      // The state words outrank the path when both could be said: "this
      // page" and "living doc" are what the row can DO, and where a trail
      // lives is context for a row still being chosen between.
      value: current ? THIS_PAGE : continuous ? LIVING_DOC : cut(parentPath(lineage, rows)),
      lineageId: lineage.id,
      ...(openable ? { pageId: canonical } : {}),
      selectable: openable || (!current && !continuous),
    });
  }

  return out;
}

/** Where a trail lives: its ancestors, "product › export api", or "" for a
 *  root. The desktop's own separator, and the same walk `lineagePath`
 *  already does for memory's breadcrumb chips.
 *
 *  THIS USED TO BE THE WHOLE LABEL, ancestors and self in one string, cut
 *  at 36 characters — from the END, which is the trail's own name and the
 *  only part the writer is choosing between. `product › export api › v2
 *  be…` is a row that hides its answer. A flat sheet still cannot indent
 *  (`Row` has one shape, and the trail-scope sheet carries the same
 *  refusal), but a `Row` has a SECOND COLUMN — mono, quieter, already
 *  there — and the path belongs in it. The name stops being truncated, and
 *  depth becomes legible without moving a tap target: an empty second
 *  column is a root.
 *
 *  Self is excluded, so this never repeats what the label already says. */
function parentPath(lineage, lineages) {
  const names = lineagePath(lineage.id, lineages)
    .filter((l) => l.id !== lineage.id)
    .map((l) => clean(l.name))
    .filter(Boolean);
  return names.join(" › ");
}

function cut(text) {
  if (text.length <= NAME_MAX) return text;
  return `${text.slice(0, NAME_MAX).trimEnd()}…`;
}

/** One line, one space between words. A trail name is free text typed into
 *  a field and can arrive with a newline or a run of spaces in it. */
function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * What return in the sheet's field does: the row it runs, or null.
 *
 * The keyboard showed `Go` over a field that did nothing with it — the
 * third device pass's other half of "no indication". Return starts the
 * trail the field names when no trail carries that name yet, and when one
 * already does it chooses THAT trail rather than doing nothing — the
 * writer typed a trail's name and asked to go, and the model has already
 * refused to make a second trail by that name (`taken`, above). A name
 * that matches the page's own trail, or a continuous one, is a row that
 * is not selectable, and return does nothing with it, for the reason the
 * row does nothing.
 *
 * @param {object} args
 * @param {ReturnType<typeof trailSheetRows>} args.rows
 * @param {Array<{id: string, name?: string}>} [args.lineages]
 * @param {string} [args.typedName]
 * @returns {object|null}
 */
export function trailSheetSubmit({ rows = [], lineages = [], typedName = "" } = {}) {
  const name = clean(typedName);
  if (!name) return null;
  const create = rows.find((r) => r.kind === "create");
  if (create) return create;
  const match = (Array.isArray(lineages) ? lineages : []).find(
    (l) => l && clean(l.name).toLowerCase() === name.toLowerCase(),
  );
  if (!match) return null;
  const row = rows.find((r) => r.kind === "trail" && r.lineageId === match.id);
  return row && row.selectable ? row : null;
}
