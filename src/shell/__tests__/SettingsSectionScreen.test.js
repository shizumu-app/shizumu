import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import SettingsSectionScreen from "../SettingsSectionScreen.svelte";
import { CHOSEN, SHELL_OFF_NOTE, settingsSection } from "../settings-model.js";

afterEach(cleanupAll);

const rowLabels = (target) =>
  [...target.querySelectorAll(".shell-row-label")].map((n) => n.textContent.trim());

const rowFor = (target, label) =>
  [...target.querySelectorAll(".shell-row")].find(
    (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
  );

const valueOf = (target, label) =>
  rowFor(target, label)?.querySelector(".shell-row-value")?.textContent.trim() ?? "";

function mountSection(id, state = {}, props = {}) {
  return render(SettingsSectionScreen, {
    section: settingsSection(id, state),
    onBack: () => {},
    ...props,
  });
}

describe("SettingsSectionScreen", () => {
  it("carries the section's title and its blurb on the bar's two lines", () => {
    const { target } = mountSection("tone", { tone: "cream" });
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("tone");
    expect(target.querySelector(".shell-navbar-subtitle").textContent.trim()).toBe(
      "canvas color underneath everything you write.",
    );
  });

  it("is pushed, so it draws a back", () => {
    const onBack = vi.fn();
    const { target } = mountSection("labs", { yjsEnabled: true }, { onBack });
    target.querySelector(".shell-navbar-back").click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("marks the option in use with a word in the value column", () => {
    const { target } = mountSection("tone", { tone: "dark" });
    expect(rowLabels(target)).toEqual(["cream", "white", "dark", "system"]);
    expect(valueOf(target, "dark")).toBe(CHOSEN);
    expect(valueOf(target, "cream")).toBe("");
  });

  it("keeps the row in use selectable, so the list does not reflow as it is read", () => {
    // `Row` renders a control only when it has an action. Dropping the
    // chosen row's onSelect to say "already on" would take that one row's
    // tab stop away mid-list.
    const onChoose = vi.fn();
    const { target } = mountSection("tone", { tone: "dark" }, { onChoose });
    expect(target.querySelectorAll("button.shell-row").length).toBe(4);
    rowFor(target, "dark").click();
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("dark");
  });

  it("draws no chevron on any choice row", () => {
    // The chevron is the promise that a tap opens a screen (row-kind.js),
    // and a tone option opens none — it selects and pops. Every option
    // row carried one until the visual pass, because a row with an
    // onSelect was a push by default; `kind="choice"` is what says
    // otherwise, and forgetting it on one branch puts the wart back on
    // four rows at once. Asserted on the kind AND on the glyph: the kind
    // is what the screen declares, the glyph is what Row drew from it.
    const { target } = mountSection("tone", { tone: "dark" }, { onChoose: () => {} });
    const rows = [...target.querySelectorAll(".shell-row")];
    expect(rows.map((r) => r.dataset.kind)).toEqual(["choice", "choice", "choice", "choice"]);
    expect(target.querySelectorAll(".shell-row-chevron").length).toBe(0);
  });

  it("puts the rows in one group with no eyebrow", () => {
    // One list about one setting: the bar carries the title and the
    // blurb, so there is nothing to name over the rows. A second group,
    // or an eyebrow, would be a heading with nothing to distinguish.
    const { target } = mountSection("font", { font: "lora" });
    expect(target.querySelectorAll(".shell-row-group").length).toBe(1);
    expect(target.querySelector(".shell-eyebrow")).toBeNull();
    expect(target.querySelectorAll(".shell-row-group-body .shell-row").length).toBe(4);
  });

  it("reports a choice by its stored id, not by the label on screen", () => {
    // "mono" is the desktop's word for `dm-mono`, and the id is what
    // `canvas_font_family` holds. A screen reporting its label would write
    // a value nothing reads back.
    const onChoose = vi.fn();
    const { target } = mountSection("font", { font: "lora" }, { onChoose });
    rowFor(target, "mono").click();
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("dm-mono");
  });

  it("reports a toggle's NEW value, with its row id", () => {
    const onToggle = vi.fn();
    const { target } = mountSection("labs", { yjsEnabled: true }, { onToggle });
    const box = rowFor(target, "yjs for continuous trails").querySelector("input");
    expect(box.checked).toBe(true);
    box.click();
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("yjs", false);
  });

  it("reports the layout switch by its own row id, not by the one above it", () => {
    // Two toggles in one section, and the host's `SETTINGS_TOGGLES` is
    // keyed by row id — a screen that reported the wrong one would write
    // the yjs flag when a reader asked to leave the shell.
    const onToggle = vi.fn();
    const { target } = mountSection("labs", { shellEnabled: true }, { onToggle });
    const box = rowFor(target, "new phone layout").querySelector("input");
    expect(box.checked).toBe(true);
    box.click();
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("shell", false);
  });

  it("renders the note as prose, under the group, with no tab stop", () => {
    // The fourth kind. It is a sentence about the switch above it, so it
    // must not arrive as a `Row` — a row would carry the tap-height floor
    // a sentence has no use for — and it must not sit INSIDE the group's
    // body either: the body rules every child after the first, and a line
    // between the note and the control it describes reads as a divider
    // between two rows rather than as a caption on one. So: a `Note`,
    // after the group, and directly after it, because the switch it
    // explains is the group's last row.
    const { target } = mountSection("labs", { shellEnabled: false });
    const note = target.querySelector(".shell-note");
    expect(note?.textContent.trim()).toBe(SHELL_OFF_NOTE);
    expect(note.closest(".shell-row-group-body")).toBeNull();
    const group = target.querySelector(".shell-row-group");
    expect(group.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rowLabels(target)).toEqual(["yjs for continuous trails", "new phone layout"]);
    expect(target.querySelectorAll("button.shell-row").length).toBe(0);
  });

  it("draws no note while the switch is on", () => {
    // NOT an empty assertion for its own sake: the note is the only
    // feedback this switch gives, and it has to appear exactly when
    // something is pending. Drawn on both states it would say nothing —
    // this is the half that makes it a signal.
    const { target } = mountSection("labs", { shellEnabled: true });
    expect(target.querySelector(".shell-note")).toBeNull();
  });

  it("renders the build as markup with no tab stop", () => {
    const { target } = mountSection("about", { version: "v0.7.4 · 3f2a1c9" });
    expect(valueOf(target, "version")).toBe("v0.7.4 · 3f2a1c9");
    // Inert on purpose: there is nothing behind a build string to open.
    expect(target.querySelector(".shell-row-chevron")).toBeNull();
    expect(target.querySelectorAll("button.shell-row").length).toBe(0);
  });

  it("renders a bar and no rows when the host has no section for it", () => {
    // Unreachable from the app — the host pushes only ids the root
    // produced — so this pins the failure MODE rather than a path: a
    // titled-blank screen whose back still works beats a component that
    // throws inside Stack, which renders two entries into one cell and
    // would take the screen underneath down with it.
    const { target } = render(SettingsSectionScreen, { section: null, onBack: () => {} });
    expect(target.querySelectorAll(".shell-row").length).toBe(0);
    expect(target.querySelector(".shell-navbar-back")).not.toBeNull();
  });
});

describe("SettingsSectionScreen — data", () => {
  it("runs the export from its row, with what it holds on the second line", () => {
    const onAction = vi.fn();
    const { target } = mountSection("data", { exportZip: true }, { onAction });
    const row = rowFor(target, "export");
    expect(row.tagName).toBe("BUTTON");
    expect(row.dataset.kind).toBe("action");
    expect(row.querySelector(".shell-row-detail").textContent.trim()).toBe("every page as markdown files, in one zip");
    row.click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith("export");
  });

  it("holds the row while the zip packs, and says so under it", () => {
    const onAction = vi.fn();
    const { target } = mountSection("data", { exportZip: true, exportStatus: { state: "working" } }, { onAction });
    // Inert while busy: a second press would pack every page twice.
    expect(rowFor(target, "export").tagName).not.toBe("BUTTON");
    expect(target.textContent).toContain("packing every page…");
  });

  it("shows the row and the laptop note where the phone cannot share a zip", () => {
    const onAction = vi.fn();
    const { target } = mountSection("data", { exportZip: false }, { onAction });
    expect(rowFor(target, "export").tagName).not.toBe("BUTTON");
    expect(target.textContent).toContain("export works from the laptop for now.");
  });
});
