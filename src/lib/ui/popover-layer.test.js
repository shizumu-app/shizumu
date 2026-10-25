// A popover opened from inside a modal has to paint above it. Settings'
// "lock after inactivity" chip opened its popover at z-index 100 under the
// settings modal (scrim 200, panel 201): the chip looked dead, and every
// click landed on the modal (reported from 0.7.8). Popover is never
// rendered inside the modal's DOM, so the two z-indexes compete directly.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const zOf = (file, selector) => {
  const css = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8").split("<style>")[1];
  const block = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  return Number(block.match(/z-index:\s*(\d+)/)?.[1]);
};

describe("popover layering", () => {
  it("paints a popover above the modal it was opened from", () => {
    const modalTop = Math.max(zOf("./Modal.svelte", ".scrim"), zOf("./Modal.svelte", ".modal"));
    expect(Number.isFinite(modalTop)).toBe(true);
    expect(zOf("./Popover.svelte", ".popover")).toBeGreaterThan(modalTop);
  });
});
