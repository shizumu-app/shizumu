// Snapshots the slash menu's DOM for a fixture set so the section
// grouping + chip rendering stay stable across refactors.
import { describe, it, expect } from "vitest";
import { renderItems, createMenu } from "../../slash-commands.js";

const fixture = [
  { title: "heading 1", description: "page title", section: "structure", shortcut: "#", command: () => {} },
  { title: "bullet", description: "unordered", section: "lists", shortcut: "-", command: () => {} },
  { title: "recipe", description: "given · do · result", section: "shizumu blocks", command: () => {} },
];

describe("slash menu render", () => {
  it("groups items by section with a header row per section", () => {
    const el = createMenu();
    renderItems(el, fixture, 0, () => {});
    const headers = el.querySelectorAll(".slash-section-header");
    expect(headers.length).toBe(3);
    expect(headers[0].textContent).toBe("structure");
    expect(headers[1].textContent).toBe("lists");
    expect(headers[2].textContent).toBe("shizumu blocks");
  });

  it("renders a shortcut chip when shortcut is set", () => {
    const el = createMenu();
    renderItems(el, fixture, 0, () => {});
    const chips = el.querySelectorAll(".slash-shortcut");
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe("#");
    expect(chips[1].textContent).toBe("-");
  });

  it("does NOT render a chip for items without a shortcut", () => {
    const el = createMenu();
    renderItems(el, fixture, 0, () => {});
    const buttons = el.querySelectorAll("button");
    const recipeBtn = Array.from(buttons).find((b) => b.textContent.includes("recipe"));
    expect(recipeBtn.querySelector(".slash-shortcut")).toBeNull();
  });
});
