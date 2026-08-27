import { describe, it, expect } from "vitest";
import { renderItems } from "../slash-commands.js";

describe("slash menu rows keep focus in the editor", () => {
  // Every editor toolbar in TipTapEditor.svelte swallows mousedown, with the
  // reason written at the block-handles column: without it a tap moves focus
  // out of the editor, the IME closes, the visible viewport grows back,
  // --kb-inset and --app-height change, and the shell reflows before the
  // click resolves. That comment says the column "was the only editor
  // toolbar IN THIS FILE missing it" -- and this menu lives in another file,
  // so the sweep never reached it.
  //
  // Driven through renderItems, the exported entry point, rather than the
  // private row builder: a test of the helper would pass even if renderItems
  // stopped calling it.
  function rowsFor(count) {
    const el = document.createElement("div");
    const items = Array.from({ length: count }, (_, i) => ({
      title: `item ${i}`, subtitle: "", command: () => {},
    }));
    renderItems(el, items, 0, () => {});
    return el.querySelectorAll("button");
  }

  it("preventDefaults mousedown on every row", () => {
    const rows = rowsFor(3);
    expect(rows.length).toBe(3);
    for (const row of rows) {
      const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      row.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
  });

  it("still fires onSelect on click", () => {
    // The guard must not cost the row its actual job. Asserting this
    // because preventDefault on the wrong event is exactly how a control
    // becomes inert while looking correct.
    const el = document.createElement("div");
    const picked = [];
    renderItems(el, [{ title: "a", subtitle: "", command: () => {} }], 0, (i) => picked.push(i));
    el.querySelector("button").click();
    expect(picked).toEqual([0]);
  });
});
