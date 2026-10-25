import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import ToolbarButton from "../ToolbarButton.svelte";

afterEach(cleanupAll);

describe("ToolbarButton", () => {
  it("acts on pointerdown, before focus can move", () => {
    // The whole point: acting on click means the browser has already
    // blurred the editor by the time we run. The desktop tree grew
    // shouldDismissOnBlur and isAffordanceTarget to cope with exactly
    // that, and the shell does not need either.
    const onPress = vi.fn();
    const { target } = render(ToolbarButton, { label: "bold", onPress });
    target.querySelector("button").dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("prevents the default so the editor keeps focus", () => {
    // This is the focus guarantee, as far as jsdom can express it. The
    // browser turns preventDefault-on-pointerdown into "focus does not
    // move"; jsdom implements the event but not that consequence, so this
    // asserts the cause and cannot assert the effect.
    //
    // A test that DID assert the effect was written and deleted: under a
    // deliberately broken implementation (onclick, no preventDefault) it
    // still passed, because jsdom never shifted focus in the first place.
    // It read as protection for the one behaviour this component exists
    // to provide, which is worse than no test at all.
    //
    // The effect is proven where it can be: a VR interaction state driven
    // by real input in a real browser (CLAUDE.md, "a phone bug you have to
    // do something to see"). tests/vr/states.js PIN_FLOW_TOUCH is the
    // precedent — it already asserts focus stayed inside .ProseMirror.
    const { target } = render(ToolbarButton, { label: "bold", onPress: () => {} });
    const ev = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    target.querySelector("button").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("does not act twice when a click follows the pointerdown", () => {
    // A real tap fires pointerdown AND click. Handling both would apply
    // bold twice — an off-by-one nobody sees until they type.
    const onPress = vi.fn();
    const { target } = render(ToolbarButton, { label: "bold", onPress });
    const button = target.querySelector("button");
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    button.click();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("does not act when disabled, but still holds the editor's focus", () => {
    // Both halves matter, and only one of them is obvious. A disabled
    // control must not run its command — and must STILL preventDefault,
    // because the native focus shift happens on pointerdown regardless of
    // whether we then choose to act. Asserting only the first half lets
    // `if (disabled) return` migrate above preventDefault with every test
    // still green, which is the whole bug this component exists to avoid.
    const onPress = vi.fn();
    const { target } = render(ToolbarButton, { label: "undo", onPress, disabled: true });
    const ev = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    target.querySelector("button").dispatchEvent(ev);
    expect(onPress).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("can be asked to act on the lift instead, for a control with no editor behind it", () => {
    // THE FIRST-RUN DEFECT. Onboarding's `begin` is a full-width button in
    // the bottom band. On pointerdown the gate went away, the tab bar
    // mounted into that band, and the finger lifted onto a tab — so a new
    // writer landed on an empty memory list instead of the page. Measured
    // on an SM-A065F: the same taps with only the last one moved to the
    // button's left end landed on `page` rather than `memory`, which is the
    // proof it was the gesture and not onboarding.
    //
    // Acting on click is the fix, and it is only available to callers with
    // no focused field behind them. See PrimaryAction's header.
    const onPress = vi.fn();
    const { target } = render(ToolbarButton, { label: "begin", onPress, activateOn: "click" });
    const button = target.querySelector("button");

    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(onPress).not.toHaveBeenCalled();

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("still fires exactly once on a full tap when it acts on the lift", () => {
    // The double-fire this component's header warns about, from the other
    // side: a real tap sends pointerdown AND click, and only one handler is
    // ever attached, so `begin` advances one slide rather than two.
    const onPress = vi.fn();
    const { target } = render(ToolbarButton, { label: "begin", onPress, activateOn: "click" });
    const button = target.querySelector("button");
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("does not suppress the default when it acts on the lift", () => {
    // preventDefault on pointerdown is what keeps the editor's selection,
    // and it must NOT happen here: this path exists for controls with no
    // editor behind them, and suppressing the default would cancel the very
    // click the control now acts on.
    const { target } = render(ToolbarButton, { label: "begin", onPress: () => {}, activateOn: "click" });
    const ev = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    target.querySelector("button").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("labels itself for assistive tech", () => {
    const { target } = render(ToolbarButton, { label: "pin", onPress: () => {} });
    expect(target.querySelector("button").getAttribute("aria-label")).toBe("pin");
  });
});
