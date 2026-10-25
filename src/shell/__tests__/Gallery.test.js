import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import Gallery from "../Gallery.svelte";
import { ROW_KINDS } from "../row-kind.js";

afterEach(cleanupAll);

/** The gallery's sections in order, each as { label, el }. A section is
 *  named by its own Eyebrow — the first heading inside it — and NOT by any
 *  eyebrow deeper down (the RowGroup section carries a second one, `a
 *  group`, inside the group). */
function sections(target) {
  return [...target.querySelectorAll(".shell-gallery-section")].map((el) => ({
    label: el.querySelector(":scope > .shell-eyebrow")?.textContent.trim() ?? null,
    el,
  }));
}

function section(target, label) {
  const found = sections(target).find((s) => s.label === label);
  if (!found) throw new Error(`no gallery section labelled "${label}"`);
  return found.el;
}

describe("Gallery", () => {
  it("renders a labelled section for every primitive it shows, in order", () => {
    // The gallery is a catalogue, and an unlabelled swatch is unreadable in
    // a screenshot — the baseline is the deliverable, so the labels are
    // part of the artefact rather than decoration. Labelled through
    // Eyebrow, the primitive this file's own label style was promoted
    // into; a section heading drawn any other way is the drift Eyebrow
    // exists to end.
    const { target } = render(Gallery, {});
    flushSync();
    expect(sections(target).map((s) => s.label)).toEqual([
      "NavBar", "TabBar", "ToolbarStrip", "PrimaryAction", "RowGroup",
      "Field", "Segment", "Chip", "Card", "Note", "Title", "Toast",
    ]);
    expect(target.querySelector(".shell-gallery-label")).toBeNull();
  });

  it("renders each primitive's states, not just one of each", () => {
    // A catalogue showing only the default state hides exactly the variants
    // a visual diff exists to catch — the collapsed bar, the destructive
    // row, the disabled control.
    const { target } = render(Gallery, {});
    flushSync();
    const navbars = target.querySelectorAll(".shell-navbar");
    expect(navbars.length).toBe(2);
    expect(navbars[0].querySelector(".shell-navbar-subtitle")).not.toBeNull();
    expect(navbars[1].classList.contains("collapsed")).toBe(true);
    expect(navbars[1].querySelector(".shell-navbar-subtitle")).toBeNull();

    const primary = section(target, "PrimaryAction").querySelectorAll(".shell-toolbar-button");
    expect([...primary].map((b) => b.disabled)).toEqual([false, true]);

    const fields = section(target, "Field");
    expect(fields.querySelectorAll(".shell-field").length).toBe(4);
    expect(fields.querySelector("textarea.shell-field-input")).not.toBeNull();
    expect(fields.querySelector('input[type="password"]')).not.toBeNull();

    expect([...section(target, "Chip").querySelectorAll(".shell-chip")].map((c) => c.dataset.tone))
      .toEqual(["ink", "accent"]);
    expect([...section(target, "Note").querySelectorAll(".shell-note")].map((n) => n.dataset.tone))
      .toEqual(["ink", "warm"]);
    expect(section(target, "Card").querySelector(".shell-card p:nth-of-type(3)")).not.toBeNull();
    expect(section(target, "Title").querySelector(".shell-title")).not.toBeNull();
    expect(section(target, "Title").querySelector(".shell-provenance").textContent).toBe(
      "from the book · kept yesterday · edited today",
    );
    expect(section(target, "Segment").querySelectorAll(".shell-segment .seg-btn").length).toBe(3);
  });

  it("draws every row kind in the group, each once, and the toggle in both positions", () => {
    // The group is the one swatch of Row's six kinds side by side, which
    // is what a photograph of the row rules is FOR: a chevron on a
    // non-push, an action in the wrong tone, a choice that grew a
    // chevron, each visible only next to its neighbours. So the kinds are
    // held as an ordered list — every kind row-kind.js knows, once each,
    // with `toggle` twice because a switch has two states and one of them
    // is not a picture of the other — rather than as a count, which a
    // second push and a missing choice would satisfy between them.
    const { target } = render(Gallery, {});
    flushSync();
    const group = section(target, "RowGroup").querySelector(".shell-row-group");
    expect(group.querySelector(":scope > .shell-eyebrow").textContent.trim()).toBe("a group");
    const rows = [...group.querySelectorAll(".shell-row-group-body > .shell-row")];
    expect(rows.map((r) => r.dataset.kind)).toEqual([
      "push", "value", "choice", "action", "destructive", "toggle", "toggle",
    ]);
    for (const kind of ROW_KINDS) {
      expect(rows.filter((r) => r.dataset.kind === kind).length, kind).toBe(kind === "toggle" ? 2 : 1);
    }
    expect([...group.querySelectorAll('.shell-row[data-kind="toggle"] input')].map((i) => i.checked))
      .toEqual([true, false]);
    // The chevron is a push's alone; the choice with `in use` beside it is
    // the row this catalogue exists to show without one.
    expect(rows.filter((r) => r.querySelector(".shell-row-chevron")).map((r) => r.dataset.kind))
      .toEqual(["push"]);
  });

  it("draws both strips six wide, through the model, and both fit", () => {
    // Six is the block strip's width after the visual pass and the
    // boundary ToolbarStrip fits at; a strip that did not fit here would
    // photograph the mask fade over a catalogue swatch, and — worse — the
    // ids come from toolbarFor and stripPresence, so a seventh control
    // would mean the model grew one the app never showed. The selection
    // strip lists `link` in the model and drops it the way ShellApp does;
    // that it is absent here is the check that the drop went through the
    // same function rather than a hand-written list.
    const { target } = render(Gallery, {});
    flushSync();
    const strips = [...section(target, "ToolbarStrip").querySelectorAll(".shell-toolbar-strip")];
    expect(strips.length).toBe(2);
    const ids = strips.map((s) => [...s.querySelectorAll("[data-button-id]")].map((b) => b.dataset.buttonId));
    expect(ids).toEqual([
      ["insert", "type", "bold", "italic", "pin", "undo"],
      ["bold", "italic", "strike", "code", "pin-selection", "copy"],
    ]);
    expect(strips.map((s) => s.classList.contains("fits"))).toEqual([true, true]);
    expect(strips[1].querySelector('[data-button-id="bold"]').classList.contains("active")).toBe(true);
  });

  it("keeps the sheet closed unless asked for it", () => {
    // Not an idle default: Sheet is position:fixed and would cover the rest
    // of the catalogue. The overlay gets its own scene rather than spoiling
    // this one.
    const { target } = render(Gallery, {});
    flushSync();
    expect(target.querySelector(".shell-sheet")).toBeNull();
  });

  it("shows the sheet when the scene asks for it, as a flush group of choices and a save", () => {
    // The sheet scene is the catalogue's one picture of a sheet's rows on
    // the sheet's own surface: flush (no card on a card), two choices with
    // no chevron and a `save` in the action tone.
    const { target } = render(Gallery, { sheetOpen: true });
    flushSync();
    const sheet = target.querySelector(".shell-sheet");
    expect(sheet).not.toBeNull();
    const group = sheet.querySelector(".shell-row-group");
    expect(group.classList.contains("flush")).toBe(true);
    const rows = [...group.querySelectorAll(".shell-row")];
    expect(rows.map((r) => r.dataset.kind)).toEqual(["choice", "choice", "action"]);
    expect(sheet.querySelector(".shell-row-chevron")).toBeNull();
  });

  it("declares no font-family of its own — the primitives carry the faces", () => {
    // The pass's gate: no font-family on a label, title or note outside
    // src/shell/ui/**. The gallery drew one for its section labels until
    // Task 10 put Eyebrow there; a copy creeping back is exactly the drift
    // the catalogue is meant to photograph, not commit.
    expect(readFileSync("src/shell/Gallery.svelte", "utf8")).not.toMatch(/font-family/);
  });
});
