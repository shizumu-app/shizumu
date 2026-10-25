import { describe, it, expect } from "vitest";
import { commandItems } from "../../lib/slash-commands.js";
import { suggestionChips, matchesSlashQuery } from "../suggestion-strip-model.js";

// Asserted against the REAL commandItems rather than a fixture list, and
// that is the point of the file. The rule this module copies is private
// upstream (`filterItems`, slash-commands.js:472), so the only thing that
// can catch it drifting is a test that reads the same list the desktop
// menu reads. A hand-written `[{title: "heading 1"}]` fixture would stay
// green through a rename that turned every chip into a no-op tap — which
// is the defect runSlashInsert's own comment records having shipped once.
const TITLES = commandItems.map((i) => i.title);

const slash = (text) => ({ kind: "slash", text });

describe("suggestionChips", () => {
  it("offers the commands whose title contains what was typed", () => {
    expect(suggestionChips(slash("head"))).toEqual(["heading 1", "heading 2", "heading 3"]);
  });

  it("matches anywhere in the title, not only at the front", () => {
    // `filterItems` is `includes`, not `startsWith`, and the difference is
    // visible on the real list: "code block" is reachable by typing
    // "block", which a prefix match would drop. Copying the rule as
    // startsWith would look right on every /head query and be wrong here.
    expect(suggestionChips(slash("block"))).toEqual(["code block", "blockquote"]);
  });

  it("folds case the way the menu does", () => {
    expect(suggestionChips(slash("RECIPE"))).toEqual(["recipe"]);
    expect(matchesSlashQuery("Heading 1", "heading")).toBe(true);
  });

  it("offers every command for a bare slash", () => {
    // `/` on its own is `text: ""`, and every title contains the empty
    // string. This is the state the strip spends its first frame in on the
    // most common trigger there is, so "all of them" has to be the answer
    // rather than an accident: a guard that read "" as "nothing typed" and
    // returned [] would blank row 4 on the very keystroke this task exists
    // to fix.
    expect(suggestionChips(slash(""))).toEqual(TITLES);
    expect(TITLES.length).toBeGreaterThan(10);
  });

  it("keeps commandItems' own order", () => {
    // NOT the desktop menu's order, which regroups by section
    // (`orderBySection`, also private). A strip renders no section
    // headings, so grouping would reorder chips for a reason the writer
    // cannot see. Pinned here so the divergence is a decision on record
    // rather than something a later reader "fixes" by copying a second
    // private function.
    const chips = suggestionChips(slash(""));
    expect(chips).toEqual(TITLES);
    expect(chips.indexOf("outline")).toBeGreaterThan(chips.indexOf("table"));
  });

  it("offers nothing for a query that matches no command", () => {
    // Empty is right here, and it is right for a reason that lives one
    // file over: `toolbarFor` gives row 4 the slot only when it has chips,
    // so an empty list is what keeps the block strip on screen instead of
    // blanking it. If this returned the whole list as a "did you mean",
    // the writer typing `/zzz` would get twenty chips for a query that
    // matched none of them.
    expect(suggestionChips(slash("zzzz"))).toEqual([]);
  });

  it("offers nothing for a mention query", () => {
    // Not "not implemented yet" in the sense of a TODO: the mention list
    // is async and lives inside the extension's private suggestion config
    // (mention-command.js:334-347 awaits three API calls), so there is no
    // list here to filter. Empty is what makes row 4 fall through to the
    // block strip while the writer types a name — the decision recorded at
    // ShellApp's toolbarFor call.
    expect(suggestionChips({ kind: "mention", text: "al" })).toEqual([]);
    expect(suggestionChips({ kind: "mention", text: "" })).toEqual([]);
  });

  it("offers nothing when no trigger is live", () => {
    // `computeSnapshot` returns null, never an object with `active: false`
    // — testing the object's presence rather than a flag is the same rule
    // toolbar-model.js follows, and the flag that does not exist is what
    // left P1a's strip dead.
    expect(suggestionChips(null)).toEqual([]);
    expect(suggestionChips(undefined)).toEqual([]);
  });

  it("emits only titles the command table can look up", () => {
    // The structural claim the strip rests on: a chip exists exactly when
    // its command does, so there is no such thing as a dead chip and no
    // disabled state for the strip to be missing. It holds because the
    // chips are MAPPED from commandItems rather than listed beside it —
    // this asserts the mapping has not been replaced by a literal list.
    const byTitle = new Map(commandItems.map((i) => [i.title, i]));
    for (const title of suggestionChips(slash(""))) {
      expect(typeof byTitle.get(title)?.command).toBe("function");
    }
  });
});
