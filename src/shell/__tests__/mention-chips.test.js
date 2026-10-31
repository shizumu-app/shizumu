import { describe, it, expect } from "vitest";
import { mentionChips, MENTION_CHIP_LIMIT, MENTION_LABEL_MAX } from "../mention-chips.js";

const page = (n) => ({ kind: "ref", pageId: `p${n}`, label: `the book:chapter ${n}` });
const pin = (n) => ({ kind: "pin-ref", pinId: `pin${n}`, label: `ferry times ${n}` });

describe("mentionChips", () => {
  it("offers pages, then pins, then the new-trail rows, in the desktop menu's order", () => {
    const chips = mentionChips([
      page(1),
      pin(1),
      { kind: "create-subtrail", parentName: "the book", parentId: "L1", query: "harbour" },
      { kind: "create-toplevel", query: "harbour" },
    ]);
    expect(chips.map((c) => c.label)).toEqual([
      "the book:chapter 1",
      "pin · ferry times 1",
      "new trail “harbour” in the book",
      "new trail “harbour”",
    ]);
    expect(chips.map((c) => c.kind)).toEqual(["page", "pin", "create", "create"]);
  });

  it("keeps the strip short but never drops the new-trail rows", () => {
    const many = [...Array.from({ length: 12 }, (_, i) => page(i)), { kind: "create-toplevel", query: "x" }];
    const chips = mentionChips(many);
    expect(chips.filter((c) => c.kind === "page")).toHaveLength(MENTION_CHIP_LIMIT);
    expect(chips.at(-1).kind).toBe("create");
  });

  it("gives every chip a unique id and carries the item a tap commits", () => {
    const chips = mentionChips([page(1), page(2), pin(1)]);
    expect(new Set(chips.map((c) => c.id)).size).toBe(3);
    expect(chips[2].item).toEqual(pin(1));
  });

  it("cuts a long page label from the start, keeping the page's own name", () => {
    // Every page on a trail shares the trail path at the label's start;
    // the end is what tells two of them apart.
    const long = "the spice roads of the eastern sea:pepper, by price per pound";
    const [chip] = mentionChips([{ kind: "ref", pageId: "p", label: long }]);
    expect(chip.label.length).toBe(MENTION_LABEL_MAX);
    expect(chip.label.startsWith("…")).toBe(true);
    expect(chip.label.endsWith("by price per pound")).toBe(true);
  });

  it("cuts a long pin title from the end, keeping how it starts", () => {
    const [chip] = mentionChips([{ kind: "pin-ref", pinId: "x", label: "x".repeat(80) }]);
    expect(chip.label.endsWith("…")).toBe(true);
  });

  it("offers nothing for nothing", () => {
    // An empty answer is a real answer (no page matches what was typed and
    // nothing has been typed to create from): the strip then falls back to
    // the block strip rather than showing an empty row.
    expect(mentionChips([])).toEqual([]);
    expect(mentionChips(null)).toEqual([]);
  });
});
