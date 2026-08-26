import { describe, it, expect } from "vitest";
import { shouldDismissOnBlur, isAffordanceTarget } from "../touch-reveal-dismiss.js";

describe("shouldDismissOnBlur", () => {
  it("keeps the toolbar when the gesture started on it", () => {
    // The reported bug, stated as a decision. On a device the blur fires
    // while activeElement is still BODY (the button is not focused until
    // mouseup), so anything asking "is focus on the toolbar?" answers no
    // and dismisses the control the user is mid-tap on. The pointerdown
    // that began the gesture is the only reliable witness.
    expect(shouldDismissOnBlur({ pointerDownOnToolbar: true, coarsePointer: true })).toBe(false);
  });

  it("dismisses when the blur came from tapping somewhere else entirely", () => {
    // Not a no-op assertion: this is the behaviour the guard exists to
    // preserve — leaving the editor is what puts the touch toolbar away,
    // since touch has no mouseleave.
    expect(shouldDismissOnBlur({ pointerDownOnToolbar: false, coarsePointer: true })).toBe(true);
  });

  it("never dismisses on a mouse, where hover already governs the toolbar", () => {
    expect(shouldDismissOnBlur({ pointerDownOnToolbar: false, coarsePointer: false })).toBe(false);
    expect(shouldDismissOnBlur({ pointerDownOnToolbar: true, coarsePointer: false })).toBe(false);
  });
});

describe("isAffordanceTarget", () => {
  function el(html) {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.firstElementChild;
  }

  it("recognises the toolbar's own buttons", () => {
    const bar = el('<div class="block-handles"><button data-label="pin">x</button></div>');
    expect(isAffordanceTarget(bar.querySelector("button"))).toBe(true);
  });

  it("recognises the chip, the synthetic handle and the title slot", () => {
    expect(isAffordanceTarget(el('<span class="block-type-chip">tasks</span>'))).toBe(true);
    expect(isAffordanceTarget(el('<button class="touch-block-handle">+</button>'))).toBe(true);
    expect(isAffordanceTarget(el('<input class="board-title-slot" />'))).toBe(true);
  });

  it("recognises the touch action sheet's own rows, not just the chip that opens it", () => {
    // Task 6 finding: a tap on a row INSIDE the already-open sheet (pin,
    // copy, delete, title, convert to..., or a convert-submenu target) is
    // still the user addressing an affordance, not a block. Before this,
    // isAffordanceTarget only recognised the chip that OPENS the sheet —
    // once open, its own rows read as "somewhere else entirely", so the
    // blur they cause on touch (the dialog taking focus) dismissed the
    // reveal (hoveredBlock/touchRevealedBlock) out from under the row's own
    // click handler. pin and title happened to have independent recovery
    // paths; copy, delete, insert-below and the convert submenu's live
    // target list did not, and silently did nothing.
    const sheet = el(
      '<div class="block-action-sheet"><button class="block-action-row"><span class="block-action-label">convert to…</span></button></div>',
    );
    expect(isAffordanceTarget(sheet.querySelector("button"))).toBe(true);
    expect(isAffordanceTarget(sheet.querySelector(".block-action-label"))).toBe(true);
  });

  it("does not claim an ordinary block, so tapping text still addresses it", () => {
    // The reveal must keep working: a tap on the block's own body is
    // precisely what opens the toolbar in the first place.
    expect(isAffordanceTarget(el("<p>the page is where the thinking gets done.</p>"))).toBe(false);
  });

  it("survives a target that cannot be walked (text nodes, window, null)", () => {
    expect(isAffordanceTarget(null)).toBe(false);
    expect(isAffordanceTarget(document.createTextNode("x"))).toBe(false);
  });
});
