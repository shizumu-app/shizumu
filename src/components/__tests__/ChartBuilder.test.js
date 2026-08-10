// ChartBuilder is the /chart modal: it owns a working (kind, source,
// title), switches kind via tabs, and routes save/cancel. Driven by props
// (builderState / onSave / onCancel) — no api. Asserts the save payload
// shape and kind switching.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import ChartBuilder from "../ChartBuilder.svelte";

afterEach(cleanupAll);

const byText = (target, tag, text) =>
  [...target.querySelectorAll(tag)].find((el) => el.textContent.trim() === text);

describe("ChartBuilder", () => {
  it("renders nothing when builderState is null", () => {
    const { target } = render(ChartBuilder, {
      builderState: null,
      onSave: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(target.querySelector(".builder")).toBeNull();
  });

  it("opens in flowchart mode with the three kind tabs", async () => {
    const { target } = render(ChartBuilder, {
      builderState: { mode: "create" },
      onSave: vi.fn(),
      onCancel: vi.fn(),
    });
    await tick();
    expect(target.querySelector(".builder")).toBeTruthy();
    // Kind tabs are a SegmentedControl (button.seg-btn per option).
    expect(byText(target, ".seg-btn", "flowchart")).toBeTruthy();
    expect(byText(target, ".seg-btn", "mind map")).toBeTruthy();
    expect(byText(target, ".seg-btn", "timeline")).toBeTruthy();
  });

  it("saves a flowchart with a null title when none is entered", async () => {
    const onSave = vi.fn();
    const { target } = render(ChartBuilder, {
      builderState: { mode: "create" },
      onSave,
      onCancel: vi.fn(),
    });
    await tick();
    byText(target, "button", "save").click();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.kind).toBe("flowchart");
    expect(payload.blockTitle).toBeNull();
    expect(payload.source).toBeTypeOf("object");
  });

  it("carries the entered title into the save payload", async () => {
    const onSave = vi.fn();
    const { target } = render(ChartBuilder, {
      builderState: { mode: "create" },
      onSave,
      onCancel: vi.fn(),
    });
    await tick();
    const title = target.querySelector("input.title-input");
    title.value = "system diagram";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    byText(target, "button", "save").click();

    expect(onSave.mock.calls[0][0].blockTitle).toBe("system diagram");
  });

  it("switches kind via the tabs and saves the chosen kind", async () => {
    const onSave = vi.fn();
    const { target } = render(ChartBuilder, {
      builderState: { mode: "create" },
      onSave,
      onCancel: vi.fn(),
    });
    await tick();
    byText(target, ".seg-btn", "mind map").click();
    await tick();
    byText(target, "button", "save").click();

    expect(onSave.mock.calls[0][0].kind).toBe("mindmap");
  });
});
