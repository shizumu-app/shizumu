import { describe, it, expect } from "vitest";
import { turnIntoRows, PARAGRAPH_TARGETS, CONVERT_TARGET_LABELS } from "../turn-into-model.js";
import { CONVERT_TARGETS, convertTargetsFor } from "../../lib/editor/block-convert.js";

const PARAGRAPH = { type: "paragraph", pos: 0, isBoard: false, isTitled: false, isEmpty: false };
const LIST = { type: "list", pos: 0, isBoard: true, isTitled: false, isEmpty: false };
const HEADING = { type: "heading", pos: 0, isBoard: false, isTitled: false, isEmpty: false };

describe("turnIntoRows", () => {
  it("gives a paragraph list and heading, in that order", () => {
    // The visual pass's one design step: the strip's list button is gone,
    // and this row is where a paragraph's way into a list lives now.
    // Asserted as the whole list — the header says why it is two rows
    // and not the six the plan sketched, and a third row appearing here
    // should have to argue with that header first.
    expect(turnIntoRows({ activeBlock: PARAGRAPH })).toEqual([
      { id: "list", label: "list" },
      { id: "heading", label: "heading" },
    ]);
  });

  it("labels a board's convert targets and offers nothing else", () => {
    // A board goes through block-convert.js, and its targets ARE the
    // rows. The paragraph targets must not be appended: a list offering
    // `list` would be a row that does nothing.
    const targets = convertTargetsFor("list", { marker: "bullet" });
    expect(targets).toContain("ordered");
    const rows = turnIntoRows({ activeBlock: LIST, convertTargets: targets });
    expect(rows.map((r) => r.id)).toEqual(targets);
    expect(rows.find((r) => r.id === "ordered").label).toBe("numbered list");
    expect(rows.map((r) => r.id)).not.toContain("list");
  });

  it("labels every board target the converter can produce", () => {
    // block-convert.js's ids are type-shaped (`qaBlock`); a target it gains
    // that this table does not name would render as its raw id in a sheet.
    for (const id of CONVERT_TARGETS) {
      expect(CONVERT_TARGET_LABELS[id], id).toBeTruthy();
    }
  });

  it("offers a heading nothing", () => {
    // Not "nothing happens" for its own sake: a heading is neither a
    // board nor a paragraph, and no command the shell runs turns one back
    // into a paragraph in place (the `text` slash command removes a list
    // marker, not a heading level). An empty answer here is what hides
    // `turn into` on the strip beside a heading, and that absence is the
    // honest one until a command exists.
    expect(turnIntoRows({ activeBlock: HEADING })).toEqual([]);
  });

  it("offers a read-only paragraph nothing", () => {
    // A closed page. The board branch never reaches here read-only —
    // the host's convertTargetsOf answers [] first — but the paragraph
    // targets are decided in this module, so the page's state has to be
    // asked here or a closed page offers to wrap its paragraphs in lists.
    // Drop the `readonly ||` and this goes red.
    expect(turnIntoRows({ activeBlock: PARAGRAPH, readonly: true })).toEqual([]);
  });

  it("offers no block nothing", () => {
    // The caret in no top-level node — the state toolbarFor already
    // answers by not prepending `type` at all.
    expect(turnIntoRows({ activeBlock: null })).toEqual([]);
    expect(turnIntoRows()).toEqual([]);
  });

  it("keeps the paragraph ids out of the converter's", () => {
    // The host routes a paragraph target to a command and a board target
    // to convertBlockNode by looking the id up. Disjoint sets are what make
    // that a lookup rather than a guess; a paragraph target named `bullet`
    // would be handed to a converter that refuses paragraphs and do nothing.
    for (const { id } of PARAGRAPH_TARGETS) {
      expect(CONVERT_TARGETS).not.toContain(id);
    }
  });

  it("hands out copies, not the frozen table", () => {
    // A host that decorates a row (a `run`, a `kind`) must not be writing
    // into module state shared by every caller.
    const rows = turnIntoRows({ activeBlock: PARAGRAPH });
    expect(() => {
      rows[0].label = "changed";
    }).not.toThrow();
    expect(PARAGRAPH_TARGETS[0].label).toBe("list");
  });
});
