import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import TrailScreen from "../TrailScreen.svelte";

afterEach(cleanupAll);

const L = [
  { id: "L1", name: "the book", parent_id: null, mode: "discrete" },
  { id: "L2", name: "a job search", parent_id: null, mode: "discrete" },
  { id: "L3", name: "chapter three", parent_id: "L1", mode: "discrete" },
];

const mount = (props) => render(TrailScreen, { lineage: L[2], lineages: L, ...props });

const field = (target) => target.querySelector('input[aria-label="rename"]');

function type(target, text) {
  const input = field(target);
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function commit(target) {
  field(target).dispatchEvent(new FocusEvent("blur"));
  flushSync();
}

const rowLabels = (target) =>
  [...target.querySelectorAll(".shell-row-label")].map((n) => n.textContent.trim());

describe("TrailScreen", () => {
  it("holds the trail's name in its rename field", () => {
    const { target } = mount({});
    expect(field(target).value).toBe("chapter three");
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("trail");
  });

  it("hands a new name up when the field commits", () => {
    const onRename = vi.fn();
    const { target } = mount({ onRename });
    type(target, "chapter four");
    commit(target);
    expect(onRename).toHaveBeenCalledWith("chapter four");
  });

  it("writes nothing for the name it already has", () => {
    const onRename = vi.fn();
    const { target } = mount({ onRename });
    commit(target);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("puts the name back when the field is emptied", () => {
    const onRename = vi.fn();
    const { target } = mount({ onRename });
    type(target, "  ");
    commit(target);
    expect(onRename).not.toHaveBeenCalled();
    expect(field(target).value).toBe("chapter three");
  });

  it("says a name is taken, without asking the backend", () => {
    const onRename = vi.fn();
    const { target } = mount({ onRename });
    type(target, "the book");
    commit(target);
    expect(onRename).not.toHaveBeenCalled();
    expect(target.textContent).toContain("a trail named “the book” already exists");
  });

  it("reports what the field holds, so leaving can save it", () => {
    const onDraft = vi.fn();
    const { target } = mount({ onDraft });
    type(target, "chapter five");
    expect(onDraft).toHaveBeenLastCalledWith("chapter five");
  });

  it("offers move under and delete trail, delete last and destructive", () => {
    const onRow = vi.fn();
    const { target } = mount({ onRow });
    expect(rowLabels(target)).toEqual(["move under…", "delete trail"]);
    const rows = [...target.querySelectorAll(".shell-row")];
    expect(rows[0].querySelector(".shell-row-value").textContent.trim()).toBe("the book");
    expect(rows[1].dataset.destructive).toBe("true");
    rows.forEach((r) => r.click());
    expect(onRow.mock.calls.map((c) => c[0])).toEqual(["move", "delete"]);
  });

  it("shows the host's error under the field", () => {
    const { target } = mount({ error: "trail no longer exists" });
    expect(target.textContent).toContain("trail no longer exists");
  });

  it("says the trail is gone rather than going blank", () => {
    const { target } = mount({ lineage: null });
    expect(field(target)).toBeNull();
    expect(rowLabels(target)).toEqual([]);
    expect(target.querySelector(".empty-title")).not.toBeNull();
  });

  it("hands back on the bar's own control", () => {
    const onBack = vi.fn();
    const { target } = mount({ onBack });
    target.querySelector(".shell-navbar-back").click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
