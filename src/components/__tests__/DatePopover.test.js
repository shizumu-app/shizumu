// DatePopover range state machine — regression coverage for the touch
// two-tap range picker. dragStart/rangeArm are internal $state that must
// be disarmed by every exit path (preset pick, clear, completed range) or
// a stale arm/dragStart survives into the next tap and silently commits a
// bogus range. See pickPreset (existing fix) and clear() (FIX 2).
import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import DatePopover from "../memory/DatePopover.svelte";

afterEach(cleanupAll);

const TODAY = "2026-01-15";

function dayBtn(target, day) {
  const btns = [...target.querySelectorAll(".cal-cell")];
  return btns.find((b) => b.textContent.trim() === String(day));
}

function rangeChip(target) {
  return target.querySelector('[aria-label="select a date range"]');
}

function presetBtn(target, label) {
  const radios = [...target.querySelectorAll("[role=radio]")];
  return radios.find((r) => r.textContent.trim() === label);
}

function mountPopover(props = {}) {
  return render(DatePopover, {
    anchor: null,
    open: true,
    inline: true,
    filter: null,
    todayStr: TODAY,
    activityByDate: {},
    onChange: vi.fn(),
    onClose: vi.fn(),
    ...props,
  });
}

describe("DatePopover range state machine", () => {
  it("two-tap range: arms via the chip, tap A then tap B commits from/to in order and disarms", async () => {
    const onChange = vi.fn();
    const { target } = mountPopover({ onChange });

    rangeChip(target).click();
    await tick();

    dayBtn(target, 20).click(); // first tap: arms dragStart at the later date
    await tick();
    expect(onChange).toHaveBeenCalledWith({ kind: "range", from: "2026-01-20", to: "2026-01-20" });

    dayBtn(target, 10).click(); // second tap, earlier date: from/to must reorder
    await tick();
    expect(onChange).toHaveBeenCalledWith({ kind: "range", from: "2026-01-10", to: "2026-01-20" });

    // Disarmed: the next tap must be a plain specific pick, not a new range.
    onChange.mockClear();
    dayBtn(target, 5).click();
    await tick();
    expect(onChange).toHaveBeenCalledWith({ kind: "specific", date: "2026-01-05" });
  });

  it("a preset tap mid-arm disarms — no bogus range on the next tap", async () => {
    const onChange = vi.fn();
    const { target } = mountPopover({ onChange });

    rangeChip(target).click();
    await tick();
    dayBtn(target, 10).click(); // arm dragStart with the first tap
    await tick();
    expect(onChange).toHaveBeenCalledWith({ kind: "range", from: "2026-01-10", to: "2026-01-10" });

    onChange.mockClear();
    presetBtn(target, "today").click();
    await tick();
    expect(onChange).toHaveBeenCalledWith({ kind: "today" });

    onChange.mockClear();
    dayBtn(target, 20).click();
    await tick();
    expect(onChange).toHaveBeenCalledWith({ kind: "specific", date: "2026-01-20" });
  });

  it("clear mid-arm disarms — regression for the clear()-leaves-armed-state bug", async () => {
    const onChange = vi.fn();
    // Static filter so the footer (and its clear button) is present
    // regardless of what onChange is subsequently called with.
    const { target } = mountPopover({
      onChange,
      filter: { kind: "range", from: "2026-01-01", to: "2026-01-02" },
    });

    rangeChip(target).click();
    await tick();
    dayBtn(target, 10).click(); // arm dragStart with the first tap
    await tick();
    expect(onChange).toHaveBeenCalledWith({ kind: "range", from: "2026-01-10", to: "2026-01-10" });

    onChange.mockClear();
    target.querySelector(".clear").click();
    await tick();
    expect(onChange).toHaveBeenCalledWith(null);

    onChange.mockClear();
    dayBtn(target, 20).click();
    await tick();
    expect(onChange).toHaveBeenCalledWith({ kind: "specific", date: "2026-01-20" });
  });

  it("a plain tap without arming produces a specific pick", async () => {
    const onChange = vi.fn();
    const { target } = mountPopover({ onChange });

    dayBtn(target, 12).click();
    await tick();
    expect(onChange).toHaveBeenCalledWith({ kind: "specific", date: "2026-01-12" });
  });
});
