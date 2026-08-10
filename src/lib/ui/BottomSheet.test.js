import { describe, it, expect, afterEach } from "vitest";
import { tick, flushSync } from "svelte";
import { render, cleanupAll } from "./test-helper.js";
import BottomSheet from "./BottomSheet.svelte";
import BottomSheetToggleHarness from "./BottomSheetToggleHarness.svelte";

afterEach(cleanupAll);

describe("BottomSheet", () => {
  it("renders nothing when open=false", () => {
    const { target } = render(BottomSheet, { open: false, onClose: () => {} });
    expect(target.querySelector(".sheet")).toBeNull();
    expect(target.querySelector(".sheet-scrim")).toBeNull();
  });

  it("renders the sheet + scrim when open=true", async () => {
    const { target } = render(BottomSheet, { open: true, onClose: () => {} });
    await tick();
    expect(target.querySelector(".sheet")).not.toBeNull();
    expect(target.querySelector(".sheet-scrim")).not.toBeNull();
  });
});

// Regression (fix-before-merge): the focusin effect's teardown used to close
// over the live `sheetEl` $state binding directly —
// `() => sheetEl.removeEventListener("focusin", onFocusIn)`. The sheet's
// markup (including the `bind:this={sheetEl}` element) sits behind
// `{#if open}`, so closing/unmounting nulls `sheetEl` as part of the same
// teardown pass this effect's cleanup runs in. When that happened first, the
// cleanup threw a TypeError on `null.removeEventListener`, which is exactly
// the race that silently killed "+ new page" from PageNav's pages sheet
// (PageNav.svelte:213 flips `open` to false in the same click handler that
// fires page creation). Capturing `const el = sheetEl` at effect-run time and
// closing over `el` instead fixes it.
describe("BottomSheet focusin teardown (fix-before-merge)", () => {
  it("focusing an input inside the sheet then unmounting does not throw", async () => {
    const { target, cleanup } = render(BottomSheet, {
      open: true,
      onClose: () => {},
    });
    await tick();

    const sheetBody = target.querySelector(".sheet-body");
    expect(sheetBody).not.toBeNull();
    const input = document.createElement("input");
    sheetBody.appendChild(input);
    input.focus();
    await tick();

    expect(() => cleanup()).not.toThrow();
  });

  // Reproduces the actual race: `open` flips true -> false through real
  // Svelte reactivity (not a full component unmount), which is what happens
  // in the field — Popover/LineageSelector/PageNav all keep BottomSheet
  // mounted and just flip `open`. A plain object mutated from outside
  // mount()'s props is not reactive, so this needs a small harness with its
  // own $state to exercise the real path.
  it("focusing an input then closing (open: true -> false) does not throw", async () => {
    const { target } = render(BottomSheetToggleHarness, {});
    await tick();

    const input = target.querySelector(".harness-input");
    expect(input).not.toBeNull();
    input.focus();
    await tick();

    const closeBtn = target.querySelector(".harness-close");
    // flushSync surfaces the effect-teardown TypeError synchronously (the
    // buggy version throws while destroying the {#if open} block's effects,
    // inside the same flush the click triggers); a plain `.click()` +
    // `await tick()` lets that same error slip out as an unhandled
    // rejection instead of failing this assertion.
    expect(() => flushSync(() => closeBtn.click())).not.toThrow();

    expect(target.querySelector(".sheet")).toBeNull();
  });
});
