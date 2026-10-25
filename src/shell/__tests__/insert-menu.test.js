import { describe, it, expect } from "vitest";
import { insertMenuSections, firstInsertRow } from "../insert-menu.js";
// The editor's own list, imported HERE rather than in the module: the
// sheet's claim is that it carries the slash menu, so the test has to
// hold it against the real one. The module itself takes items as an
// argument (its header says why).
import { commandItems } from "../../lib/slash-commands.js";

const sections = (query) => insertMenuSections({ items: commandItems, query });
const ids = (query) => sections(query).flatMap((g) => g.rows.map((r) => r.id));

describe("insertMenuSections — the sheet is the slash menu", () => {
  it("offers every list marker by its own name", () => {
    // The finding: a writer who knows `/task` typed `task` and got nothing,
    // because three commands had been collapsed into one `list` row.
    expect(ids()).toEqual(expect.arrayContaining(["task", "bullet", "numbered"]));
    expect(ids("task")).toEqual(["task"]);
  });

  it("offers all three headings", () => {
    expect(ids()).toEqual(expect.arrayContaining(["heading 1", "heading 2", "heading 3"]));
  });

  it("offers every block command the editor has", () => {
    // Drift is the thing this asserts against: a command added upstream
    // must arrive here without anybody editing this file.
    const blocks = commandItems
      .map((i) => i.title)
      .filter((t) => !["strikethrough", "code", "text"].includes(t));
    expect(ids()).toEqual(expect.arrayContaining(blocks));
  });

  it("withholds the marks and the marker-remover, each for its own surface", () => {
    // `strikethrough` and `code` act on a selection and live on the
    // selection strip; `text` converts the caret's line, which is `turn
    // into`. A row here would be one action in two places.
    expect(ids()).not.toContain("strikethrough");
    expect(ids()).not.toContain("code");
    expect(ids()).not.toContain("text");
    // `code block` is a block and stays — the exclusion is by title, and
    // a substring rule would have taken it too.
    expect(ids()).toContain("code block");
  });

  it("keeps the sheet's own paragraph row at the top of structure", () => {
    const first = sections()[0];
    expect(first.section).toBe("structure");
    expect(first.rows[0]).toEqual({ id: "paragraph", label: "paragraph", value: "a plain line" });
  });

  it("groups the rows in the menu's own section order", () => {
    expect(sections().map((g) => g.section)).toEqual([
      "structure",
      "lists",
      "inline & code",
      "shizumu blocks",
    ]);
  });

  it("carries each command's description as the row's value", () => {
    const row = sections().flatMap((g) => g.rows).find((r) => r.id === "task");
    expect(row.value).toBe("checkbox");
  });

  it("matches the description as well as the title", () => {
    // `checkbox` is what a writer who does not know the word `task` will
    // type, and it is on screen beside the row.
    expect(ids("checkbox")).toEqual(["task"]);
  });

  it("drops a section with nothing left in it", () => {
    expect(sections("table").map((g) => g.section)).toEqual(["shizumu blocks"]);
  });

  it("keeps everything, in order, for a blank query", () => {
    expect(ids("")).toEqual(ids());
    expect(ids("   ")).toEqual(ids());
  });

  it("returns nothing for a query no row carries", () => {
    // Empty, so the sheet says so in words rather than showing rows that
    // do not match what was typed.
    expect(sections("zebra")).toEqual([]);
  });

  it("takes an empty item list as no menu rather than throwing", () => {
    // The host hands over whatever the editor exports; a build that
    // exported nothing should leave the sheet with its own row, not a
    // crash on the writing surface.
    expect(insertMenuSections({ items: [], query: "" })).toEqual([
      { section: "structure", rows: [{ id: "paragraph", label: "paragraph", value: "a plain line" }] },
    ]);
  });
});

describe("firstInsertRow — what return runs", () => {
  it("takes the first row of the first section left", () => {
    expect(firstInsertRow(sections("task"))).toMatchObject({ id: "task" });
    expect(firstInsertRow(sections("head"))).toMatchObject({ id: "heading 1" });
  });

  it("is null when nothing matched", () => {
    expect(firstInsertRow(sections("zebra"))).toBeNull();
    expect(firstInsertRow([])).toBeNull();
  });
});
