// ChartBuilder is the /chart modal: it owns a working (kind, source,
// title), switches kind via tabs, and routes save/cancel. Driven by props
// (builderState / onSave / onCancel) — no api. Asserts the save payload
// shape, kind switching, and the debounced live preview.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import ChartBuilder from "../ChartBuilder.svelte";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id, syntax) => ({ svg: `<svg data-syntax="${syntax.length}"></svg>` })),
  },
}));

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

  it("renders a debounced Mermaid preview as the form is edited", async () => {
    const mermaidModule = await import("mermaid");
    const renderMock = mermaidModule.default.render;

    // Prewarm the renderer's dynamic-import chain (mermaid + the theme
    // module it also lazy-imports) under real timers first — under fake
    // timers, a first-ever dynamic import can outlive advanceTimersByTimeAsync
    // because the module transform isn't just a microtask. Once cached,
    // the debounce test below only needs microtasks to resolve.
    const { renderMermaidInto } = await import("../../lib/extensions/chart-render.js");
    await renderMermaidInto(document.createElement("div"), {
      kind: "flowchart",
      source: { direction: "TB", nodes: [], edges: [] },
    });
    renderMock.mockClear();

    vi.useFakeTimers();
    try {
      const { target } = render(ChartBuilder, {
        builderState: { mode: "create" },
        onSave: vi.fn(),
        onCancel: vi.fn(),
      });
      await tick();

      const labelInput = target.querySelector("input.node-input");
      expect(labelInput).toBeTruthy();
      labelInput.value = "start";
      labelInput.dispatchEvent(new Event("input", { bubbles: true }));
      await tick();

      // Not yet — the render is debounced ~150ms behind the edit.
      await vi.advanceTimersByTimeAsync(50);
      expect(renderMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(150);

      const previewHost = target.querySelector(".builder-preview .chart-render");
      expect(previewHost).toBeTruthy();
      expect(previewHost.innerHTML).toContain("<svg");
      expect(renderMock).toHaveBeenCalled();
      const [id] = renderMock.mock.calls.at(-1);
      expect(id.startsWith("chart-preview-")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles on the LATEST diagram when two renders resolve out of order", async () => {
    // A0-4.2. The debounce alone does not order the renders: renderMermaidInto
    // writes `el.innerHTML` AFTER awaiting mermaid.render, so a slow first
    // render finishing after a fast second one leaves the preview showing the
    // PREVIOUS diagram until the next keystroke. ChartBuilder serialises with
    // previewRendering/previewQueued — one render at a time, then a single
    // coalesced re-run using the latest kind/source. This drives that race
    // directly by resolving the render promises by hand, newest first.
    const mermaidModule = await import("mermaid");
    const renderMock = mermaidModule.default.render;
    const originalImpl = renderMock.getMockImplementation();

    // Same prewarm as the debounce test above, for the same reason.
    const { renderMermaidInto } = await import("../../lib/extensions/chart-render.js");
    await renderMermaidInto(document.createElement("div"), {
      kind: "flowchart",
      source: { direction: "TB", nodes: [], edges: [] },
    });
    renderMock.mockClear();

    // Hand out promises we resolve ourselves, so the finishing order is the
    // test's to choose rather than the scheduler's.
    const inFlight = [];
    renderMock.mockImplementation((id, syntax) => new Promise((resolve) => {
      inFlight.push({ syntax, resolve });
    }));

    vi.useFakeTimers();
    try {
      const { target } = render(ChartBuilder, {
        builderState: { mode: "create" },
        onSave: vi.fn(),
        onCancel: vi.fn(),
      });
      await tick();
      const labelInput = target.querySelector("input.node-input");
      expect(labelInput).toBeTruthy();

      const typeAndDebounce = async (value) => {
        labelInput.value = value;
        labelInput.dispatchEvent(new Event("input", { bubbles: true }));
        await tick();
        await vi.advanceTimersByTimeAsync(160);
      };

      await typeAndDebounce("alpha");
      // Serialised, the first render is still in flight, so the second edit
      // must NOT start a second mermaid.render — it is queued instead.
      expect(inFlight).toHaveLength(1);
      await typeAndDebounce("omega");
      expect(inFlight).toHaveLength(1);

      // Resolve newest-first, repeatedly, until nothing is left in flight.
      // Serialised: one at a time, and draining the first releases the
      // coalesced re-run that renders "omega" last. Unserialised: both are in
      // flight at once, "omega" resolves first and "alpha" overwrites it.
      for (let i = 0; i < 6 && inFlight.length; i++) {
        const call = inFlight.pop();
        call.resolve({ svg: `<svg data-syntax="${call.syntax.replace(/[\n"]/g, " ")}"></svg>` });
        await vi.advanceTimersByTimeAsync(1);
      }

      const previewHost = target.querySelector(".builder-preview .chart-render");
      expect(previewHost.innerHTML).toContain("omega");
      expect(previewHost.innerHTML).not.toContain("alpha");
    } finally {
      vi.useRealTimers();
      renderMock.mockReset();
      if (originalImpl) renderMock.mockImplementation(originalImpl);
    }
  });
});
