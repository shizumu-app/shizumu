// Which chips row 4 offers for the query the editor says is live.
//
// The phone has no slash menu. §3 forbids the floating one outright, so a
// writer who types `/` on a phone has typed a trigger with nothing behind
// it — and until this file existed the slot answered that by going BLANK,
// because `toolbarFor`'s row 4 emitted `buttons: []` and won the slot with
// it. The chips are the menu, laid flat into the one strip the shell has.
//
// SLASH ONLY. `@` has its own chips (mention-chips.js), because its list
// is ASYNC: it is the desktop menu's `mentionItems` (mention-command.js),
// exported so the phone asks the same function rather than re-implementing
// the search. `suggestionChips` therefore returns an empty list for a
// mention query, and ShellApp fills the strip from that answer instead.

// THE MATCHING RULE IS A HAND-COPY, and this is the second one in this
// workstream (ShellApp's `insertionPoint` is the first, for the same
// reason). `filterItems` (slash-commands.js:472) is module-private while
// `commandItems` beside it is exported, so the list can be shared and the
// rule that filters it cannot. It is one line — a case-folded substring
// test on the title — and it is copied here rather than approximated,
// because the failure of a near-copy is that the phone offers a different
// set from the menu the same keystroke opens on the desktop. If the day
// comes that `filterItems` grows a fuzzy match or a score, this file is
// where the divergence lands; exporting it upstream is the real fix and
// it wants a `main`-side commit.

import { commandItems } from "../lib/slash-commands.js";

/**
 * `filterItems`' rule, verbatim (slash-commands.js:472-476).
 *
 * @param {string} title  a slash command's own title
 * @param {string} text   what the writer has typed after `/`
 */
export function matchesSlashQuery(title, text) {
  return title.toLowerCase().includes(text.toLowerCase());
}

/**
 * The chips row 4 renders, as slash-command TITLES.
 *
 * A title is both the chip's id and its label — there is no second name to
 * keep in step, and no map for one to drift out of. It is also the key
 * ShellApp's `SLASH_BY_TITLE` looks the command up under, so a chip exists
 * exactly when the command behind it does. That is the same structural
 * property INSERT_ROWS has, and it is what makes "no dead chips" true by
 * construction rather than by a disabled state somebody has to maintain.
 *
 * THAT CLAIM WAS FALSE FOR ONE CHIP, from the day this file was written
 * until P2f-2 Task 5, and the way it was false is worth keeping: `chart`
 * resolved through `SLASH_BY_TITLE` like every other title, its command
 * ran, and the whole body of that command is `openChartBuilder`, which
 * dispatches through a host callback the shell had defaulted to a NO-OP.
 * A command existing is not the same as a command finishing. So the tap
 * consumed the writer's typed `/chart`, opened a fresh paragraph through
 * `insertionPoint`, and produced nothing — the exact dead chip this
 * paragraph promised could not exist, on a strip with no disabled state to
 * render it with. ShellApp answers `chart` and `table` from BUILDER_SHEETS
 * now, before `runSlashInsert` is reached; the structural property is
 * intact for the other titles and this file no longer claims to be the
 * only thing holding it up.
 *
 * Order is `commandItems`' own, NOT the desktop menu's. The menu regroups
 * by section (`orderBySection`, also private) because it renders section
 * headings; a strip has none, so grouping would only reorder chips for a
 * reason the writer cannot see. The two surfaces therefore list the same
 * items in slightly different orders, which is recorded rather than fixed
 * by copying a second private function.
 *
 * Uncapped, like the menu. `/` on its own carries `text: ""`, every title
 * contains the empty string, and all of them come back — a long strip that
 * scrolls, which is what the strip does by design, rather than a shorter
 * one that silently hides commands the desktop offers.
 *
 * @param {{kind: string, text: string}|null|undefined} query  the snapshot's
 *   own field (`computeSnapshot`), which is null whenever no trigger is live
 * @returns {string[]}
 */
export function suggestionChips(query) {
  // Not `!query?.kind` — the guard is the object's presence, the same
  // liveness signal toolbar-model.js reads, because `computeSnapshot`
  // returns null rather than an inactive object and there is no `active`
  // flag on it to test. (That fabricated flag is what left P1a's
  // suggestion strip dead with both sides' tests green.)
  if (!query || query.kind !== "slash") return [];
  const text = query.text ?? "";
  return commandItems
    .filter((item) => matchesSlashQuery(item.title, text))
    .map((item) => item.title);
}
