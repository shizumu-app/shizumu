import { describe, it, expect } from "vitest";
import {
  EXPORT_DETAIL,
  EXPORT_LAPTOP_NOTE,
  exportStatusText,
  CHOSEN,
  FONTS,
  SHELL_OFF_NOTE,
  TONES,
  settingsGroups,
  settingsRootIds,
  settingsRowScreen,
  settingsSection,
  settingsSectionIds,
} from "../settings-model.js";

const ids = (groups) => groups.map((group) => group.rows.map((row) => row.id));
const rowIds = (section) => section.rows.map((row) => row.id);
const allRows = (groups) => groups.flatMap((group) => group.rows);
const valueOf = (groups, id) => allRows(groups).find((row) => row.id === id)?.value ?? null;

describe("settingsGroups", () => {
  it("names the four groups page, data, sync, app", () => {
    // The words a reader sees first, each an eyebrow over an inset group.
    // `page` rather than the desktop's `appearance`: tone and font are the
    // page's look, and `page` is what the shell calls that surface on its
    // first tab. `sync` is the row's own name. `app` is the honest home
    // for the build and its experiments. `data` is the desktop's own word
    // for the section that holds export. Held as strings because the
    // words ARE the decision — a synonym here is a different screen.
    expect(settingsGroups().map((group) => group.eyebrow)).toEqual(["page", "data", "lock", "sync", "app"]);
  });

  it("keeps the rows in the desktop's order across the groups", () => {
    // Step 1's answer, not an invention: src/components/Settings.svelte
    // lists appearance, writing, data, encryption, sync, labs, danger,
    // about, and the four the shell honours plus the sync stack stay in
    // that order rather than being re-sorted into the phone's idea of
    // importance — one set of settings, one organisation. The groups only
    // cut that sequence; they do not reorder it, so `sync` still sits
    // between `font` and `labs`.
    expect(ids(settingsGroups())).toEqual([["tone", "font"], ["data"], ["lock"], ["sync"], ["labs", "about"]]);
    expect(allRows(settingsGroups()).map((row) => row.id)).toEqual(settingsRootIds());
  });

  it("puts every root id in exactly one group", () => {
    // A row in two groups would push the same section from two places;
    // a row in none would be a setting the phone lists nowhere. Both are
    // the shape of a hand-edit to ROOT_GROUPS, and `settingsRootIds` —
    // the list the completeness test walks — is derived from the same
    // table, so it would agree with either mistake rather than catch it.
    const seen = allRows(settingsGroups()).map((row) => row.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.slice().sort()).toEqual(["about", "data", "font", "labs", "lock", "sync", "tone"]);
    for (const group of settingsGroups()) {
      expect(group.rows.length, `"${group.eyebrow}" names an empty group`).toBeGreaterThan(0);
    }
  });

  it("says in the value column what each option set is currently set to", () => {
    const groups = settingsGroups({ tone: "dark", font: "dm-mono" });
    expect(valueOf(groups, "tone")).toBe("dark");
    // The LABEL, not the stored id: `dm-mono` is what the setting holds
    // and "mono" is what the desktop calls it, and the root must read the
    // way the section it opens does.
    expect(valueOf(groups, "font")).toBe("mono");
  });

  it("reports an unrecognised stored value as itself rather than as the first option", () => {
    // A real state — an older install, a hand-edited row — and answering
    // "cream" for it would tell the reader their tone is something it is
    // not. The section it opens will show nothing marked, which agrees.
    expect(valueOf(settingsGroups({ tone: "sepia" }), "tone")).toBe("sepia");
    const rows = settingsSection("tone", { tone: "sepia" }).rows;
    expect(rows.some((row) => row.chosen)).toBe(false);
  });

  it("gives labs and about no value", () => {
    // Not an oversight and not "nothing happens": labs holds a toggle
    // whose state belongs beside the toggle, and about's only row is the
    // build string — printing it on the root as well would put one fact
    // on two screens.
    const groups = settingsGroups({ tone: "cream", font: "lora" });
    expect(valueOf(groups, "labs")).toBe("");
    expect(valueOf(groups, "about")).toBe("");
  });

  it("offers no layout switch where it would strand the reader", () => {
    // The browser demo has no way back to a layout it switched off (the
    // choice is read once at boot and the demo unsets it on every load), so
    // the switch and its note are omitted there; the other labs rows stay.
    const ids = settingsSection("labs", { shellEnabled: true, offerShellSwitch: false }).rows.map((r) => r.id);
    expect(ids).not.toContain("shell");
    expect(ids).not.toContain("shell-note");
    expect(ids).toContain("yjs");
    // The note would otherwise show for an off switch; hiding wins.
    const off = settingsSection("labs", { shellEnabled: false, offerShellSwitch: false }).rows.map((r) => r.id);
    expect(off).not.toContain("shell-note");
  });

  it("says what sync is doing without opening it", () => {
    // The wiring, not the vocabulary — `syncStateLabel`'s own tests hold
    // the four words. What this pins is that the root reads the status
    // THROUGH the model, so the root and the devices screen cannot end up
    // with two ways of saying one state.
    expect(valueOf(settingsGroups({ sync: { configured: true, enabled: true } }), "sync")).toBe(
      "on",
    );
    // No status read yet is not the same fact as no account, and the
    // column stays empty rather than telling a synced writer they have
    // none for as long as the round trip takes.
    expect(valueOf(settingsGroups(), "sync")).toBe("");
  });
});

describe("settingsSection", () => {
  it("has a screen behind every row the root offers", () => {
    // The rule that keeps a root row from pushing a surface with no title
    // and nothing on it. P2d's rule is what it enforces: a menu implies
    // completeness, so a row that opens a blank is worse than an absent
    // row.
    //
    // It walks every ROOT id, not every section id, because since P4 Task
    // 2 those are two lists. `sync` opens a stack of its own components
    // (§2: devices → pair → scanner) and has no rows for `settingsSection`
    // to describe, so what has to hold for it is that the model says which
    // screen it opens — and for everything else, that a real section is
    // behind it.
    for (const id of settingsRootIds()) {
      const screen = settingsRowScreen(id);
      if (screen !== "section") {
        // The non-section rows, each named with the screen it opens.
        // Named rather than accepted by wildcard: a row that opened a
        // screen nobody built would otherwise pass this by declaring any
        // string at all. `lock` opens LockSettingsScreen (ShellApp's
        // lockSettingsView).
        expect({ sync: "sync", lock: "lock" }[id], `"${id}" opens "${screen}", which no host pushes`).toBe(screen);
        continue;
      }
      const section = settingsSection(id, {});
      expect(section, `no section behind the root row "${id}"`).not.toBeNull();
      expect(section.title).toBeTruthy();
      expect(section.rows.length).toBeGreaterThan(0);
    }
  });

  it("offers no section for a row that opens a stack, or for an id the root does not list", () => {
    // Not "nothing happens" — this is the model declining to invent a
    // screen, in the two cases where inventing one would hide something.
    //
    // `sync` IS a root row, and null is still the right answer for it: it
    // opens three components of its own, and a rows-shaped section behind
    // it would be a second, blank description of the same setting that the
    // host could push by mistake.
    expect(settingsSection("sync", {})).toBeNull();
    expect(settingsRowScreen("sync")).toBe("sync");
    // `encryption` is one of the desktop's eight the shell does not offer
    // at all. Every caller is a row settingsGroups produced, so an id like
    // this means a typo in the host rather than a user action, and a
    // titled empty screen would hide it.
    expect(settingsSection("encryption", {})).toBeNull();
    expect(settingsSection(null, {})).toBeNull();
  });

  it("keeps the section list to the rows that really have sections", () => {
    // The pair to the walk above. `settingsSectionIds` is the list whose
    // contract is "everything here has rows behind it", so the row that
    // does not must be missing from it — and it must still be a root row,
    // or the filter would be hiding a row rather than classifying one.
    expect(settingsSectionIds()).toEqual(["tone", "font", "data", "labs", "about"]);
    expect(settingsRootIds()).toContain("sync");
    // The account's lock opens a screen of its own (LockSettingsScreen),
    // like sync: it needs passphrase fields a section row cannot hold.
    expect(settingsRootIds()).toContain("lock");
    expect(settingsRowScreen("lock")).toBe("lock");
  });

  it("lists every tone and marks the one in use", () => {
    const section = settingsSection("tone", { tone: "white" });
    expect(rowIds(section)).toEqual(TONES.map((t) => t.id));
    expect(section.rows.every((row) => row.kind === "choice")).toBe(true);
    expect(section.rows.filter((row) => row.chosen).map((row) => row.id)).toEqual(["white"]);
  });

  it("lists every font by its label while marking it by its stored id", () => {
    const section = settingsSection("font", { font: "system-serif" });
    expect(section.rows.map((row) => row.label)).toEqual(FONTS.map((f) => f.label));
    expect(section.rows.filter((row) => row.chosen).map((row) => row.id)).toEqual([
      "system-serif",
    ]);
  });

  it("carries the labs flags on toggle rows rather than in a value", () => {
    expect(settingsSection("labs", { yjsEnabled: true, shellEnabled: true }).rows).toEqual([
      { id: "yjs", kind: "toggle", label: "yjs for continuous trails", checked: true },
      { id: "shell", kind: "toggle", label: "new phone layout", checked: true },
    ]);
    expect(settingsSection("labs", { yjsEnabled: false }).rows[0].checked).toBe(false);
  });

  it("names the layout switch by what it does, not by its key or its phase", () => {
    // The key is `try_new_shell`, the spec calls it the mobile shell and
    // the plans call it P5. A reader has seen none of those three. Asserted
    // rather than left to review because a codename or a version number on
    // this row is the easiest wrong answer to write.
    const label = settingsSection("labs", {}).rows[1].label;
    expect(label).toBe("new phone layout");
    expect(label).not.toMatch(/shell|p5|try_new|v\d/i);
  });

  it("defaults the layout switch to on, because the shell is what renders it", () => {
    // The only caller is inside the shell, and the shell only mounts when
    // the flag booted it. A default of `false` here would show the switch
    // off on the one screen that proves it is on.
    expect(settingsSection("labs", {}).rows[1].checked).toBe(true);
  });

  it("adds a note under the switch once it is off, saying when the layout changes", () => {
    const rows = settingsSection("labs", { shellEnabled: false }).rows;
    expect(rows.map((row) => row.id)).toEqual(["yjs", "shell", "shell-note"]);
    expect(rows[2]).toEqual({ id: "shell-note", kind: "note", text: SHELL_OFF_NOTE });
    // Directly under the switch it belongs to, not appended after whatever
    // labs grows next: a sentence about a control two rows above it reads
    // as being about the row it actually touches.
    expect(rows.findIndex((r) => r.id === "shell-note")).toBe(
      rows.findIndex((r) => r.id === "shell") + 1,
    );
  });

  it("leaves the note out while the switch is on, because there is nothing to say", () => {
    // NOT "nothing happens". With the switch on, the next launch gives the
    // reader the tree they are already looking at, so a note would be
    // describing the status quo — and a sentence standing there permanently
    // is chrome the one occasion it matters would be lost in. Its absence
    // is the signal that nothing is pending.
    const rows = settingsSection("labs", { shellEnabled: true }).rows;
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.kind === "note")).toBe(false);
  });

  it("keeps the note inside the voice canon", () => {
    // The retired word appears in no user-facing string, copy is lowercase
    // and present tense, and there are no exclamation marks. "the layout
    // will change next time" is the future-tense shape the canon rules out.
    expect(SHELL_OFF_NOTE).not.toMatch(/sink|sunk/i);
    expect(SHELL_OFF_NOTE).not.toMatch(/you'll|will |soon/i);
    expect(SHELL_OFF_NOTE).toBe(SHELL_OFF_NOTE.toLowerCase());
    expect(SHELL_OFF_NOTE).not.toContain("!");
  });

  it("shows the build as an inert value row", () => {
    const section = settingsSection("about", { version: "v0.7.4 · 3f2a1c9" });
    // `kind: "value"` is what makes Row render inert markup instead of a
    // control — there is nothing behind the build string to open, and a
    // tab stop there would promise there is.
    expect(section.rows).toEqual([
      { id: "version", kind: "value", label: "version", value: "v0.7.4 · 3f2a1c9" },
    ]);
  });

  it("gives every section a blurb for the bar's second line", () => {
    for (const id of settingsSectionIds()) {
      expect(settingsSection(id, {}).blurb, `"${id}" has no blurb`).toBeTruthy();
    }
  });
});

describe("the words on screen", () => {
  it("marks the chosen option with a word, not a mark", () => {
    // The trail scope sheet's rule, and its reason: a word reads the same to a
    // screen reader as to an eye. Pinned here so the screen and the tests
    // cannot each carry their own copy of the string.
    expect(CHOSEN).toBe("in use");
  });

  it("keeps every user-facing string off the retired word", () => {
    // CLAUDE.md's retirement. The mechanic is unchanged and the word is
    // still correct internally; it must not reach a user-facing string,
    // and settings is the surface most likely to want to explain the
    // default in passing.
    const groups = settingsGroups({ tone: "cream", font: "lora" });
    const strings = [
      CHOSEN,
      ...groups.map((group) => group.eyebrow),
      ...allRows(groups).flatMap((row) => [row.label, row.value]),
      ...settingsSectionIds().flatMap((id) => {
        // Both shapes of the data section: the export action, and the row
        // with its note where the phone cannot share a zip.
        return [true, false].flatMap((exportZip) => {
          const section = settingsSection(id, { version: "v0", exportZip });
          return [
            section.title,
            section.blurb,
            ...section.rows.flatMap((row) => [row.label, row.detail, row.text].filter((t) => t !== undefined)),
          ];
        });
      }),
      ...["working", "done", "failed"].map((state) => exportStatusText({ state, pageCount: 3 })),
    ];
    for (const text of strings) {
      expect(text, `"${text}" carries the retired word`).not.toMatch(
        /\b(sinks?|sinking|sunk)\b/i,
      );
      expect(text, `"${text}" is not lowercase`).toBe(text.toLowerCase());
      expect(text).not.toMatch(/!/);
    }
  });
});

describe("the data section", () => {
  it("offers export as one action where the phone can share a zip", () => {
    const section = settingsSection("data", { exportZip: true });
    expect(section.title).toBe("data");
    expect(section.rows).toEqual([
      { id: "export", kind: "action", label: "export", detail: EXPORT_DETAIL, busy: false },
    ]);
    expect(EXPORT_DETAIL).toBe("every page as markdown files, in one zip");
  });

  it("keeps the row where it cannot, and says where the export works", () => {
    // iOS today, and a browser: the row is not a control (a press would do
    // nothing), and the note under it says where to go instead.
    const section = settingsSection("data", { exportZip: false });
    expect(section.rows.map((row) => [row.id, row.kind])).toEqual([["export", "value"], ["export-note", "note"]]);
    expect(section.rows[1].text).toBe(EXPORT_LAPTOP_NOTE);
  });

  it("says what the export is doing, and holds the action while it packs", () => {
    const working = settingsSection("data", { exportZip: true, exportStatus: { state: "working" } });
    expect(working.rows[0].busy).toBe(true);
    expect(working.rows[1]).toEqual({ id: "export-status", kind: "note", text: "packing every page…" });
    const done = settingsSection("data", { exportZip: true, exportStatus: { state: "done", pageCount: 47 } });
    expect(done.rows[0].busy).toBe(false);
    expect(done.rows[1].text).toBe("47 pages packed into one zip.");
    expect(exportStatusText({ state: "done", pageCount: 1 })).toBe("1 page packed into one zip.");
    expect(exportStatusText({ state: "failed" })).toMatch(/stopped/);
    // Never pressed: nothing to say, so no note row stands under it.
    expect(exportStatusText(null)).toBeNull();
  });
});

describe("the lock row", () => {
  it("says whether this device is locked, in the value column", () => {
    const row = (lock) => settingsGroups({ lock }).flatMap((g) => g.rows).find((r) => r.id === "lock");
    expect(row(true).value).toBe("on");
    expect(row(false).value).toBe("off");
    expect(row(true).label).toBe("lock");
  });
});
