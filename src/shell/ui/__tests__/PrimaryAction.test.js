import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import PrimaryAction from "../PrimaryAction.svelte";
import { TOOLBAR_BUTTON_LABELS } from "../../toolbar-model.js";

afterEach(cleanupAll);

function button(target) {
  return target.querySelector(".shell-primary-action [data-button-id]");
}

describe("PrimaryAction", () => {
  it("renders one control, labelled from the model's own map", () => {
    // The label lives with the decision (toolbar-model.js), exactly as
    // ToolbarStrip's do; a `label` prop here would be a second place a
    // button's words could be written.
    const { target } = render(PrimaryAction, { id: "unlock" });
    const btn = button(target);
    expect(btn.dataset.buttonId).toBe("unlock");
    expect(btn.getAttribute("aria-label")).toBe(TOOLBAR_BUTTON_LABELS.unlock);
  });

  it("reports a press with its id", () => {
    // pointerdown, not click — it composes ToolbarButton, whose whole
    // point is to act before focus can leave the field the writer is in.
    const onPress = vi.fn();
    const { target } = render(PrimaryAction, { id: "unlock", onPress });
    button(target).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(onPress).toHaveBeenCalledWith("unlock");
  });

  it("does nothing while disabled", () => {
    // Not a vacuous "nothing happens": the lock gate disables this until
    // the passphrase field is non-empty, and an unlock that fired on an
    // empty passphrase would submit one. The control is still rendered
    // — same button, dimmed — so the writer sees where the action will
    // be; it is the press that is withheld.
    const onPress = vi.fn();
    const { target } = render(PrimaryAction, { id: "unlock", disabled: true, onPress });
    expect(button(target).disabled).toBe(true);
    button(target).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("is a filled accent button floored at --tap", () => {
    // READ FROM SOURCE: jsdom applies no scoped stylesheet, so nothing
    // rendered can tell a filled block from the accent-coloured text it
    // used to be, and no rendered box has a height here. Four
    // declarations: the floor, because a filled button whose box fell
    // under 44px would be SEEN under-size as well as missed (it is not
    // on the rules test's button allowlist — it composes ToolbarButton —
    // so this is the only guard on the floor at this site); the fill and
    // its label tone, which are the two tones every theme already has;
    // and the stretch across the band, which overrides ToolbarButton's
    // strip sizing.
    const src = readFileSync("src/shell/ui/PrimaryAction.svelte", "utf8");
    const match = /\.shell-primary-action\s+:global\(\.shell-toolbar-button\)\s*\{([^}]*)\}/.exec(src);
    expect(match, "no `.shell-primary-action :global(.shell-toolbar-button)` rule").toBeTruthy();
    const decls = match[1];
    expect(decls).toMatch(/min-height:\s*var\(--tap\)/);
    expect(decls).toMatch(/background:\s*var\(--warm-accent\)/);
    expect(decls).toMatch(/color:\s*var\(--canvas-bg\)/);
    expect(decls).toMatch(/flex:\s*1 1 auto/);
  });
});
