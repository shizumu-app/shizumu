import { describe, it, expect } from "vitest";
import { activeIdsFor, disabledIdsFor, stripPresence } from "../toolbar-state.js";

describe("activeIdsFor", () => {
  it("lights the marks that are on", () => {
    expect(activeIdsFor({ bold: true, italic: false, strike: true })).toEqual(["bold", "strike"]);
  });

  it("lights nothing for no marks", () => {
    // Not "nothing happens" bait: an empty array is what ToolbarStrip needs
    // to render every button unpressed.
    //
    // The plan justified this by saying undefined would make
    // `activeIds.includes(...)` throw inside the strip. It would not:
    // ToolbarStrip declares `activeIds = []` in its own $props(), and a
    // fallback applies to an undefined prop, which ToolbarStrip.test.js
    // relies on by rendering with no activeIds at all. So the real cost of
    // returning undefined is worse than a throw, not better — every button
    // renders unpressed, forever, with nothing in the console. That is the
    // P1a failure exactly: a wrong shape absorbed by a default.
    expect(activeIdsFor({})).toEqual([]);
    expect(activeIdsFor(null)).toEqual([]);
  });

  it("ignores keys that are not strip buttons", () => {
    // The editor reports marks the shell has no button for (highlight,
    // subscript). Passing those through would produce activeIds naming
    // buttons that do not exist, which reads as nothing and hides a typo.
    expect(activeIdsFor({ bold: true, highlight: true })).toEqual(["bold"]);
  });
});

describe("disabledIdsFor", () => {
  it("kills undo when there is nothing to undo", () => {
    expect(disabledIdsFor({ canUndo: false })).toContain("undo");
    expect(disabledIdsFor({ canUndo: true })).not.toContain("undo");
  });

  it("kills pin-selection when the selection is empty", () => {
    // The selection strip only shows while text is selected, so this is
    // belt and braces — but the strip is also what a stale snapshot would
    // render, and pinning an empty selection creates an empty pin.
    expect(disabledIdsFor({ selectionEmpty: true })).toContain("pin-selection");
    expect(disabledIdsFor({ selectionEmpty: false, canUndo: true })).not.toContain("pin-selection");
  });

  it("survives a missing snapshot", () => {
    // ShellApp renders before the editor exists, so the first paint may ask
    // this with nothing. Each id is disabled by its own condition, and a
    // missing snapshot fails every one of them — so undo and pin-selection
    // come back dead.
    //
    // Not "disable every button when the snapshot is null", which the plan
    // suggested: EditorCore initialises its store to EMPTY_SNAPSHOT, not
    // null (EditorCore.svelte:97), so a subscriber never sees null and that
    // branch would be dead code the moment it was written. Keying behaviour
    // on a shape the producer does not emit is P1a's defect over again.
    expect(disabledIdsFor(null)).toContain("undo");
  });
});

describe("stripPresence", () => {
  const STRIP = ["insert", "type", "bold", "italic", "pin", "undo"];

  it("drops an unavailable control from the strip", () => {
    // `pin` on an empty paragraph: nothing the writer does on this line
    // makes it pinnable, so a grey `pin` is a control that says "broken"
    // where it means "not here". Absent, and the order of the rest holds.
    const { shown } = stripPresence({ buttons: STRIP, unavailable: ["pin"] });
    expect(shown).toEqual(["insert", "type", "bold", "italic", "undo"]);
  });

  it("keeps a disabled control on the strip, dead", () => {
    // `undo` with nothing on the history stack. The control could apply
    // here — the first edit lights it — so it stays put.
    const { shown, disabled } = stripPresence({ buttons: STRIP, disabled: ["undo"] });
    expect(shown).toEqual(STRIP);
    expect(disabled).toEqual(["undo"]);
  });

  it("would be wrong to hide undo, and this is why", () => {
    // Not a "nothing happens" assertion: it pins the LINE between the two
    // categories. Hide `undo` whenever it is dead and the strip is five
    // wide until the first keystroke and six after it — every control to
    // its left shifts under the thumb on the writer's first edit, and a
    // strip that changes shape on typing is the controls-over-content
    // class of bug wearing a new face. So a dead `undo` is present, and a
    // host that lists it as unavailable rather than disabled would make
    // this red.
    const { shown } = stripPresence({ buttons: STRIP, disabled: ["undo"] });
    expect(shown).toContain("undo");
  });

  it("drops an id that is both unavailable and disabled — hidden beats dead", () => {
    // A control that cannot apply here has no "not right now" left to
    // signal. Reporting it dead as well would hand the strip a disabled id
    // for a button it is not drawing.
    const { shown, disabled } = stripPresence({
      buttons: STRIP,
      unavailable: ["pin"],
      disabled: ["pin", "undo"],
    });
    expect(shown).not.toContain("pin");
    expect(disabled).toEqual(["undo"]);
  });

  it("never reorders — presence is decided here, order a module over", () => {
    // The strip's order is toolbarFor's and is tested there. Hiding two
    // from the middle must leave the survivors in the sequence they had,
    // or `insert` at the front and `undo` at the end would stop being
    // reliable landmarks for the thumb.
    const { shown } = stripPresence({ buttons: STRIP, unavailable: ["italic", "pin"] });
    expect(shown).toEqual(["insert", "type", "bold", "undo"]);
  });

  it("ignores an unavailable id the strip never carried", () => {
    // `link` is listed unavailable on every strip (no command), but only
    // the selection strip carries it. The block strip must come through
    // untouched rather than, say, throwing on an id it does not know.
    const { shown } = stripPresence({ buttons: STRIP, unavailable: ["link"] });
    expect(shown).toEqual(STRIP);
  });
});

describe("indent and outdent render dead where they cannot act", () => {
  it("indent is dead on a first item, outdent never is inside a list", () => {
    const ids = disabledIdsFor({ canUndo: true, selectionEmpty: true, canIndent: false, canOutdent: true });
    expect(ids).toContain("indent");
    expect(ids).not.toContain("outdent");
  });
});
