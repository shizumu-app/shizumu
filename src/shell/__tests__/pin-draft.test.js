import { describe, it, expect } from "vitest";
import { pinNoteDraft, pinTitleDraft } from "../pin-draft.js";

const note = (over = {}) => ({
  id: "pin-1",
  lineage_id: "L1",
  object_type: "note",
  title: "the second reader",
  content: "what the trail is for",
  ...over,
});

const board = (over = {}) => ({
  id: "pin-2",
  lineage_id: "L1",
  object_type: "board",
  title: "the shape of it",
  content: JSON.stringify({
    type: "doc",
    content: [{ type: "table", content: [] }],
  }),
  ...over,
});

describe("pinTitleDraft", () => {
  it("starts from the pin's own title", () => {
    expect(pinTitleDraft(note())).toBe("the second reader");
  });

  it("starts empty when the stored title is just the writing's first line", () => {
    // MEASURED ON AN A16, and the reason this screen was called unclean:
    //
    //     marlin152632          <- the title field
    //     from not on a trail · kept today
    //     marlin152632          <- the writing
    //
    // A phone pins from the caret without stopping to ask for a name, so
    // pin-intent.js stores the pin's own opening words as its title. The
    // rule below ("rather than borrowing its label") was written against a
    // label derived at DISPLAY time; this is the same label arriving from
    // the other end, already stored, and the field repeated it.
    expect(pinTitleDraft(note({ title: "what the trail is for" }))).toBe("");
    // Trimmed on both sides before comparing: whitespace is not a name.
    expect(pinTitleDraft(note({ title: "  what the trail is for  " }))).toBe("");
  });

  it("starts empty for a stored title cut at the length pin-intent stores", () => {
    // pin-intent.js keeps 60 characters and adds its own ellipsis, so a
    // long opening line is stored cut. Still a derived label, still not
    // worth saying twice.
    const line = "a first line that runs on well past the sixty characters pin-intent keeps";
    expect(pinTitleDraft(note({ content: line, title: line.slice(0, 60) + "…" }))).toBe("");
  });

  it("keeps a title the writer really gave the pin", () => {
    // The other half, and the one that makes the rule safe: a name that is
    // NOT the writing's own first words is the writer's, and it opens in
    // the field where they can edit it.
    expect(pinTitleDraft(note())).toBe("the second reader");
    expect(pinTitleDraft(note({ title: "what the trail is" }))).toBe("what the trail is");
  });

  it("keeps the title when the content cannot be read for a comparison", () => {
    // A pin whose content will not parse has no first line to echo. The
    // title stands rather than the field going blank on a pin that may be
    // the only place those words still are.
    expect(pinTitleDraft(note({ content: null, title: "a kept name" }))).toBe("a kept name");
    expect(pinTitleDraft(note({ content: "{not json", title: "a kept name" }))).toBe("a kept name");
  });

  it("starts empty for an untitled pin rather than borrowing its label", () => {
    // The row falls back to the content's first line so it is never blank
    // (pinDisplayTitle). Pre-filling the field with that fallback would
    // promote a derived label into a stored title on the first save — a
    // title the writer never typed, which then stops changing when the
    // text does.
    expect(pinTitleDraft(note({ title: null }))).toBe("");
    expect(pinTitleDraft(note({ title: "   " }))).toBe("");
  });

  it("starts empty for a legacy title stored as raw JSON", () => {
    // pin-display.js carries the same guard for the same rows: showing
    // schema in a field means saving schema back out of it.
    expect(pinTitleDraft(note({ title: '{"type":"doc"}' }))).toBe("");
  });

  it("does not elide a long title the way the row's label does", () => {
    // pinDisplayTitle cuts at 60 characters and appends an ellipsis. A
    // field pre-filled with that saves the truncation.
    const long = "x".repeat(90);
    expect(pinTitleDraft(note({ title: long }))).toBe(long);
  });
});

describe("pinNoteDraft", () => {
  it("hands back a note's text", () => {
    expect(pinNoteDraft(note())).toBe("what the trail is for");
  });

  it("keeps the newlines a note was kept with", () => {
    // The reason Field has a multiline variant at all: an <input> strips
    // them and the save would write the flattened line back.
    expect(pinNoteDraft(note({ content: "one\ntwo\nthree" }))).toBe("one\ntwo\nthree");
  });

  it("refuses a board", () => {
    // null is the model's way of saying "there is no body this sheet can
    // show", and the row above reads `rename` because of it. Returning ""
    // instead would offer an empty field whose save replaced the doc.
    expect(pinNoteDraft(board())).toBeNull();
  });

  it("refuses a note whose text is really serialized JSON", () => {
    // pinModalKind calls an unparseable JSON-shaped string a note (nothing
    // parsed). Showing it would put schema in the field.
    expect(pinNoteDraft(note({ content: '{"type":"doc",' }))).toBeNull();
  });

  it("gives an empty note an empty draft rather than refusing it", () => {
    // A pin with no text is still a pin the writer can title and can type
    // into; refusing here would show `rename` on something that is not a
    // board.
    expect(pinNoteDraft(note({ content: null }))).toBe("");
  });
});
