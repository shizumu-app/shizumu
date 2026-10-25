import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import ToolbarStrip from "../ToolbarStrip.svelte";
import { TOOLBAR_BUTTON_LABELS } from "../../toolbar-model.js";

afterEach(cleanupAll);

describe("ToolbarStrip", () => {
  it("renders one control per button id, in order", () => {
    const { target } = render(ToolbarStrip, { buttons: ["bold", "italic", "pin"] });
    const ids = [...target.querySelectorAll("[data-button-id]")].map((b) => b.dataset.buttonId);
    expect(ids).toEqual(["bold", "italic", "pin"]);
  });

  it("labels each control from the model's own map", () => {
    // The labels live with the decision (toolbar-model.js), not here, so
    // the strip cannot drift from what the model says a button is.
    const { target } = render(ToolbarStrip, { buttons: ["pin-selection"] });
    expect(target.querySelector("[data-button-id]").getAttribute("aria-label")).toBe(
      TOOLBAR_BUTTON_LABELS["pin-selection"],
    );
  });

  it("reports which button was pressed", () => {
    const onPress = vi.fn();
    const { target } = render(ToolbarStrip, { buttons: ["bold", "italic"], onPress });
    target.querySelector('[data-button-id="italic"]').dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(onPress).toHaveBeenCalledWith("italic");
  });

  it("renders nothing at all for an empty button list", () => {
    // The empty list is a real state, not a guard against bad input:
    // toolbarFor returns [] for the tab-bar and "none" strips, whose
    // content is another component's business entirely.
    const { target } = render(ToolbarStrip, { buttons: [] });
    expect(target.querySelectorAll("[data-button-id]").length).toBe(0);
  });

  it("fits at six controls and scrolls at seven", () => {
    // The boundary, held on both sides (ToolbarStrip.svelte's header):
    // six is the block strip's width after the visual pass's Task 4, and
    // a strip that fits spreads evenly with no mask, while one that does
    // not scrolls under the edge fade. Decided from the list's length
    // inside the strip, so a host cannot hand it a `fits` it has not
    // earned. Both cases assert positively — a `fits` that was never
    // written would fail the six-wide line, and a threshold nudged to
    // seven would fail the seven-wide one.
    const six = ["insert", "type", "bold", "italic", "pin", "undo"];
    expect(
      render(ToolbarStrip, { buttons: six }).target
        .querySelector(".shell-toolbar-strip").classList.contains("fits"),
    ).toBe(true);
    expect(
      render(ToolbarStrip, { buttons: [...six, "keyboard-down"] }).target
        .querySelector(".shell-toolbar-strip").classList.contains("fits"),
    ).toBe(false);
  });

  it("drops the mask and the scroll when it fits", () => {
    // READ FROM SOURCE: jsdom applies no scoped stylesheet, so the class
    // above is only half the proof — a `.fits` rule that kept the mask
    // would still dim the first and last of six controls for nothing.
    const src = readFileSync("src/shell/ui/ToolbarStrip.svelte", "utf8");
    const match = /\.shell-toolbar-strip\.fits\s*\{([^}]*)\}/.exec(src);
    expect(match, "no .shell-toolbar-strip.fits rule in ToolbarStrip.svelte").toBeTruthy();
    expect(match[1]).toMatch(/mask-image:\s*none/);
    expect(match[1]).toMatch(/overflow-x:\s*hidden/);
    expect(match[1]).toMatch(/justify-content:\s*space-evenly/);
  });
});

// ── the way out of the strip, and why it left (2026-10-05) ───────────────
//
// The strip used to carry a quiet chevron that blurred the field. It
// existed because the slot was MODAL — the editor's strip while the shell
// believed a keyboard was up, navigation when it believed otherwise — and
// on a Galaxy A34 that belief got stuck true with the keyboard long gone:
// every viewport number the webview offered read short, at zoom 1.00, so
// nothing in the arithmetic could tell, and page, memory and settings were
// unreachable until the app was restarted. The chevron was the one control
// that could return them without trusting a measurement.
//
// The band is two rows now (ShellRoot): this strip sits above a nav row
// nothing can take away. With no lockout left, the chevron's remaining jobs
// were dismissing a keyboard the system's back button already dismisses,
// and clearing a stale belief — which goRoot does on every root switch, for
// no pixels. A control that earns its place by handling a case that can no
// longer happen is how chrome accumulates, so it went.
describe("ToolbarStrip — the strip is actions, and only actions", () => {
  it("renders nothing but the buttons it was given", () => {
    // Not an empty assertion for its own sake: the chevron sat AHEAD of the
    // actions, so a stray extra child here is specifically that exit coming
    // back. `fits` is read off the button list rather than the DOM, so a
    // seventh child would also change how the row lays out without
    // changing the flag that is supposed to describe it.
    const { target } = render(ToolbarStrip, {
      buttons: ["insert", "type", "bold", "italic", "pin", "undo"],
    });
    const strip = target.querySelector(".shell-toolbar-strip");
    expect(strip.children.length).toBe(6);
    expect(strip.classList.contains("fits")).toBe(true);
    const ids = [...target.querySelectorAll("[data-button-id]")].map((b) => b.dataset.buttonId);
    expect(ids).toEqual(["insert", "type", "bold", "italic", "pin", "undo"]);
  });
});
