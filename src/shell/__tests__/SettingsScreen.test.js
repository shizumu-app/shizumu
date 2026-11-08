import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import SettingsScreen from "../SettingsScreen.svelte";
import { settingsGroups } from "../settings-model.js";

afterEach(cleanupAll);

const rowLabels = (target) =>
  [...target.querySelectorAll(".shell-row-label")].map((n) => n.textContent.trim());

const rowFor = (target, label) =>
  [...target.querySelectorAll(".shell-row")].find(
    (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
  );

const valueOf = (target, label) =>
  rowFor(target, label)?.querySelector(".shell-row-value")?.textContent.trim() ?? "";

function mountSettings(props = {}) {
  return render(SettingsScreen, {
    groups: settingsGroups({ tone: "cream", font: "lora" }),
    ...props,
  });
}

describe("SettingsScreen", () => {
  it("is a root: a titled bar with no back", () => {
    // Stack registers a navstack entry for every element EXCEPT the first,
    // because back at a stack root belongs to the OS. A back control here
    // would offer what the edge gesture and the system button both
    // correctly refuse.
    const { target } = mountSettings();
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("settings");
    expect(target.querySelector(".shell-navbar-back")).toBeNull();
  });

  it("lists the model's rows in the model's order", () => {
    expect(rowLabels(mountSettings().target)).toEqual([
      "tone",
      "font",
      "data",
      "lock",
      "sync",
      "labs",
      "about",
    ]);
  });

  it("puts the rows in five named groups and draws no separator", () => {
    // Five rows in three `RowGroup`s, each under its eyebrow. The words
    // are the model's (settings-model.test.js holds them); what this
    // holds is that the screen renders every group the model returns,
    // AS a group — a screen that flattened them would list five rows
    // under one name or none. Zero separators is the other half: the
    // screen used to draw a `Divider` between two unnamed groups, and a
    // group that names itself and sits on its own surface has nothing
    // left for a rule to say, so one turning up here is a line between
    // two things that already tell themselves apart.
    const { target } = mountSettings();
    const groups = [...target.querySelectorAll(".shell-row-group")];
    expect(groups.map((g) => g.querySelector(".shell-eyebrow")?.textContent.trim())).toEqual([
      "page",
      "data",
      "lock",
      "sync",
      "app",
    ]);
    expect(groups.map((g) => g.querySelectorAll(".shell-row").length)).toEqual([2, 1, 1, 1, 2]);
    expect(target.querySelectorAll('[role="separator"]').length).toBe(0);
  });

  it("shows what each option set is set to without opening it", () => {
    const { target } = mountSettings({
      groups: settingsGroups({ tone: "dark", font: "dm-mono" }),
    });
    expect(valueOf(target, "tone")).toBe("dark");
    expect(valueOf(target, "font")).toBe("mono");
  });

  it("pushes by id, so nothing on screen has to spell a section name", () => {
    const onOpen = vi.fn();
    const { target } = mountSettings({ onOpen });
    rowFor(target, "labs").click();
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("labs");
  });

  it("renders inert rows when no host is listening", () => {
    // Not "nothing happens" for its own sake: `Row` renders a control only
    // when it has an action, so without onOpen these rows must not be in
    // the tab order promising a push nobody performs. The gallery mounts
    // screens with no host, which is where this shape is reached.
    const { target } = mountSettings({ onOpen: null });
    expect(target.querySelectorAll("button").length).toBe(0);
    expect(rowLabels(target).length).toBe(7);
  });
});
