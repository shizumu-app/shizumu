// What the phone's strip offers for an `@` query.
//
// The desktop answers `@` with a floating menu; the phone has no floating
// menus (spec §3), so the answer is laid flat into the suggestion strip
// above the keyboard, the way `/` already is (suggestion-strip-model.js).
// WHAT `@` finds is not decided here: it is `mentionItems`
// (src/lib/extensions/mention-command.js), the same function the desktop's
// menu calls, so the two cannot find different things for one keystroke.
// This module only turns those items into chips a thumb can read.
//
// The strip is one row that scrolls sideways, so it is kept short: the
// first pages and pins, then the "new trail" rows, which only exist once
// something is typed.

/** Pages and pins shown before the create rows. */
export const MENTION_CHIP_LIMIT = 8;

/** Longest label a chip shows before it is cut. */
export const MENTION_LABEL_MAX = 32;

function cut(text) {
  const t = String(text || "").trim();
  return t.length > MENTION_LABEL_MAX ? `${t.slice(0, MENTION_LABEL_MAX - 1)}…` : t;
}

/** A page label is `<trail path>:<focus or date>` (mention-label.js), and
 *  its END names the page; the trail path is shared by every page on the
 *  trail. So a long one keeps its end and drops its start. */
function cutKeepingEnd(text) {
  const t = String(text || "").trim();
  return t.length > MENTION_LABEL_MAX ? `…${t.slice(t.length - (MENTION_LABEL_MAX - 1))}` : t;
}

/**
 * @param {Array<object>} items  `mentionItems`' answer, in its order:
 *   pages (`ref`), pins (`pin-ref`), then create rows
 * @returns {Array<{id: string, label: string, kind: string, item: object}>}
 *   ids are unique and stable for one item, so the strip can key on them
 */
export function mentionChips(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const found = list.filter((i) => i.kind === "ref" || i.kind === "pin-ref").slice(0, MENTION_CHIP_LIMIT);
  const create = list.filter((i) => i.kind === "create-subtrail" || i.kind === "create-toplevel");
  const chips = [];
  for (const item of found) {
    if (item.kind === "ref") {
      chips.push({ id: `page:${item.pageId}`, label: cutKeepingEnd(item.label), kind: "page", item });
    } else {
      // A pin says it is one, the way the desktop menu's pin group does.
      chips.push({ id: `pin:${item.pinId}`, label: `pin · ${cut(item.label)}`, kind: "pin", item });
    }
  }
  for (const item of create) {
    const name = cut(item.query);
    chips.push(
      item.kind === "create-subtrail"
        ? { id: "create:sub", label: `new trail “${name}” in ${cut(item.parentName)}`, kind: "create", item }
        : { id: "create:top", label: `new trail “${name}”`, kind: "create", item },
    );
  }
  return chips;
}
